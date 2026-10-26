"""Lịch sinh viên của tuần ĐÃ BẮT ĐẦU bị khóa: chỉ ADMIN mới được lưu/xóa."""
import os
import unittest
from datetime import timedelta
from unittest.mock import Mock

os.environ["DATABASE_URL"] = "sqlite+pysqlite:///:memory:"
os.environ["DEBUG"] = "true"

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.database import Base, get_db, vn_now
from app.deps import get_current_user
from app.models import Company, LeaveRequest, LeaveStatus, User, UserRole
from app.routers.leave import router
from app.services.leave_zalo_service import get_leave_zalo_service


class StudentScheduleLockTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        with self.sessions() as db:
            company = Company(name="Lock", code="LOCK")
            db.add(company); db.flush()
            self.student = User(company_id=company.id, email="student@example.invalid", full_name="Student",
                hashed_password="unused", role=UserRole.FIELD_STAFF)
            self.director = User(company_id=company.id, email="director@example.invalid", full_name="Director",
                hashed_password="unused", role=UserRole.DIRECTOR)
            self.admin = User(company_id=company.id, email="admin@example.invalid", full_name="Admin",
                hashed_password="unused", role=UserRole.ADMIN)
            db.add_all([self.student, self.director, self.admin]); db.commit()
        self.current = self.student
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_current_user] = lambda: self.current
        app.dependency_overrides[get_db] = self.db_dependency
        app.dependency_overrides[get_leave_zalo_service] = lambda: Mock()
        self.client = TestClient(app)

        today = vn_now().date()
        self.this_monday = today - timedelta(days=today.weekday())
        self.next_monday = self.this_monday + timedelta(days=7)
        self.last_monday = self.this_monday - timedelta(days=7)

    def db_dependency(self):
        with self.sessions() as db:
            yield db

    def save(self, day, shift="OFF", user_id=None):
        payload = {"days": [{"date": day.isoformat(), "shift": shift, "reason": "Đi học"}]}
        if user_id is not None:
            payload["user_id"] = user_id
        return self.client.post("/leave/student-week-schedule", json=payload)

    def count_leaves(self):
        with self.sessions() as db:
            return db.query(LeaveRequest).count()

    def add_schedule_leave(self, day, user):
        with self.sessions() as db:
            rec = LeaveRequest(company_id=user.company_id, user_id=user.id, from_date=day, to_date=day,
                leave_type="FULL", reason="Đi học", status=LeaveStatus.APPROVED, source="SCHEDULE")
            db.add(rec); db.commit()
            return rec.id

    # ---------------- Lưu đăng ký lịch tuần ----------------
    def test_student_can_register_next_week(self):
        response = self.save(self.next_monday + timedelta(days=2))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(response.json()), 1)
        self.assertEqual(self.count_leaves(), 1)

    def test_student_cannot_touch_current_week(self):
        # Mọi ngày của tuần đang diễn ra — kể cả Chủ nhật cuối tuần — đều đã khóa.
        for offset in (0, 2, 6):
            response = self.save(self.this_monday + timedelta(days=offset))
            self.assertEqual(response.status_code, 403, response.text)
            self.assertIn("Quản trị hệ thống", response.json()["detail"])
        self.assertEqual(self.count_leaves(), 0)

    def test_student_cannot_touch_past_week(self):
        response = self.save(self.last_monday + timedelta(days=1))
        self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(self.count_leaves(), 0)

    def test_locked_day_blocks_whole_payload(self):
        # Một ngày khóa trong gói gửi -> từ chối cả gói, không lưu nửa vời.
        payload = {"days": [
            {"date": self.next_monday.isoformat(), "shift": "OFF"},
            {"date": (self.this_monday + timedelta(days=5)).isoformat(), "shift": "OFF"},
        ]}
        response = self.client.post("/leave/student-week-schedule", json=payload)
        self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(self.count_leaves(), 0)

    def test_director_is_locked_like_staff(self):
        self.current = self.director
        response = self.save(self.this_monday + timedelta(days=1), user_id=self.student.id)
        self.assertEqual(response.status_code, 403, response.text)
        # Tuần sau thì quản lý vẫn đăng ký hộ được như trước.
        response = self.save(self.next_monday + timedelta(days=1), user_id=self.student.id)
        self.assertEqual(response.status_code, 200, response.text)

    def test_admin_can_edit_started_weeks(self):
        self.current = self.admin
        for day in (self.this_monday, self.last_monday + timedelta(days=3)):
            response = self.save(day, user_id=self.student.id)
            self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.count_leaves(), 2)

    # ---------------- Xóa lịch tuần ----------------
    def test_delete_schedule_in_started_week_requires_admin(self):
        leave_id = self.add_schedule_leave(self.this_monday + timedelta(days=1), self.student)

        self.current = self.student   # chính chủ
        response = self.client.delete(f"/leave/{leave_id}")
        self.assertEqual(response.status_code, 403, response.text)

        self.current = self.director  # quản lý cũng không
        response = self.client.delete(f"/leave/{leave_id}")
        self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(self.count_leaves(), 1)

        self.current = self.admin
        response = self.client.delete(f"/leave/{leave_id}")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.count_leaves(), 0)

    def test_owner_can_still_delete_next_week_schedule(self):
        leave_id = self.add_schedule_leave(self.next_monday + timedelta(days=1), self.student)
        self.current = self.student
        response = self.client.delete(f"/leave/{leave_id}")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.count_leaves(), 0)


if __name__ == "__main__":
    unittest.main()
