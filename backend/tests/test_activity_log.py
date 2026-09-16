"""Nhật ký hoạt động: các thao tác quan trọng phải được ghi, bằng tiếng Việt.

Nguyên tắc (app/audit.py): ghi việc XÓA dữ liệu, ĐỔI QUYỀN truy cập, SỬA SỐ LIỆU
CỦA NGƯỜI KHÁC. Không ghi việc tự khai giờ của chính mình.

Chạy từ thư mục backend: python -m unittest tests.test_activity_log -v
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
from app.models import (
    ActivityLog, Attendance, Company, Project, ProjectItem, Timesheet, User, UserRole,
)
from app.routers import archive, attendance, audit, auth, project_items, projects, timesheets


class ActivityLogTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        self.today = date.today()

        with self.sessions() as db:
            company = Company(name="Test company", code="TEST-AUDIT")
            db.add(company)
            db.flush()
            self.company_id = company.id

            def mk(email, name, role):
                return User(company_id=company.id, email=email, full_name=name,
                            role=role, hashed_password="unused")

            self.director = mk("gd@example.com", "Giam doc", UserRole.DIRECTOR)
            self.staff = mk("hoa@example.com", "N.V.HOA", UserRole.FIELD_STAFF)
            self.victim = mk("xoa@example.com", "Nguoi bi xoa", UserRole.FIELD_STAFF)
            db.add_all([self.director, self.staff, self.victim])
            db.flush()

            project = Project(company_id=company.id, code="DA002", name="Dosco AI",
                              lead_id=self.director.id)
            db.add(project)
            db.flush()
            project.members.append(db.get(User, self.staff.id))
            self.project_id = project.id

            item = ProjectItem(company_id=company.id, project_id=project.id,
                               name="Do ve tuyen", assignee_id=self.staff.id)
            db.add(item)
            db.flush()
            self.item_id = item.id

            # Thứ Hai, vào 10:30 -> tự tính là ĐI MUỘN.
            att = Attendance(company_id=company.id, user_id=self.staff.id,
                             work_date=date(2026, 9, 14),
                             check_in=datetime(2026, 9, 14, 10, 30))
            db.add(att)
            db.flush()
            self.att_id = att.id
            db.commit()

        self.app = FastAPI()
        for r in (archive, attendance, audit, auth, project_items, projects, timesheets):
            self.app.include_router(r.router)
        self.app.dependency_overrides[get_db] = self._override_db
        self.current = self.director
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

    def _logs(self, action=None):
        with self.sessions() as db:
            q = db.query(ActivityLog).order_by(ActivityLog.id)
            if action:
                q = q.filter(ActivityLog.action == action)
            return q.all()

    def _hours(self, hours, user_id=None):
        body = {"project_id": self.project_id, "project_item_id": self.item_id,
                "work_date": self.today.isoformat(), "hours": hours}
        if user_id is not None:
            body["user_id"] = user_id
        resp = self.client.post("/timesheets", json=body)
        self.assertEqual(resp.status_code, 200, resp.text)

    # --------- Giờ công ---------

    def test_editing_someone_elses_hours_logs_old_and_new_value(self):
        self.current = self.director
        self._hours(8, user_id=self.staff.id)
        self._hours(6, user_id=self.staff.id)
        self._hours(0, user_id=self.staff.id)

        details = [l.detail for l in self._logs("timesheet.edit_other")]
        self.assertEqual(len(details), 3)
        self.assertTrue(details[0].startswith("N.V.HOA · DA002 · \"Do ve tuyen\""), details[0])
        self.assertTrue(details[0].endswith("trống → 8h"), details[0])
        self.assertTrue(details[1].endswith("8h → 6h"), details[1])
        self.assertTrue(details[2].endswith("6h → xóa"), details[2])

    def test_saving_same_value_again_does_not_log(self):
        self.current = self.director
        self._hours(8, user_id=self.staff.id)
        self._hours(8, user_id=self.staff.id)
        self.assertEqual(len(self._logs("timesheet.edit_other")), 1)

    def test_logging_own_hours_is_not_logged(self):
        self.current = self.staff
        self._hours(8)
        self._hours(7)
        self.assertEqual(self._logs(), [])

    def test_clearing_someone_elses_hours_is_logged(self):
        self.current = self.director
        self._hours(8, user_id=self.staff.id)
        resp = self.client.post("/timesheets/clear-worker", json={
            "project_id": self.project_id, "user_id": self.staff.id,
            "project_item_id": self.item_id,
        })
        self.assertEqual(resp.status_code, 200, resp.text)
        [log] = self._logs("timesheet.clear_other")
        self.assertIn("xóa 1 dòng (8h)", log.detail)

    # --------- Tài khoản ---------

    def test_role_change_is_logged_but_profile_edit_is_not(self):
        self.current = self.director
        self.client.patch(f"/auth/users/{self.staff.id}", json={"phone": "0900000000"})
        self.assertEqual(self._logs(), [])

        resp = self.client.patch(f"/auth/users/{self.staff.id}", json={"role": "MANAGER_MID"})
        self.assertEqual(resp.status_code, 200, resp.text)
        [log] = self._logs("user.role_change")
        self.assertEqual(log.detail, "N.V.HOA: Nhân viên → Quản lý cấp trung")

    def test_lock_and_unlock_are_logged(self):
        self.current = self.director
        self.client.patch(f"/auth/users/{self.staff.id}", json={"is_active": False})
        self.client.patch(f"/auth/users/{self.staff.id}", json={"is_active": True})
        self.assertEqual([l.action for l in self._logs()], ["user.lock", "user.unlock"])

    def test_reset_password_is_logged_without_the_password(self):
        self.current = self.director
        resp = self.client.post(f"/auth/users/{self.staff.id}/reset-password",
                                json={"new_password": "MatKhauMoi@2026"})
        self.assertEqual(resp.status_code, 204, resp.text)
        [log] = self._logs("user.reset_password")
        self.assertEqual(log.detail, "N.V.HOA")
        self.assertNotIn("MatKhauMoi", log.detail)

    def test_deleting_account_keeps_name_in_log(self):
        self.current = self.director
        resp = self.client.delete(f"/auth/users/{self.victim.id}")
        self.assertEqual(resp.status_code, 204, resp.text)
        [log] = self._logs("user.delete")
        self.assertEqual(log.detail, "Nguoi bi xoa (xoa@example.com) · Nhân viên")

    # --------- Dự án, hạng mục, thùng rác ---------

    def test_delete_project_then_purge_both_logged(self):
        self.current = self.director
        self.assertEqual(self.client.delete(f"/projects/{self.project_id}").status_code, 204)
        self.assertEqual(
            self.client.delete(f"/archive/purge-project/{self.project_id}").status_code, 200
        )
        self.assertEqual([l.action for l in self._logs()],
                         ["project.delete", "archive.purge_project"])
        purge = self._logs("archive.purge_project")[0]
        self.assertEqual(purge.detail, "DA002 – Dosco AI · kèm 1 hạng mục")

    def test_removing_worker_with_hours_logs_hours_lost(self):
        self.current = self.director
        with self.sessions() as db:
            item = db.get(ProjectItem, self.item_id)
            helper = db.get(User, self.victim.id)
            item.workers.append(helper)
            db.add(Timesheet(company_id=self.company_id, user_id=helper.id,
                             project_id=self.project_id, project_item_id=self.item_id,
                             work_date=self.today, hours=4))
            db.commit()
        resp = self.client.delete(f"/project-items/{self.item_id}/workers/{self.victim.id}")
        self.assertEqual(resp.status_code, 200, resp.text)
        [log] = self._logs("project_item.remove_worker")
        self.assertEqual(log.detail, 'Nguoi bi xoa khỏi "Do ve tuyen" · DA002 · xóa kèm 4h')

    # --------- Chấm công ---------

    def test_late_override_logged_but_note_only_is_not(self):
        self.current = self.director
        self.client.put(f"/attendance/{self.att_id}", json={"note": "tắc đường"})
        self.assertEqual(self._logs(), [])

        resp = self.client.put(f"/attendance/{self.att_id}", json={"is_late_override": False})
        self.assertEqual(resp.status_code, 200, resp.text)
        [log] = self._logs("attendance.late_override")
        self.assertEqual(log.detail, "N.V.HOA · 14/09/2026: tính đi muộn → không tính đi muộn")

    # --------- Trang nhật ký: nhãn tiếng Việt ---------

    def test_audit_api_returns_vietnamese_labels_for_new_and_old_codes(self):
        with self.sessions() as db:
            for code in ("leave.approved", "user.delete", "ma.chua.co.nhan"):
                db.add(ActivityLog(company_id=self.company_id, user_id=self.director.id,
                                   action=code, entity_type="leave_request", entity_id=7))
            db.commit()
        self.current = self.director
        resp = self.client.get("/audit")
        self.assertEqual(resp.status_code, 200, resp.text)
        labels = {row["action"]: row["action_label"] for row in resp.json()}
        self.assertEqual(labels["leave.approved"], "Duyệt đơn nghỉ")   # dòng ghi từ trước
        self.assertEqual(labels["user.delete"], "Xóa tài khoản")
        self.assertEqual(labels["ma.chua.co.nhan"], "ma.chua.co.nhan")  # chưa có nhãn: giữ mã
        self.assertEqual(resp.json()[0]["entity_label"], "Đơn nghỉ")

    def test_staff_cannot_read_audit_log(self):
        self.current = self.staff
        self.assertEqual(self.client.get("/audit").status_code, 403)


if __name__ == "__main__":
    unittest.main()
