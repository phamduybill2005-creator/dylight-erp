"""Kiểm thử endpoint /leave/approved (Tất cả các đơn đã duyệt theo tuần và tháng).

Chạy từ backend:
python -m unittest tests.test_leave_approved -v
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


class LeaveApprovedTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        self.db = self.sessions()

        self.company = Company(name="Test company", code="TEST")
        self.db.add(self.company)
        self.db.flush()

        self.user = User(
            company_id=self.company.id,
            email="staff@example.com",
            full_name="Nguyễn Văn A",
            role=UserRole.FIELD_STAFF,
            hashed_password="unused",
            department="Kỹ thuật",
        )
        self.approver = User(
            company_id=self.company.id,
            email="manager@example.com",
            full_name="Trần Quản Lý",
            role=UserRole.MANAGER,
            hashed_password="unused",
            department="Ban Quản lý",
        )
        self.director = User(
            company_id=self.company.id,
            email="director@example.com",
            full_name="Lê Giám Đốc",
            role=UserRole.DIRECTOR,
            hashed_password="unused",
            department="Ban Giám đốc",
        )
        self.admin = User(
            company_id=self.company.id,
            email="admin@example.com",
            full_name="Admin Hệ Thống",
            role=UserRole.ADMIN,
            hashed_password="unused",
            department="Hệ thống",
        )
        self.db.add_all([self.user, self.approver, self.director, self.admin])
        self.db.commit()

        self.current_user = self.director
        self.app = FastAPI()
        self.app.include_router(leave.router)
        self.app.dependency_overrides[get_db] = lambda: self.db
        self.app.dependency_overrides[get_current_user] = lambda: self.current_user
        self.client = TestClient(self.app)

    def tearDown(self):
        self.client.close()
        self.db.close()
        self.engine.dispose()

    def test_approved_leaves_by_week_filter(self):
        # Đơn 1: Trong tuần 14/09/2026 - 20/09/2026, APPROVED
        l1 = LeaveRequest(
            company_id=self.company.id,
            user_id=self.user.id,
            from_date=date(2026, 9, 15),
            to_date=date(2026, 9, 16),
            leave_type="FULL",
            reason="ỐM ĐAU",
            status=LeaveStatus.APPROVED,
            source="LEAVE",
            decided_by_id=self.approver.id,
            decided_at=datetime(2026, 9, 14, 10, 0),
        )
        # Đơn 2: Ngoài tuần đó (22/09/2026), APPROVED
        l2 = LeaveRequest(
            company_id=self.company.id,
            user_id=self.user.id,
            from_date=date(2026, 9, 22),
            to_date=date(2026, 9, 22),
            leave_type="MORNING",
            reason="VIỆC RIÊNG",
            status=LeaveStatus.APPROVED,
            source="LEAVE",
            decided_by_id=self.approver.id,
            decided_at=datetime(2026, 9, 21, 9, 0),
        )
        self.db.add_all([l1, l2])
        self.db.commit()

        # Lọc tuần 14 - 20/09
        resp = self.client.get("/leave/approved?from_date=2026-09-14&to_date=2026-09-20")
        self.assertEqual(resp.status_code, 200)
        items = resp.json()
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["reason"], "ỐM ĐAU")
        self.assertEqual(items[0]["user_name"], "Nguyễn Văn A")

    def test_approved_leaves_by_month_filter(self):
        # Đơn tháng 9
        l_sep = LeaveRequest(
            company_id=self.company.id,
            user_id=self.user.id,
            from_date=date(2026, 9, 10),
            to_date=date(2026, 9, 10),
            leave_type="FULL",
            reason="GIỖ TẾT",
            status=LeaveStatus.APPROVED,
            source="LEAVE",
            decided_by_id=self.approver.id,
            decided_at=datetime(2026, 9, 9, 15, 0),
        )
        # Đơn tháng 10
        l_oct = LeaveRequest(
            company_id=self.company.id,
            user_id=self.user.id,
            from_date=date(2026, 10, 5),
            to_date=date(2026, 10, 6),
            leave_type="FULL",
            reason="HỶ SỰ",
            status=LeaveStatus.APPROVED,
            source="LEAVE",
            decided_by_id=self.approver.id,
            decided_at=datetime(2026, 10, 4, 11, 0),
        )
        self.db.add_all([l_sep, l_oct])
        self.db.commit()

        # Lọc tháng 9/2026
        resp = self.client.get("/leave/approved?month=2026-09")
        self.assertEqual(resp.status_code, 200)
        items = resp.json()
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["reason"], "GIỖ TẾT")

        # Lọc tháng 10/2026
        resp_oct = self.client.get("/leave/approved?month=2026-10")
        self.assertEqual(resp_oct.status_code, 200)
        items_oct = resp_oct.json()
        self.assertEqual(len(items_oct), 1)
        self.assertEqual(items_oct[0]["reason"], "HỶ SỰ")

    def test_pending_rejected_and_schedule_excluded(self):
        # 1 APPROVED đơn thường
        l_ok = LeaveRequest(
            company_id=self.company.id,
            user_id=self.user.id,
            from_date=date(2026, 9, 18),
            to_date=date(2026, 9, 18),
            leave_type="FULL",
            reason="ỐM ĐAU",
            status=LeaveStatus.APPROVED,
            source="LEAVE",
        )
        # 1 PENDING
        l_pending = LeaveRequest(
            company_id=self.company.id,
            user_id=self.user.id,
            from_date=date(2026, 9, 18),
            to_date=date(2026, 9, 18),
            leave_type="FULL",
            reason="NGỦ QUÊN",
            status=LeaveStatus.PENDING,
            source="LEAVE",
        )
        # 1 REJECTED
        l_rejected = LeaveRequest(
            company_id=self.company.id,
            user_id=self.user.id,
            from_date=date(2026, 9, 18),
            to_date=date(2026, 9, 18),
            leave_type="FULL",
            reason="BIA RƯỢU",
            status=LeaveStatus.REJECTED,
            source="LEAVE",
        )
        # 1 APPROVED nhưng source=SCHEDULE (lịch sinh viên tự duyệt)
        l_schedule = LeaveRequest(
            company_id=self.company.id,
            user_id=self.user.id,
            from_date=date(2026, 9, 18),
            to_date=date(2026, 9, 18),
            leave_type="AFTERNOON",
            reason="Đi học (Nghỉ chiều)",
            status=LeaveStatus.APPROVED,
            source="SCHEDULE",
        )
        self.db.add_all([l_ok, l_pending, l_rejected, l_schedule])
        self.db.commit()

        resp = self.client.get("/leave/approved?month=2026-09")
        self.assertEqual(resp.status_code, 200)
        items = resp.json()
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["reason"], "ỐM ĐAU")

    def test_role_permissions_approved_leaves(self):
        # Nhân viên (FIELD_STAFF) -> 403 Forbidden
        self.app.dependency_overrides[get_current_user] = lambda: self.user
        resp_staff = self.client.get("/leave/approved")
        self.assertEqual(resp_staff.status_code, 403)

        # Quản lý (MANAGER) -> 403 Forbidden
        self.app.dependency_overrides[get_current_user] = lambda: self.approver
        resp_mgr = self.client.get("/leave/approved")
        self.assertEqual(resp_mgr.status_code, 403)

        # Giám đốc (DIRECTOR) -> 200 OK
        self.app.dependency_overrides[get_current_user] = lambda: self.director
        resp_dir = self.client.get("/leave/approved")
        self.assertEqual(resp_dir.status_code, 200)

        # Admin (ADMIN) -> 200 OK
        self.app.dependency_overrides[get_current_user] = lambda: self.admin
        resp_admin = self.client.get("/leave/approved")
        self.assertEqual(resp_admin.status_code, 200)


if __name__ == "__main__":
    unittest.main()

