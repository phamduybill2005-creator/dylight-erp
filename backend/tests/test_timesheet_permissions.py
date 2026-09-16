"""Quyền SỬA SỐ GIỜ ở bảng Tiến độ theo đầu việc.

Luật (xem docstring app/routers/timesheets.py):
- Quản trị hệ thống / Giám đốc / Quản lý cấp cao -> sửa giờ mọi người, mọi đầu việc.
- Quản lý cấp trung trở xuống -> chỉ giờ CỦA MÌNH, chỉ trên đầu việc ĐƯỢC GIAO.

Chạy từ thư mục backend: python -m unittest tests.test_timesheet_permissions -v
"""
import os
import unittest
from datetime import date

os.environ["DATABASE_URL"] = "sqlite+pysqlite:///:memory:"
os.environ["DEBUG"] = "true"

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.deps import get_current_user
from app.models import Company, Project, ProjectItem, Timesheet, User, UserRole
from app.routers.timesheets import router


class TimesheetPermissionTests(unittest.TestCase):
    """Dựng 1 dự án có 2 đầu việc giao cho 2 người khác nhau, rồi thử từng vai trò."""

    def setUp(self):
        self.engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        self.work_date = date.today().isoformat()

        with self.sessions() as db:
            company = Company(name="Test company", code="TEST-TS-PERM")
            db.add(company)
            db.flush()
            self.company_id = company.id

            def mk(email: str, name: str, role: UserRole) -> User:
                return User(
                    company_id=company.id, email=email, full_name=name,
                    role=role, hashed_password="unused",
                )

            self.admin = mk("admin@example.com", "Quan tri", UserRole.ADMIN)
            self.director = mk("gd@example.com", "Giam doc", UserRole.DIRECTOR)
            self.senior = mk("qlcc@example.com", "QL cap cao", UserRole.MANAGER)
            # Cấp trung CÓ cấp dưới và KHÔNG có sếp bên trên: đúng kiểu từng bị
            # _is_senior_manager xếp nhầm vào cấp cao.
            self.mid = mk("qlct@example.com", "QL cap trung", UserRole.MANAGER_MID)
            self.staff_a = mk("a@example.com", "Nhan vien A", UserRole.FIELD_STAFF)
            self.staff_b = mk("b@example.com", "Nhan vien B", UserRole.FIELD_STAFF)
            project = Project(company_id=company.id, code="P-01", name="Du an test")
            db.add_all([
                self.admin, self.director, self.senior, self.mid,
                self.staff_a, self.staff_b, project,
            ])
            db.flush()
            self.staff_a.manager_id = self.mid.id

            for u in (self.admin, self.director, self.senior, self.mid,
                      self.staff_a, self.staff_b):
                project.members.append(u)
            self.project_id = project.id

            # item_a giao cho A, item_b giao cho B, item_free chưa giao cho ai.
            item_a = ProjectItem(company_id=company.id, project_id=project.id,
                                 name="Dau viec cua A", assignee_id=self.staff_a.id)
            item_b = ProjectItem(company_id=company.id, project_id=project.id,
                                 name="Dau viec cua B", assignee_id=self.staff_b.id)
            item_free = ProjectItem(company_id=company.id, project_id=project.id,
                                    name="Dau viec chua giao")
            db.add_all([item_a, item_b, item_free])
            db.flush()
            self.item_a, self.item_b, self.item_free = item_a.id, item_b.id, item_free.id
            db.commit()

        self.app = FastAPI()
        self.app.include_router(router)
        self.app.dependency_overrides[get_db] = self._override_db
        self.current = self.staff_a
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
        """Lấy lại User gắn vào session hiện tại (tránh DetachedInstanceError)."""
        with self.sessions() as db:
            return db.get(User, user.id)

    def _login(self, user: User) -> None:
        self.current = user

    def _post(self, item_id, hours=4, user_id=None):
        body = {
            "project_id": self.project_id,
            "project_item_id": item_id,
            "work_date": self.work_date,
            "hours": hours,
        }
        if user_id is not None:
            body["user_id"] = user_id
        return self.client.post("/timesheets", json=body)

    def _seed_hours(self, user: User, item_id: int, hours: float = 8) -> int:
        with self.sessions() as db:
            rec = Timesheet(
                company_id=self.company_id, user_id=user.id,
                project_id=self.project_id, project_item_id=item_id,
                work_date=date.fromisoformat(self.work_date), hours=hours,
            )
            db.add(rec)
            db.commit()
            return rec.id

    # --------- Nhân viên: được làm phần của mình ---------

    def test_staff_can_log_own_hours_on_assigned_item(self):
        self._login(self.staff_a)
        self.assertEqual(self._post(self.item_a).status_code, 200)

    def test_staff_can_log_own_hours_on_unassigned_item(self):
        """Đầu việc chưa giao cho ai thì không phải 'của người khác'."""
        self._login(self.staff_a)
        self.assertEqual(self._post(self.item_free).status_code, 200)

    def test_staff_can_log_own_hours_when_added_as_worker(self):
        """Được thêm vào 'người cùng làm' của đầu việc B thì khai giờ ở B được."""
        with self.sessions() as db:
            item = db.get(ProjectItem, self.item_b)
            item.workers.append(db.get(User, self.staff_a.id))
            db.commit()
        self._login(self.staff_a)
        self.assertEqual(self._post(self.item_b).status_code, 200)

    # --------- Nhân viên: bị chặn phần của người khác ---------

    def test_staff_cannot_log_on_another_persons_item(self):
        self._login(self.staff_a)
        resp = self._post(self.item_b)
        self.assertEqual(resp.status_code, 403)
        self.assertIn("không được giao đầu việc này", resp.json()["detail"])

    def test_staff_cannot_log_hours_for_another_person(self):
        """Kể cả trên chính đầu việc của mình, không khai hộ người khác được."""
        self._login(self.staff_a)
        resp = self._post(self.item_a, user_id=self.staff_b.id)
        self.assertEqual(resp.status_code, 403)
        self.assertIn("giờ của chính mình", resp.json()["detail"])

    def test_staff_cannot_log_hours_without_item(self):
        self._login(self.staff_a)
        resp = self._post(None)
        self.assertEqual(resp.status_code, 403)

    def test_staff_cannot_clear_another_persons_hours(self):
        self._seed_hours(self.staff_b, self.item_b)
        self._login(self.staff_a)
        resp = self.client.post("/timesheets/clear-worker", json={
            "project_id": self.project_id,
            "user_id": self.staff_b.id,
            "project_item_id": self.item_b,
        })
        self.assertEqual(resp.status_code, 403)

    def test_staff_cannot_wipe_whole_project_hours(self):
        """Không chỉ rõ đầu việc = quét sạch cả dự án -> chỉ cấp cao mới được."""
        self._seed_hours(self.staff_a, self.item_a)
        self._login(self.staff_a)
        resp = self.client.post("/timesheets/clear-worker", json={
            "project_id": self.project_id,
            "user_id": self.staff_a.id,
        })
        self.assertEqual(resp.status_code, 403)

    def test_staff_cannot_delete_another_persons_row(self):
        ts_id = self._seed_hours(self.staff_b, self.item_b)
        self._login(self.staff_a)
        resp = self.client.delete(f"/timesheets/{ts_id}")
        self.assertEqual(resp.status_code, 403)

    def test_staff_can_delete_own_row(self):
        ts_id = self._seed_hours(self.staff_a, self.item_a)
        self._login(self.staff_a)
        self.assertEqual(self.client.delete(f"/timesheets/{ts_id}").status_code, 204)

    # --------- Quản lý cấp trung: chặn y như nhân viên ---------

    def test_mid_manager_cannot_log_for_subordinate(self):
        """Cấp trung có cấp dưới, không có sếp bên trên -> vẫn KHÔNG được khai hộ."""
        self._login(self.mid)
        resp = self._post(self.item_a, user_id=self.staff_a.id)
        self.assertEqual(resp.status_code, 403)

    def test_mid_manager_cannot_log_on_another_persons_item(self):
        self._login(self.mid)
        self.assertEqual(self._post(self.item_a).status_code, 403)

    # --------- Cấp cao trở lên: toàn quyền ---------

    def test_senior_roles_can_log_for_anyone_on_any_item(self):
        for boss in (self.admin, self.director, self.senior):
            with self.subTest(role=boss.role.value):
                self._login(boss)
                resp = self._post(self.item_a, user_id=self.staff_b.id)
                self.assertEqual(resp.status_code, 200, resp.text)

    def test_senior_roles_can_clear_and_delete_others_hours(self):
        ts_id = self._seed_hours(self.staff_b, self.item_b)
        self._login(self.director)
        self.assertEqual(self.client.delete(f"/timesheets/{ts_id}").status_code, 204)

        self._seed_hours(self.staff_b, self.item_b)
        resp = self.client.post("/timesheets/clear-worker", json={
            "project_id": self.project_id,
            "user_id": self.staff_b.id,
            "project_item_id": self.item_b,
        })
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["deleted"], 1)


if __name__ == "__main__":
    unittest.main()
