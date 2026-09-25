"""Kênh đẩy trực tiếp (Server-Sent Events).

Bài quan trọng nhất ở đây là test_stream_khong_duoc_giu_phien_csdl: lần đầu làm
tính năng này tôi để /events/stream phụ thuộc get_current_user -> kéo theo
get_db, mà FastAPI giữ phiên CSDL tới khi response kết thúc. Luồng SSE không bao
giờ kết thúc nên mỗi tab đang mở giữ chết một kết nối CSDL; pool chỉ có 15 kết
nối nên vài tab là cạn, mọi request khác xếp hàng chờ và CẢ WEB ĐỨNG HÌNH sau
khoảng 10-15 giây.

Chạy từ thư mục backend: python -m unittest tests.test_live_events -v
"""
import asyncio
import os
import unittest

os.environ["DATABASE_URL"] = "sqlite+pysqlite:///:memory:"
os.environ["DEBUG"] = "true"

from app import events
from app.database import get_db


def _flatten(dependant):
    """Toàn bộ hàm mà một route phụ thuộc vào, kể cả phụ thuộc lồng nhau."""
    out = []
    for d in dependant.dependencies:
        if d.call is not None:
            out.append(d.call)
        out.extend(_flatten(d))
    return out


class StreamDependencyTests(unittest.TestCase):
    def test_stream_khong_duoc_giu_phien_csdl(self):
        from app.main import app

        route = next(r for r in app.routes if getattr(r, "path", "") == "/api/v1/events/stream")
        deps = _flatten(route.dependant)

        self.assertNotIn(
            get_db, deps,
            "/events/stream KHÔNG được phụ thuộc get_db: luồng SSE sống mãi nên sẽ "
            "giữ chết một kết nối CSDL cho mỗi tab, cạn pool là cả web đứng hình. "
            "Hãy tự mở phiên, xác thực rồi đóng ngay (xem routers/events.py).",
        )

    def test_stream_van_phai_doi_dang_nhap(self):
        """Bỏ get_db không được kéo theo việc bỏ luôn xác thực."""
        from fastapi.testclient import TestClient

        from app.main import app

        with TestClient(app) as client:
            self.assertEqual(client.get("/api/v1/events/stream").status_code, 401)


class EventBusTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        events._subscribers.clear()
        events.set_loop(asyncio.get_running_loop())

    async def asyncTearDown(self):
        events._subscribers.clear()

    async def test_gui_dung_pham_vi(self):
        a = events.subscribe(1, 10)
        b = events.subscribe(2, 10)
        khac = events.subscribe(3, 99)          # công ty khác

        self.assertEqual(events.publish(10, "leave"), 2)      # cả công ty 10
        self.assertEqual(events.publish(10, "leave", [2]), 1)  # riêng user 2
        await asyncio.sleep(0)

        self.assertEqual(a.queue.qsize(), 1)
        self.assertEqual(b.queue.qsize(), 2)
        self.assertEqual(khac.queue.qsize(), 0)   # không rò sang công ty khác

    async def test_gioi_han_ket_noi_moi_nguoi(self):
        """Van an toàn: trình duyệt lỗi mở kết nối liên tục cũng không làm nghẽn."""
        for _ in range(events._MAX_PER_USER + 4):
            events.subscribe(7, 10)
        cua_toi = [s for s in events._subscribers if s.user_id == 7]
        self.assertEqual(len(cua_toi), events._MAX_PER_USER)

    async def test_hang_doi_day_thi_bo_tin_cu(self):
        """Tab treo không được ngốn hết bộ nhớ; tin mới nhất phải luôn tới được."""
        sub = events.subscribe(1, 10)
        for i in range(events._QUEUE_SIZE + 10):
            events.publish(10, f"topic{i}")
        await asyncio.sleep(0)
        self.assertLessEqual(sub.queue.qsize(), events._QUEUE_SIZE)

    async def test_khong_co_nguoi_nghe_thi_publish_vo_hai(self):
        self.assertEqual(events.publish(10, "leave"), 0)

    async def test_huy_dang_ky_thi_khong_nhan_nua(self):
        sub = events.subscribe(1, 10)
        events.unsubscribe(sub)
        self.assertEqual(events.publish(10, "leave"), 0)


if __name__ == "__main__":
    unittest.main()
