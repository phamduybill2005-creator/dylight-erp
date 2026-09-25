"""Kênh ĐẨY sự kiện xuống trình duyệt — để giao diện đổi TỨC THÌ.

Trước đây mỗi trang tự hỏi lại máy chủ theo nhịp, nên thay đổi của người khác
phải chờ tới nhịp sau mới thấy. Nay chỗ nào sửa dữ liệu thì gọi publish(), máy
chủ đẩy ngay một tin nhỏ xuống các trình duyệt đang mở, trình duyệt nạp lại
đúng phần cần thiết. Độ trễ còn vài chục mili-giây.

PHẠM VI: hàng đợi nằm TRONG TIẾN TRÌNH — hợp với cách chạy hiện tại (một
tiến trình uvicorn, một máy chủ trên Render). Nếu sau này chạy nhiều worker
hoặc nhiều máy, sự kiện sinh ra ở worker này KHÔNG sang được worker khác; khi
đó giao diện vẫn đúng nhờ NHỊP HỎI LẠI DỰ PHÒNG bên frontend (chỉ chậm hơn).
Muốn tức thì cả khi nhiều worker thì thay phần này bằng Postgres LISTEN/NOTIFY
hoặc Redis pub/sub — phần còn lại của hệ thống không phải sửa.

TIN ĐẨY CỐ Ý KHÔNG CHỨA DỮ LIỆU: chỉ báo "mục X vừa đổi". Trình duyệt tự gọi
API để lấy dữ liệu mới, nên vẫn đi qua đúng kiểm tra quyền như thường — không
có nguy cơ đẩy nhầm dữ liệu cho người không được xem.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

# Mỗi trình duyệt đang mở = 1 thuê bao. Hàng đợi có giới hạn để một tab treo
# không ngốn hết bộ nhớ: đầy thì bỏ tin cũ nhất (nhịp dự phòng sẽ vá lại).
_QUEUE_SIZE = 64


# eq=False để giữ so sánh & băm THEO DANH TÍNH: mỗi kết nối là một thuê bao
# riêng, và dataclass mặc định (eq=True) sẽ bỏ __hash__ -> không cho vào set được.
@dataclass(slots=True, eq=False)
class Subscriber:
    user_id: int
    company_id: int
    queue: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(maxsize=_QUEUE_SIZE))


_subscribers: set[Subscriber] = set()
_loop: asyncio.AbstractEventLoop | None = None


def set_loop(loop: asyncio.AbstractEventLoop) -> None:
    """Ghi nhớ vòng lặp sự kiện của web server.

    publish() hay được gọi từ route ĐỒNG BỘ (FastAPI chạy chúng trong luồng
    riêng), mà asyncio.Queue không an toàn đa luồng -> phải đẩy việc về đúng
    vòng lặp này bằng call_soon_threadsafe.
    """
    global _loop
    _loop = loop


def subscribe(user_id: int, company_id: int) -> Subscriber:
    sub = Subscriber(user_id=user_id, company_id=company_id)
    _subscribers.add(sub)
    return sub


def unsubscribe(sub: Subscriber) -> None:
    _subscribers.discard(sub)


def subscriber_count() -> int:
    return len(_subscribers)


def _deliver(sub: Subscriber, topic: str) -> None:
    try:
        sub.queue.put_nowait(topic)
    except asyncio.QueueFull:
        try:                       # bỏ tin cũ nhất, nhường chỗ cho tin mới
            sub.queue.get_nowait()
            sub.queue.put_nowait(topic)
        except Exception:          # noqa: BLE001
            pass


def publish(company_id: int, topic: str, user_ids: list[int] | None = None) -> int:
    """Báo cho các trình duyệt đang mở rằng `topic` vừa đổi.

    - user_ids = None  -> gửi mọi người trong công ty (vd: lịch nghỉ chung).
    - user_ids = [...] -> chỉ gửi đúng những người đó (vd: đơn của riêng ai).

    Không bao giờ ném lỗi: đẩy tin hỏng thì cùng lắm giao diện chậm vài chục
    giây theo nhịp dự phòng, tuyệt đối không được làm hỏng nghiệp vụ đang chạy.
    """
    if _loop is None or not _subscribers:
        return 0
    wanted = set(user_ids) if user_ids is not None else None
    targets = [
        s for s in _subscribers
        if s.company_id == company_id and (wanted is None or s.user_id in wanted)
    ]
    for sub in targets:
        try:
            _loop.call_soon_threadsafe(_deliver, sub, topic)
        except Exception:  # noqa: BLE001
            pass
    return len(targets)
