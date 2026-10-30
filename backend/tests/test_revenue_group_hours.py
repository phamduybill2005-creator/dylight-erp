"""Giờ realtime gom theo NHÓM HẠNG MỤC từng dự án (GET /projects/revenue/group-hours)
— nguồn cho 9 cột Phòng Bản đồ ở tab Doanh thu.

Chạy từ thư mục backend: python -m unittest tests.test_revenue_group_hours -v
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
from app.routers.projects import router


class RevenueGroupHoursTests(unittest.TestCase):
    """1 dự án theo mẫu Bản đồ: nhóm Ortho có 1 đầu việc con, nhóm RIEGL có 2 đầu việc con,
    nhóm TD-TN chưa có đầu việc con; thêm 1 dự án của phòng khác mà nhân viên không thấy."""

    def setUp(self):
        self.engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)

        with self.sessions() as db:
            company = Company(name="Test company", code="TEST-GROUP-HOURS")
            db.add(company)
            db.flush()
            self.company_id = company.id

            self.director = User(company_id=company.id, email="gd@example.com", full_name="Giam doc",
                                 role=UserRole.DIRECTOR, hashed_password="unused")
            self.staff = User(company_id=company.id, email="nv@example.com", full_name="Nhan vien",
                              role=UserRole.FIELD_STAFF, hashed_password="unused")
            bando = Project(company_id=company.id, code="BD-01", name="Du an ban do", group_name="測量解析")
            other = Project(company_id=company.id, code="BIM-01", name="Du an BIM", group_name="3次元設計")
            db.add_all([self.director, self.staff, bando, other])
            db.flush()
            bando.members.append(self.staff)
            self.bando_id, self.other_id = bando.id, other.id

            def item(project_id, name, parent_id=None, is_deleted=False):
                it = ProjectItem(company_id=company.id, project_id=project_id, name=name,
                                 parent_id=parent_id, is_deleted=is_deleted)
                db.add(it)
                db.flush()
                return it.id

            ortho = item(bando.id, "Ortho")
            self.ortho_child = item(bando.id, "Ortho _ Ảnh trực giao", ortho)
            riegl = item(bando.id, "RIEGL")
            self.riegl_a = item(bando.id, "RIEGL _ Quản lý chất lượng", riegl)
            self.riegl_b = item(bando.id, "RIEGL _ Bay quét", riegl)
            self.riegl_deleted = item(bando.id, "RIEGL _ Đã xóa", riegl, is_deleted=True)
            self.tdtn = item(bando.id, "TD-TN")                     # nhóm cha chưa có con
            other_group = item(other.id, "Ortho")
            self.other_child = item(other.id, "Ortho BIM", other_group)
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

    def _hours(self, project_id, item_id, hours, day="2026-10-15", user=None):
        with self.sessions() as db:
            db.add(Timesheet(
                company_id=self.company_id, user_id=(user or self.staff).id, project_id=project_id,
                project_item_id=item_id, work_date=date.fromisoformat(day), hours=hours,
            ))
            db.commit()

    def _get(self, **params):
        res = self.client.get("/projects/revenue/group-hours", params=params)
        self.assertEqual(res.status_code, 200, res.text)
        return res.json()

    def test_sums_child_hours_into_parent_group_and_keeps_childless_parent(self):
        self._hours(self.bando_id, self.ortho_child, 4)
        self._hours(self.bando_id, self.ortho_child, 2.5, day="2026-10-16")
        self._hours(self.bando_id, self.riegl_a, 3)
        self._hours(self.bando_id, self.riegl_b, 1)
        self._hours(self.bando_id, self.tdtn, 8)
        out = self._get()
        self.assertEqual(out[str(self.bando_id)], {"Ortho": 6.5, "RIEGL": 4.0, "TD-TN": 8.0})

    def test_ignores_deleted_items_and_project_level_hours(self):
        self._hours(self.bando_id, self.riegl_deleted, 5)
        self._hours(self.bando_id, None, 7)
        self._hours(self.bando_id, self.riegl_a, 1)
        self.assertEqual(self._get()[str(self.bando_id)], {"RIEGL": 1.0})

    def test_filters_by_date_range_like_month_filter(self):
        self._hours(self.bando_id, self.ortho_child, 4, day="2026-09-30")
        self._hours(self.bando_id, self.ortho_child, 2, day="2026-10-01")
        self._hours(self.bando_id, self.ortho_child, 1, day="2026-11-01")
        out = self._get(from_date="2026-10-01", to_date="2026-10-31")
        self.assertEqual(out[str(self.bando_id)], {"Ortho": 2.0})

    def test_staff_only_sees_projects_they_can_view(self):
        self._hours(self.bando_id, self.ortho_child, 4)
        self._hours(self.other_id, self.other_child, 9, user=self.director)
        self.current = self.director
        self.assertEqual(set(self._get()), {str(self.bando_id), str(self.other_id)})
        self.current = self.staff
        self.assertEqual(set(self._get()), {str(self.bando_id)})


if __name__ == "__main__":
    unittest.main()
