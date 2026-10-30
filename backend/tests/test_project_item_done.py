"""Ai được tick / bỏ tick "Đã xong" (done_date) ở đầu việc — PATCH /project-items/{id}.

Luật: người ĐƯỢC GIAO đầu việc, hoặc lãnh đạo được sửa giờ mọi người
(Quản trị hệ thống / Giám đốc / Quản lý cấp cao — timesheets.can_edit_all_hours).
Cấp trung / nhân viên khác thì không, kể cả là thành viên dự án.

Chạy từ thư mục backend: python -m unittest tests.test_project_item_done -v
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
from app.models import Company, Project, ProjectItem, User, UserRole
from app.routers.project_items import router


class ProjectItemDoneTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)

        with self.sessions() as db:
            company = Company(name="Test company", code="TEST-DONE")
            db.add(company)
            db.flush()

            def mk(email, name, role):
                return User(company_id=company.id, email=email, full_name=name,
                            role=role, hashed_password="unused")

            self.admin = mk("admin@example.com", "Quan tri", UserRole.ADMIN)
            self.director = mk("gd@example.com", "Giam doc", UserRole.DIRECTOR)
            self.senior = mk("qlcc@example.com", "QL cap cao", UserRole.MANAGER)
            self.mid = mk("qlct@example.com", "QL cap trung", UserRole.MANAGER_MID)
            self.staff_a = mk("a@example.com", "Nhan vien A", UserRole.FIELD_STAFF)
            self.staff_b = mk("b@example.com", "Nhan vien B", UserRole.FIELD_STAFF)
            project = Project(company_id=company.id, code="P-01", name="Du an test")
            db.add_all([self.admin, self.director, self.senior, self.mid,
                        self.staff_a, self.staff_b, project])
            db.flush()
            # Admin / Giám đốc / QL cấp cao KHÔNG là thành viên: lãnh đạo vẫn thấy mọi dự án.
            for u in (self.mid, self.staff_a, self.staff_b):
                project.members.append(u)

            item_a = ProjectItem(company_id=company.id, project_id=project.id,
                                 name="Dau viec cua A", assignee_id=self.staff_a.id)
            item_free = ProjectItem(company_id=company.id, project_id=project.id,
                                    name="Dau viec chua giao")
            db.add_all([item_a, item_free])
            db.commit()
            self.item_a, self.item_free = item_a.id, item_free.id

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

    def _reload(self, user):
        with self.sessions() as db:
            return db.get(User, user.id)

    def _tick(self, item_id, done="2026-10-30"):
        return self.client.patch(f"/project-items/{item_id}", json={"done_date": done})

    def test_assignee_can_tick_and_untick(self):
        self.current = self.staff_a
        self.assertEqual(self._tick(self.item_a).status_code, 200)
        self.assertEqual(self._tick(self.item_a, None).status_code, 200)

    def test_other_member_cannot_tick(self):
        self.current = self.staff_b
        self.assertEqual(self._tick(self.item_a).status_code, 403)

    def test_mid_manager_cannot_tick_others_item(self):
        self.current = self.mid
        self.assertEqual(self._tick(self.item_a).status_code, 403)

    def test_top_leadership_can_tick_and_untick_any_item(self):
        for leader in (self.admin, self.director, self.senior):
            self.current = leader
            self.assertEqual(self._tick(self.item_a).status_code, 200, leader.email)
            self.assertEqual(self._tick(self.item_a, None).status_code, 200, leader.email)
            # Đầu việc chưa giao ai: trước đây không ai tick được; lãnh đạo nay tick được.
            self.assertEqual(self._tick(self.item_free).status_code, 200, leader.email)
            self.assertEqual(self._tick(self.item_free, None).status_code, 200, leader.email)

    def test_nobody_else_can_tick_unassigned_item(self):
        self.current = self.staff_a
        self.assertEqual(self._tick(self.item_free).status_code, 403)


if __name__ == "__main__":
    unittest.main()
