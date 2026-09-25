"""Thông báo cho đơn nghỉ phép.

- Nhân viên gửi đơn -> báo cho Giám đốc / Quản trị hệ thống / Quản lý cấp cao
  (và CHỈ 3 cấp đó; quản lý cấp trung và nhân viên khác không nhận).
- Duyệt / từ chối -> báo lại cho chính người làm đơn.

Chạy từ thư mục backend: python -m unittest tests.test_leave_notifications -v
"""
import os
import unittest
from datetime import date, timedelta

os.environ["DATABASE_URL"] = "sqlite+pysqlite:///:memory:"
os.environ["DEBUG"] = "true"

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.deps import get_current_user
from app.models import Company, LeaveRequest, LeaveStatus, Notification, User, UserRole
from app.routers.leave import router


class LeaveNotificationTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        # Đơn phải gửi trước 19h ngày N-1 -> xin nghỉ cho ngày kia cho chắc.
        self.ngay_nghi = date.today() + timedelta(days=2)

        with self.sessions() as db:
            company = Company(name="Test company", code="TEST-LEAVE-NOTI")
            db.add(company)
            db.flush()
            self.company_id = company.id

            def mk(email, name, role, **kw):
                return User(company_id=company.id, email=email, full_name=name,
                            role=role, hashed_password="unused", **kw)

            self.admin = mk("admin@example.com", "Quan tri", UserRole.ADMIN)
            self.director = mk("gd@example.com", "Giam doc", UserRole.DIRECTOR)
            self.senior = mk("qlcc@example.com", "QL cap cao", UserRole.MANAGER)
            self.mid = mk("qlct@example.com", "QL cap trung", UserRole.MANAGER_MID)
            self.staff = mk("hoa@example.com", "N.V.HOA", UserRole.FIELD_STAFF)
            self.other = mk("khac@example.com", "Nguoi khac", UserRole.FIELD_STAFF)
            self.locked = mk("nghi@example.com", "Da nghi viec", UserRole.MANAGER,
                             is_active=False)
            db.add_all([self.admin, self.director, self.senior, self.mid,
                        self.staff, self.other, self.locked])
            db.commit()

        self.app = FastAPI()
        self.app.include_router(router)
        self.app.dependency_overrides[get_db] = self._override_db
        self.current = self.staff
        self.app.dependency_overrides[get_current_user] = lambda: self._reload(self.current)
        self.client = TestClient(self.app)

    def tearDown(self):
        self.client.close()
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def _override_db(self):
        db = self.sessions()
        try:
            yield db
        finally:
            db.close()

    def _reload(self, user):
        with self.sessions() as db:
            return db.get(User, user.id)

    def _notis(self, recipient=None):
        with self.sessions() as db:
            q = db.query(Notification).order_by(Notification.id)
            if recipient is not None:
                q = q.filter(Notification.recipient_id == recipient.id)
            return q.all()

    def _gui_don(self, leave_type="FULL", reason="Việc gia đình", to_date=None):
        resp = self.client.post("/leave", json={
            "from_date": self.ngay_nghi.isoformat(),
            "to_date": (to_date or self.ngay_nghi).isoformat(),
            "leave_type": leave_type,
            "reason": reason,
        })
        self.assertEqual(resp.status_code, 201, resp.text)
        return resp.json()["id"]

    # --------- Gửi đơn ---------

    def test_new_leave_notifies_only_top_leadership(self):
        self.current = self.staff
        self._gui_don()

        nhan = {n.recipient_id for n in self._notis()}
        self.assertEqual(nhan, {self.admin.id, self.director.id, self.senior.id})
        # Cấp trung, đồng nghiệp, người đã khóa tài khoản: KHÔNG nhận.
        for u in (self.mid, self.other, self.locked, self.staff):
            self.assertNotIn(u.id, nhan, u.full_name)

    def test_new_leave_content_names_the_person_and_dates(self):
        self.current = self.staff
        self._gui_don()
        n = self._notis(self.director)[0]
        self.assertEqual(n.title, "N.V.HOA xin nghỉ phép")
        self.assertIn(f"N.V.HOA xin nghỉ phép: nghỉ cả ngày ({self.ngay_nghi:%d/%m/%Y})", n.body)
        self.assertIn("Lý do: Việc gia đình", n.body)
        self.assertIn("Vào mục Nghỉ phép để duyệt đơn.", n.body)
        self.assertEqual(n.sender_id, self.staff.id)

    def test_late_request_is_worded_as_late_not_leave(self):
        self.current = self.staff
        self._gui_don(leave_type="LATE_MORNING")
        n = self._notis(self.director)[0]
        self.assertEqual(n.title, "N.V.HOA xin đi muộn")
        self.assertIn("đi muộn buổi sáng", n.body)

    def test_leader_requesting_leave_does_not_notify_himself(self):
        self.current = self.senior
        self._gui_don()
        nhan = {n.recipient_id for n in self._notis()}
        self.assertEqual(nhan, {self.admin.id, self.director.id})

    def test_multi_day_leave_shows_date_range(self):
        self.current = self.staff
        self._gui_don(to_date=self.ngay_nghi + timedelta(days=2))
        n = self._notis(self.director)[0]
        self.assertIn(f"{self.ngay_nghi:%d/%m/%Y} – {self.ngay_nghi + timedelta(days=2):%d/%m/%Y}", n.body)

    # --------- Duyệt / từ chối ---------

    def test_approval_notifies_the_requester(self):
        self.current = self.staff
        leave_id = self._gui_don()
        self.current = self.director
        resp = self.client.post(f"/leave/{leave_id}/decide", json={"status": "APPROVED"})
        self.assertEqual(resp.status_code, 200, resp.text)

        [n] = self._notis(self.staff)
        self.assertEqual(n.title, "Đơn nghỉ phép đã được duyệt")
        self.assertIn("đã được Giam doc duyệt", n.body)
        self.assertIn(f"{self.ngay_nghi:%d/%m/%Y}", n.body)
        self.assertEqual(n.sender_id, self.director.id)

    def test_rejection_notifies_the_requester_too(self):
        self.current = self.staff
        leave_id = self._gui_don()
        self.current = self.director
        self.client.post(f"/leave/{leave_id}/decide", json={"status": "REJECTED"})

        [n] = self._notis(self.staff)
        self.assertEqual(n.title, "Đơn nghỉ phép bị từ chối")
        self.assertIn("bị Giam doc từ chối", n.body)

    def test_decision_does_not_spam_leadership_again(self):
        self.current = self.staff
        leave_id = self._gui_don()
        truoc = len(self._notis())
        self.current = self.director
        self.client.post(f"/leave/{leave_id}/decide", json={"status": "APPROVED"})
        # Chỉ thêm đúng 1 thông báo (cho người làm đơn).
        self.assertEqual(len(self._notis()), truoc + 1)

    def test_leader_approving_own_leave_gets_no_notification(self):
        self.current = self.senior
        leave_id = self._gui_don()
        truoc = len(self._notis())
        resp = self.client.post(f"/leave/{leave_id}/decide", json={"status": "APPROVED"})
        self.assertEqual(resp.status_code, 200, resp.text)
        self.assertEqual(len(self._notis()), truoc)
        self.assertEqual(self._notis(self.senior), [])

    # --------- Không được làm hỏng nghiệp vụ chính ---------

    def test_leave_is_saved_even_if_nobody_can_be_notified(self):
        """Công ty không có ai thuộc 3 cấp lãnh đạo -> đơn vẫn phải lưu."""
        with self.sessions() as db:
            for u in (self.admin, self.director, self.senior):
                db.get(User, u.id).is_active = False
            db.commit()
        self.current = self.staff
        leave_id = self._gui_don()
        with self.sessions() as db:
            rec = db.get(LeaveRequest, leave_id)
            self.assertIsNotNone(rec)
            self.assertEqual(rec.status, LeaveStatus.PENDING)
        self.assertEqual(self._notis(), [])


if __name__ == "__main__":
    unittest.main()
