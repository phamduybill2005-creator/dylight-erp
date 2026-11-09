"""Điểm đánh giá nhập tay và số chấm công được đối chiếu tự động theo tháng.

- PUT /evaluations/month-reviews/{user_id}/{YYYY-MM}: chỉ Giám đốc; gửi trường nào sửa trường đó.
- GET /evaluations/month-reviews: dòng theo (người, tháng); số chấm công không bị ghi đè.

Chạy từ thư mục backend: python -m unittest tests.test_evaluation_month_review -v
"""
import os
import unittest
from datetime import date, datetime
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
from app.models import Attendance, Company, LeaveRequest, LeaveStatus, User, UserRole
from app.routers.evaluations import router


class EvaluationMonthReviewTests(unittest.TestCase):
    def setUp(self):
        clock = patch("app.services.attendance_reconciliation.vn_now", return_value=datetime(2026, 12, 31, 18))
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
            company = Company(name="Test company", code="TEST-MONTH-REVIEW")
            db.add(company)
            db.flush()
            self.company_id = company.id
            self.director = User(company_id=company.id, email="gd@example.com", full_name="Giam doc",
                                 role=UserRole.DIRECTOR, hashed_password="unused")
            self.admin = User(company_id=company.id, email="admin@example.com", full_name="Admin",
                              role=UserRole.ADMIN, hashed_password="unused")
            self.staff = User(company_id=company.id, email="nv@example.com", full_name="Nhan vien",
                              role=UserRole.FIELD_STAFF, hashed_password="unused")
            db.add_all([self.director, self.admin, self.staff])
            db.flush()
            db.add(Attendance(company_id=company.id, user_id=self.staff.id,
                              work_date=date(2026, 1, 2), check_in=datetime(2026, 1, 2, 8),
                              check_out=datetime(2026, 1, 2, 17)))
            db.commit()

        self.app = FastAPI()
        self.app.include_router(router)
        self.app.dependency_overrides[get_db] = self._override_db
        self.current = self.director
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

    def _leave(self, user, frm, to, leave_type="FULL", source="LEAVE", status=LeaveStatus.APPROVED):
        with self.sessions() as db:
            db.add(LeaveRequest(company_id=self.company_id, user_id=user.id, from_date=date.fromisoformat(frm),
                                to_date=date.fromisoformat(to), leave_type=leave_type, source=source, status=status))
            db.commit()

    def _put(self, uid, month, body):
        return self.client.put(f"/evaluations/month-reviews/{uid}/{month}", json=body)

    def _get(self, frm, to):
        res = self.client.get("/evaluations/month-reviews", params={"from_month": frm, "to_month": to})
        self.assertEqual(res.status_code, 200, res.text)
        return {(r["user_id"], r["month"]): r for r in res.json()}

    def test_director_partial_updates_keep_other_fields(self):
        res = self._put(self.staff.id, "2026-11", {"score_team": 10, "score_quality": 40})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual((res.json()["late_cp"], res.json()["score_quality"], res.json()["score_attitude"]), (0.0, 40.0, 25.0))
        res = self._put(self.staff.id, "2026-11", {"score_team": 22.5})
        row = res.json()
        self.assertEqual((row["late_cp"], row["score_quality"], row["score_attitude"], row["score_team"]), (0.0, 40.0, 25.0, 22.5))
        # Xoá trắng 1 ô
        self.assertIsNone(self._put(self.staff.id, "2026-11", {"score_team": None}).json()["score_team"])

    def test_score_limits_and_month_format(self):
        self.assertEqual(self._put(self.staff.id, "2026-11", {"score_attitude": 26}).status_code, 422)
        self.assertEqual(self._put(self.staff.id, "2026-11", {"score_quality": 51}).status_code, 422)
        self.assertEqual(self._put(self.staff.id, "2026-11", {"late_kp": -1}).status_code, 422)
        self.assertEqual(self._put(self.staff.id, "2026-13", {"late_kp": 1}).status_code, 400)
        self.assertEqual(self._put(self.staff.id, "2026-11", {}).status_code, 400)
        self.assertEqual(self._put(99999, "2026-11", {"late_kp": 1}).status_code, 404)

    def test_only_director_writes_admin_can_read(self):
        self.current = self.admin
        self.assertEqual(self._put(self.staff.id, "2026-11", {"late_kp": 2}).status_code, 403)
        rows = self._get("2026-11", "2026-11")
        self.assertEqual({uid for uid, month in rows}, {self.director.id, self.admin.id, self.staff.id})
        self.assertTrue(all(row["leave_kp"] == 0 for row in rows.values()))
        self.current = self.staff
        self.assertEqual(self.client.get("/evaluations/month-reviews",
                                         params={"from_month": "2026-11", "to_month": "2026-11"}).status_code, 403)

    def test_auto_leave_cp_from_approved_leaves(self):
        # T2 2/11 -> T4 4/11 nghỉ cả ngày = 3; nửa ngày 5/11 = 0,5; T7 7/11 + CN 8/11 -> chỉ tính T7 = 1
        self._leave(self.staff, "2026-11-02", "2026-11-04")
        self._leave(self.staff, "2026-11-05", "2026-11-05", leave_type="MORNING")
        self._leave(self.staff, "2026-11-07", "2026-11-08")
        self._leave(self.staff, "2026-11-10", "2026-11-10", leave_type="LATE_MORNING")      # đi muộn: không tính
        self._leave(self.staff, "2026-11-11", "2026-11-11", source="SCHEDULE")                # lịch sinh viên: không tính
        self._leave(self.staff, "2026-11-12", "2026-11-12", status=LeaveStatus.PENDING)       # chưa duyệt: không tính
        self._leave(self.staff, "2026-10-30", "2026-11-02")                                   # vắt tháng: trùng 2/11 không được cộng hai lần
        rows = self._get("2026-10", "2026-11")
        self.assertEqual(rows[(self.staff.id, "2026-11")]["leave_cp_auto"], 4.5)
        self.assertEqual(rows[(self.staff.id, "2026-10")]["leave_cp_auto"], 2.0)
        self.assertEqual(rows[(self.staff.id, "2026-11")]["leave_cp"], 4.5)
        # Điều chỉnh phép tại ngày chấm công; không ghi đè số tổng hợp nữa.
        self.assertEqual(self._put(self.staff.id, "2026-11", {"leave_cp": 4}).status_code, 400)

    def test_quarter_range_returns_each_month(self):
        self._put(self.staff.id, "2026-10", {"score_quality": 30})
        self._put(self.staff.id, "2026-12", {"score_quality": 45})
        rows = self._get("2026-10", "2026-12")
        self.assertEqual(set(rows), {(user.id, month) for user in (self.staff, self.director, self.admin)
                                    for month in ("2026-10", "2026-11", "2026-12")})
        self.assertEqual(rows[(self.staff.id, "2026-12")]["score_quality"], 45)
        self.assertEqual(self.client.get("/evaluations/month-reviews",
                                         params={"from_month": "2026-12", "to_month": "2026-10"}).status_code, 400)


if __name__ == "__main__":
    unittest.main()
