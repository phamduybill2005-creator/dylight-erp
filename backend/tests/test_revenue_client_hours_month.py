"""Time khách hàng THEO THÁNG (tab Doanh thu: Customer (Month) / Customer (All)).

- PUT /projects/{id}/client-hours/{YYYY-MM}: chỉ Giám đốc; 0/None = xoá tháng đó;
  projects.client_hours luôn = tổng các tháng.
- GET /projects/revenue/client-hours: {project_id: {tháng: giờ}} cho dự án mình thấy.

Chạy từ thư mục backend: python -m unittest tests.test_revenue_client_hours_month -v
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
from app.models import Company, Project, ProjectClientHoursMonth, User, UserRole
from app.routers.projects import router


class RevenueClientHoursMonthTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        with self.sessions() as db:
            company = Company(name="Test company", code="TEST-CLIENT-HOURS")
            db.add(company)
            db.flush()
            self.company_id = company.id
            self.director = User(company_id=company.id, email="gd@example.com", full_name="Giam doc",
                                 role=UserRole.DIRECTOR, hashed_password="unused")
            self.admin = User(company_id=company.id, email="admin@example.com", full_name="Admin",
                              role=UserRole.ADMIN, hashed_password="unused")
            self.staff = User(company_id=company.id, email="nv@example.com", full_name="Nhan vien",
                              role=UserRole.FIELD_STAFF, hashed_password="unused")
            bando = Project(company_id=company.id, code="BD-01", name="Du an ban do", group_name="測量解析")
            other = Project(company_id=company.id, code="BIM-01", name="Du an BIM", group_name="3次元設計")
            db.add_all([self.director, self.admin, self.staff, bando, other])
            db.flush()
            bando.members.append(self.staff)
            self.bando_id, self.other_id = bando.id, other.id
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

    def _put(self, project_id, month, hours):
        return self.client.put(f"/projects/{project_id}/client-hours/{month}", json={"hours": hours})

    def _project_total(self, project_id):
        with self.sessions() as db:
            v = db.get(Project, project_id).client_hours
            return float(v) if v is not None else None

    def test_director_sets_months_and_total_follows(self):
        res = self._put(self.bando_id, "2026-10", 16)
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json(), {"project_id": self.bando_id, "month": "2026-10", "hours": 16.0, "total_hours": 16.0})
        res = self._put(self.bando_id, "2026-11", 8.5)
        self.assertEqual(res.json()["total_hours"], 24.5)
        self.assertEqual(self._project_total(self.bando_id), 24.5)
        got = self.client.get("/projects/revenue/client-hours").json()
        self.assertEqual(got[str(self.bando_id)], {"2026-10": 16.0, "2026-11": 8.5})

    def test_overwrite_and_clear_month(self):
        self._put(self.bando_id, "2026-10", 16)
        self.assertEqual(self._put(self.bando_id, "2026-10", 10).json()["total_hours"], 10.0)
        res = self._put(self.bando_id, "2026-10", 0)
        self.assertEqual(res.json()["hours"], None)
        self.assertEqual(res.json()["total_hours"], 0.0)
        self.assertIsNone(self._project_total(self.bando_id))
        self.assertEqual(self.client.get("/projects/revenue/client-hours").json(), {})

    def test_only_director_can_write_even_admin_is_refused(self):
        self.current = self.admin
        self.assertEqual(self._put(self.bando_id, "2026-10", 5).status_code, 403)
        self.current = self.staff
        self.assertEqual(self._put(self.bando_id, "2026-10", 5).status_code, 403)
        self.assertIsNone(self._project_total(self.bando_id))

    def test_rejects_bad_month_and_unknown_project(self):
        self.assertEqual(self._put(self.bando_id, "2026-13", 5).status_code, 400)
        self.assertEqual(self._put(self.bando_id, "2026-1", 5).status_code, 400)
        self.assertEqual(self._put(99999, "2026-10", 5).status_code, 404)

    def test_staff_only_reads_projects_they_can_view(self):
        self._put(self.bando_id, "2026-10", 4)
        self._put(self.other_id, "2026-10", 9)
        self.current = self.staff
        got = self.client.get("/projects/revenue/client-hours").json()
        self.assertEqual(set(got), {str(self.bando_id)})

    def test_legacy_row_counts_in_total(self):
        # Dòng tháng cũ (backfill) + Giám đốc nhập thêm tháng mới -> tổng cộng dồn.
        with self.sessions() as db:
            db.add(ProjectClientHoursMonth(company_id=self.company_id, project_id=self.bando_id, month="2026-09", hours=40))
            db.commit()
        res = self._put(self.bando_id, "2026-10", 8)
        self.assertEqual(res.json()["total_hours"], 48.0)


if __name__ == "__main__":
    unittest.main()
