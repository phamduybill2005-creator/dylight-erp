"""Kiểm thử thứ tự ưu tiên của đơn nghỉ phép trong /leave/schedule.

Chạy từ backend: python -m unittest tests.test_leave_schedule_order -v
"""
import os
import unittest
from datetime import date, datetime

os.environ["DATABASE_URL"] = "sqlite+pysqlite:///:memory:"
os.environ["DEBUG"] = "true"

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.deps import get_current_user
from app.models import Company, LeaveRequest, LeaveStatus, User, UserRole
from app.routers import leave


class LeaveScheduleOrderTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        self.db = self.sessions()

        company = Company(name="Test company", code="TEST")
        self.db.add(company)
        self.db.flush()

        self.user = User(
            company_id=company.id,
            email="student@example.com",
            full_name="Sinh viên A",
            role=UserRole.FIELD_STAFF,
            hashed_password="unused",
        )
        self.db.add(self.user)
        self.db.commit()

        self.app = FastAPI()
        self.app.include_router(leave.router)
        self.app.dependency_overrides[get_db] = lambda: self.db
        self.app.dependency_overrides[get_current_user] = lambda: self.user
        self.client = TestClient(self.app)

    def tearDown(self):
        self.client.close()
        self.db.close()
        self.engine.dispose()

    def test_latest_approved_leave_is_ordered_first_for_same_date(self):
        # Đơn 1: Đăng ký lịch sinh viên tuần (được tạo & duyệt ngày 15/09)
        l1 = LeaveRequest(
            company_id=self.user.company_id,
            user_id=self.user.id,
            from_date=date(2026, 9, 18),
            to_date=date(2026, 9, 18),
            leave_type="AFTERNOON",
            reason="Đi học (Nghỉ chiều)",
            status=LeaveStatus.APPROVED,
            source="SCHEDULE",
            decided_at=datetime(2026, 9, 15, 8, 0, 0),
            created_at=datetime(2026, 9, 15, 8, 0, 0),
        )
        # Đơn 2: Đơn xin nghỉ phép đột xuất (được duyệt ngày 17/09)
        l2 = LeaveRequest(
            company_id=self.user.company_id,
            user_id=self.user.id,
            from_date=date(2026, 9, 18),
            to_date=date(2026, 9, 18),
            leave_type="MORNING",
            reason="ĐI HỌC",
            status=LeaveStatus.APPROVED,
            source="LEAVE",
            decided_at=datetime(2026, 9, 17, 16, 0, 0),
            created_at=datetime(2026, 9, 17, 9, 0, 0),
        )
        self.db.add_all([l1, l2])
        self.db.commit()

        resp = self.client.get("/leave/schedule?from_date=2026-09-18&to_date=2026-09-18")
        self.assertEqual(resp.status_code, 200)
        items = resp.json()
        self.assertEqual(len(items), 2)
        # Đơn được duyệt sau cùng (l2) phải xuất hiện trước đơn cũ (l1)
        self.assertEqual(items[0]["id"], l2.id)
        self.assertEqual(items[0]["leave_type"], "MORNING")
        self.assertEqual(items[1]["id"], l1.id)
        self.assertEqual(items[1]["leave_type"], "AFTERNOON")


if __name__ == "__main__":
    unittest.main()
