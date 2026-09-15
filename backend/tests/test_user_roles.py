"""Role retirement checks, using only an isolated in-memory database.

Run from backend: python -m unittest discover -s tests -v
"""
import importlib
import os
import unittest
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite+pysqlite:///:memory:"
os.environ["DEBUG"] = "true"

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import seed
from app.database import Base, get_db
from app.deps import get_current_user
from app.models import Company, User, UserRole


class UserRoleTests(unittest.TestCase):
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
        self.admin = User(
            company_id=company.id, email="admin@example.com", full_name="Test admin",
            role=UserRole.ADMIN, hashed_password="unused",
        )
        self.db.add(self.admin)
        self.db.commit()
        self.current = self.admin
        self.app = FastAPI()
        # Import every router changed by role removal to catch missing enum references.
        for name in (
            "auth", "assignments", "attendance", "bids", "dashboard", "design_docs",
            "equipment", "evaluations", "invoices", "leave", "notifications",
            "projects", "timesheets",
        ):
            self.app.include_router(importlib.import_module(f"app.routers.{name}").router)
        self.app.dependency_overrides[get_db] = lambda: self.db
        self.app.dependency_overrides[get_current_user] = lambda: self.current
        self.client = TestClient(self.app)

    def tearDown(self):
        self.client.close()
        self.db.close()
        self.engine.dispose()

    def create_user(self, role):
        return self.client.post("/auth/users", json={
            "email": f"user-{role.lower()}@example.com", "full_name": "Test user", "role": role,
        })

    def test_retired_role_rejected_without_creating_a_user(self):
        before = self.db.query(User).count()
        response = self.create_user("ACCOUNTANT")
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(self.db.query(User).count(), before)

    def test_retired_role_rejected_without_changing_existing_user(self):
        created = self.create_user("FIELD_STAFF")
        self.assertEqual(created.status_code, 201, created.text)
        user_id = created.json()["id"]
        response = self.client.patch(f"/auth/users/{user_id}", json={"role": "ACCOUNTANT"})
        self.assertEqual(response.status_code, 422, response.text)
        self.db.expire_all()
        self.assertEqual(self.db.get(User, user_id).role, UserRole.FIELD_STAFF)

    def test_remaining_roles_can_be_created_and_assigned(self):
        for role in ("ADMIN", "DIRECTOR", "MANAGER", "MANAGER_MID", "FIELD_STAFF"):
            with self.subTest(role=role):
                created = self.create_user(role)
                self.assertEqual(created.status_code, 201, created.text)
                self.assertEqual(created.json()["role"], role)
                response = self.client.patch(
                    f"/auth/users/{created.json()['id']}", json={"role": "FIELD_STAFF"},
                )
                self.assertEqual(response.status_code, 200, response.text)
                response = self.client.patch(
                    f"/auth/users/{created.json()['id']}", json={"role": role},
                )
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()["role"], role)

    def test_invoice_permissions_remain_restricted(self):
        for role, expected in (
            ("ADMIN", 200), ("DIRECTOR", 200), ("MANAGER", 200),
            ("MANAGER_MID", 403), ("FIELD_STAFF", 403), ("ACCOUNTANT", 403),
        ):
            with self.subTest(role=role):
                self.current = User(id=900, company_id=self.admin.company_id, role=role)
                response = self.client.get("/invoices")
                self.assertEqual(response.status_code, expected, response.text)

    def test_openapi_only_advertises_remaining_roles(self):
        self.assertEqual(
            set(self.app.openapi()["components"]["schemas"]["UserRole"]["enum"]),
            {"ADMIN", "DIRECTOR", "MANAGER", "MANAGER_MID", "FIELD_STAFF"},
        )

    def test_seed_has_no_retired_account_and_keeps_manager_links(self):
        Base.metadata.drop_all(self.engine)
        with patch.object(seed, "engine", self.engine), patch.object(seed, "SessionLocal", self.sessions):
            seed.run()
        with self.sessions() as db:
            self.assertIsNone(db.query(User).filter(User.email == "ketoan@dosco.vn").first())
            self.assertEqual(db.query(User).count(), 4)
            staff = db.query(User).filter(User.email == "hientruong@dosco.vn").one()
            manager = db.get(User, staff.manager_id)
            self.assertEqual(manager.role, UserRole.MANAGER)
            self.assertEqual(db.get(User, manager.manager_id).role, UserRole.DIRECTOR)


if __name__ == "__main__":
    unittest.main()
