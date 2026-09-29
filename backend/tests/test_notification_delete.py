"""Xoá thông báo: chỉ người nhận xoá được bản của mình; của người khác -> 404.

Chạy từ thư mục backend: python -m unittest tests.test_notification_delete -v
"""
import os
import unittest

os.environ["DATABASE_URL"] = "sqlite+pysqlite:///:memory:"
os.environ["DEBUG"] = "true"

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.deps import get_current_user
from app.models import Company, Notification, User, UserRole
from app.routers.notifications import router


class NotificationDeleteTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)

        with self.sessions() as db:
            company = Company(name="Test company", code="TEST-NOTIF-DEL")
            db.add(company)
            db.flush()
            self.a = User(company_id=company.id, email="a@example.com", full_name="Nguoi A",
                          role=UserRole.FIELD_STAFF, hashed_password="unused")
            self.b = User(company_id=company.id, email="b@example.com", full_name="Nguoi B",
                          role=UserRole.FIELD_STAFF, hashed_password="unused")
            db.add_all([self.a, self.b])
            db.flush()
            # 2 thông báo cho A (1 chưa đọc), 1 cho B.
            n1 = Notification(company_id=company.id, recipient_id=self.a.id, title="A - chua doc", is_read=False)
            n2 = Notification(company_id=company.id, recipient_id=self.a.id, title="A - da doc", is_read=True)
            n3 = Notification(company_id=company.id, recipient_id=self.b.id, title="B - cua B")
            db.add_all([n1, n2, n3])
            db.flush()
            self.n1, self.n2, self.n3 = n1.id, n2.id, n3.id
            db.commit()

        self.app = FastAPI()
        self.app.include_router(router)
        self.app.dependency_overrides[get_db] = self._override_db
        self.current = self.a
        self.app.dependency_overrides[get_current_user] = lambda: self._reload(self.current)
        self.client = TestClient(self.app)

    def tearDown(self):
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def _override_db(self):
        db = self.sessions()
        try:
            yield db
        finally:
            db.close()

    def _reload(self, user: User) -> User:
        with self.sessions() as db:
            return db.get(User, user.id)

    def _exists(self, notif_id: int) -> bool:
        with self.sessions() as db:
            return db.get(Notification, notif_id) is not None

    def test_nguoi_nhan_xoa_duoc_thong_bao_cua_minh(self):
        self.current = self.a
        # Gọi đếm TRƯỚC: từ ngày 27 hằng tháng, /me tự tạo thêm thông báo nhắc đánh giá (chưa đọc)
        # nên không thể mong đợi con số tuyệt đối — so sánh trước/sau.
        before = self.client.get("/notifications/me/unread-count").json()["count"]
        r = self.client.delete(f"/notifications/{self.n1}")
        self.assertEqual(r.status_code, 204, r.text)
        self.assertFalse(self._exists(self.n1))
        self.assertTrue(self._exists(self.n2))     # bản khác của A còn nguyên
        ids = [n["id"] for n in self.client.get("/notifications/me").json()]
        self.assertNotIn(self.n1, ids)
        self.assertIn(self.n2, ids)
        after = self.client.get("/notifications/me/unread-count").json()["count"]
        self.assertEqual(after, before - 1)        # xoá 1 thông báo chưa đọc -> đếm giảm đúng 1

    def test_khong_xoa_duoc_thong_bao_cua_nguoi_khac(self):
        self.current = self.b
        r = self.client.delete(f"/notifications/{self.n1}")
        self.assertEqual(r.status_code, 404, r.text)
        self.assertTrue(self._exists(self.n1))

    def test_id_khong_ton_tai(self):
        self.current = self.a
        self.assertEqual(self.client.delete("/notifications/999999").status_code, 404)


if __name__ == "__main__":
    unittest.main()
