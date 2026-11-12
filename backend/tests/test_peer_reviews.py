"""Đánh giá đồng nghiệp theo tháng (tab "Đánh giá" — mọi người trừ Giám đốc).

- PUT /peer-reviews: 1 phiếu (người được chấm, tháng, loại) với 3 điểm 1–5; gửi lại = ghi đè.
- GET /peer-reviews/mine?month=: chỉ phiếu MÌNH chấm.
- GET /peer-reviews/summary: Giám đốc / Quản trị xem TB + số phiếu, không thấy ai chấm.

Chạy từ thư mục backend: python -m unittest tests.test_peer_reviews -v
"""
import os
import unittest
from datetime import datetime
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite+pysqlite:///:memory:"
os.environ["DEBUG"] = "true"

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.deps import get_current_user
from app.models import Company, User, UserRole
from app.routers.peer_reviews import router


class PeerReviewTests(unittest.TestCase):
    def setUp(self):
        clock = patch("app.routers.peer_reviews.vn_now", return_value=datetime(2026, 12, 2, 10))
        clock.start()
        self.addCleanup(clock.stop)
        self.engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        with self.sessions() as db:
            company = Company(name="Test company", code="TEST-PEER-REVIEW")
            other = Company(name="Other company", code="TEST-PEER-OTHER")
            db.add_all([company, other])
            db.flush()
            self.director = User(company_id=company.id, email="gd@example.com", full_name="Giam doc",
                                 role=UserRole.DIRECTOR, hashed_password="unused")
            self.admin = User(company_id=company.id, email="admin@example.com", full_name="Admin",
                              role=UserRole.ADMIN, hashed_password="unused")
            self.staff = User(company_id=company.id, email="nv@example.com", full_name="Nhan vien",
                              role=UserRole.FIELD_STAFF, hashed_password="unused")
            self.peer = User(company_id=company.id, email="dn@example.com", full_name="Dong nghiep",
                             role=UserRole.MANAGER_MID, hashed_password="unused")
            self.outsider = User(company_id=other.id, email="out@example.com", full_name="Ngoai cong ty",
                                 role=UserRole.FIELD_STAFF, hashed_password="unused")
            db.add_all([self.director, self.admin, self.staff, self.peer, self.outsider])
            db.commit()

        self.app = FastAPI()
        self.app.include_router(router)
        self.app.dependency_overrides[get_db] = self._override_db
        self.current = self.staff
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

    def _put(self, evaluatee, month="2026-11", kind="QUALITY", scores=(5, 4, 3)):
        return self.client.put("/peer-reviews", json={
            "evaluatee_id": evaluatee.id, "month": month, "kind": kind, "scores": list(scores),
        })

    def _mine(self, month="2026-11"):
        res = self.client.get("/peer-reviews/mine", params={"month": month})
        self.assertEqual(res.status_code, 200, res.text)
        return res.json()

    def test_save_then_overwrite_same_key(self):
        res = self._put(self.peer)
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()["scores"], [5, 4, 3])
        self.assertEqual(res.json()["evaluatee_name"], "Dong nghiep")
        first_id = res.json()["id"]
        res = self._put(self.peer, scores=(2, 2, 2))
        self.assertEqual(res.json()["id"], first_id)            # cùng khóa -> sửa phiếu cũ
        self._put(self.peer, kind="TEAM", scores=(4, 4, 5))     # loại khác -> phiếu riêng
        with patch("app.routers.peer_reviews.vn_now", return_value=datetime(2026, 11, 2, 10)):
            self._put(self.peer, month="2026-10")               # phiếu lịch sử được gửi đúng kỳ mở
        mine = self._mine()
        self.assertEqual({(r["kind"], tuple(r["scores"])) for r in mine}, {("QUALITY", (2, 2, 2)), ("TEAM", (4, 4, 5))})
        self.assertEqual(len(self._mine("2026-10")), 1)

    def test_validation_and_rules(self):
        self.assertEqual(self._put(self.peer, scores=(5, 4)).status_code, 422)          # thiếu điểm
        self.assertEqual(self._put(self.peer, scores=(5, 4, 6)).status_code, 422)       # ngoài 1–5
        self.assertEqual(self._put(self.peer, scores=(5, 4, 0)).status_code, 422)
        self.assertEqual(self._put(self.peer, kind="OTHER").status_code, 422)
        self.assertEqual(self._put(self.peer, month="2026-13").status_code, 422)
        self.assertEqual(self._put(self.peer, month="2027-01").status_code, 400)        # tháng tương lai
        self.assertEqual(self._put(self.staff).status_code, 400)                        # tự chấm
        self.assertEqual(self._put(self.director).status_code, 403)                     # không chấm Giám đốc
        self.assertEqual(self._put(self.outsider).status_code, 404)                     # khác công ty
        self.current = self.director
        self.assertEqual(self._put(self.peer).status_code, 403)                         # Giám đốc không chấm
        self.current = self.admin
        self.assertEqual(self._put(self.peer).status_code, 200)                         # Quản trị vẫn chấm

    def test_mine_is_private_and_delete_own_only(self):
        rid = self._put(self.peer).json()["id"]
        self.current = self.peer
        self.assertEqual(self._mine(), [])                                              # không thấy phiếu người khác
        self.assertEqual(self.client.delete(f"/peer-reviews/{rid}").status_code, 404)
        self.current = self.staff
        self.assertEqual(self.client.delete(f"/peer-reviews/{rid}").status_code, 204)
        self.assertEqual(self._mine(), [])

    def test_summary_for_director_and_admin_only(self):
        self._put(self.peer, scores=(5, 5, 5))
        self.current = self.admin
        self._put(self.peer, scores=(3, 3, 3))
        self._put(self.staff, kind="TEAM", scores=(4, 4, 4))
        self.current = self.staff
        self.assertEqual(self.client.get("/peer-reviews/summary",
                                         params={"from_month": "2026-11", "to_month": "2026-11"}).status_code, 403)
        for who in (self.director, self.admin):
            self.current = who
            res = self.client.get("/peer-reviews/summary", params={"from_month": "2026-10", "to_month": "2026-11"})
            self.assertEqual(res.status_code, 200, res.text)
            rows = {(r["user_id"], r["month"], r["kind"]): r for r in res.json()}
            self.assertEqual(rows[(self.peer.id, "2026-11", "QUALITY")]["avg"], 4.0)
            self.assertEqual(rows[(self.peer.id, "2026-11", "QUALITY")]["count"], 2)
            self.assertEqual(rows[(self.staff.id, "2026-11", "TEAM")]["count"], 1)
            self.assertNotIn("evaluator_id", res.text)
        self.assertEqual(self.client.get("/peer-reviews/summary",
                                         params={"from_month": "2026-12", "to_month": "2026-11"}).status_code, 400)


if __name__ == "__main__":
    unittest.main()
