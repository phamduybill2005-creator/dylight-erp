"""The monthly personnel overview includes the viewer without allowing self-rating."""
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
from app.models import Attendance, Company, Evaluation, Project, Timesheet, User, UserRole
from app.routers.evaluations import router


class EvaluationOverviewSelfTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False}, poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        with self.sessions() as db:
            company = Company(name="Company", code="SELF-OVERVIEW")
            other = Company(name="Other", code="OTHER-OVERVIEW")
            db.add_all([company, other])
            db.flush()

            def person(name, role=UserRole.FIELD_STAFF, **extra):
                return User(company_id=extra.pop("company_id", company.id),
                            email=f"{name}@example.com", full_name=name,
                            hashed_password="unused", role=role,
                            department="Phòng AI", **extra)

            self.viewer = person("viewer", UserRole.DIRECTOR)
            self.director = person("director", UserRole.DIRECTOR)
            self.staff = person("staff")
            self.inactive = person("inactive", is_active=False)
            self.unapproved = person("unapproved", is_approved=False)
            self.foreign = person("foreign", company_id=other.id)
            db.add_all([self.viewer, self.director, self.staff, self.inactive,
                        self.unapproved, self.foreign])
            db.flush()
            project = Project(company_id=company.id, code="SELF", name="Project")
            db.add(project)
            db.flush()
            db.add_all([
                Attendance(company_id=company.id, user_id=self.viewer.id,
                           work_date=date(2026, 9, 15),
                           check_in=datetime(2026, 9, 15, 8, 30),
                           check_out=datetime(2026, 9, 15, 17, 30)),
                Timesheet(company_id=company.id, user_id=self.viewer.id,
                          project_id=project.id, work_date=date(2026, 9, 15), hours=3.5),
                Timesheet(company_id=company.id, user_id=self.viewer.id,
                          project_id=project.id, work_date=date(2026, 10, 1), hours=9),
            ])
            db.commit()
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_db] = self._db
        app.dependency_overrides[get_current_user] = lambda: self.viewer
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def _db(self):
        with self.sessions() as db:
            yield db

    def _overview(self):
        response = self.client.get("/evaluations/overview", params={
            "from_date": "2026-09-01", "to_date": "2026-09-30",
        })
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_viewer_is_visible_for_every_month_table_role(self):
        for role in [UserRole.DIRECTOR, UserRole.ADMIN, UserRole.MANAGER, UserRole.MANAGER_MID]:
            with self.subTest(role=role):
                self.viewer.role = role
                with self.sessions() as db:
                    db.get(User, self.viewer.id).role = role
                    db.commit()
                rows = {row["user_id"]: row for row in self._overview()}
                self.assertEqual(set(rows), {self.viewer.id, self.staff.id})
                self.assertEqual(rows[self.viewer.id]["full_name"], "viewer")
                self.assertEqual(rows[self.viewer.id]["role"], role.value)

    def test_own_row_contains_monthly_metrics(self):
        rows = {row["user_id"]: row for row in self._overview()}
        self.assertIn(self.viewer.id, rows)
        row = rows[self.viewer.id]
        self.assertEqual(row["office_hours"], 7.25)
        self.assertEqual(row["project_hours"], 3.5)
        self.assertEqual(row["late_days"], 1)
        self.assertIsNone(row["my_rating"])

    def test_self_rating_remains_rejected(self):
        response = self.client.post("/evaluations", json={
            "evaluatee_id": self.viewer.id, "eval_date": "2026-09-01", "rating": 5,
        })
        self.assertEqual(response.status_code, 400, response.text)
        with self.sessions() as db:
            self.assertEqual(db.query(Evaluation).count(), 0)


if __name__ == "__main__":
    unittest.main()
