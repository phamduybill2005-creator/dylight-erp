"""Router Kênh trực tiếp (Server-Sent Events) — giao diện đổi TỨC THÌ.

Trình duyệt mở MỘT kết nối tới /events/stream và giữ nguyên. Khi có ai sửa dữ
liệu, máy chủ đẩy xuống một dòng ngắn cho biết mục nào vừa đổi; trình duyệt tự
gọi API lấy dữ liệu mới. Xem app/events.py để biết phạm vi và giới hạn.

Xác thực: EventSource của trình duyệt KHÔNG gắn được header Authorization, nên
frontend gọi bằng fetch + đọc luồng, vẫn gửi Bearer như mọi API khác. Cố ý
KHÔNG nhận token qua query string vì token sẽ lọt vào log của máy chủ/proxy.
"""
import asyncio

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from app import events
from app.deps import get_current_user
from app.models import User

router = APIRouter(prefix="/events", tags=["Kênh trực tiếp"])

# Cứ 25 giây không có tin thì gửi 1 dòng ping. Việc này giữ kết nối không bị
# proxy/CDN cắt vì "im lặng quá lâu", và giúp phát hiện sớm khi kết nối đã chết.
_PING_SECONDS = 25


@router.get("/stream")
async def stream(request: Request, current: User = Depends(get_current_user)):
    sub = events.subscribe(current.id, current.company_id)

    async def gen():
        try:
            # Dòng đầu tiên báo "đã kết nối" -> frontend biết kênh trực tiếp đang
            # chạy và có thể giãn nhịp hỏi lại dự phòng.
            yield "event: ready\ndata: ok\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    topic = await asyncio.wait_for(sub.queue.get(), timeout=_PING_SECONDS)
                    yield f"event: changed\ndata: {topic}\n\n"
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
        finally:
            events.unsubscribe(sub)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            # Tắt đệm ở Nginx/Caddy — có đệm thì tin nằm lại trên proxy, mất hết
            # ý nghĩa "tức thì".
            "X-Accel-Buffering": "no",
        },
    )
