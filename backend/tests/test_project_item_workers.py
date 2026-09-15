"""Persistence checks for people assigned to project items.

Run from backend: python -m unittest tests.test_project_item_workers -v
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


class ProjectItemWorkerTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)

        with self.sessions() as db:
            company = Company(name="Test company", code="TEST-WORKERS")
            db.add(company)
            db.flush()
            self.admin = User(
                company_id=company.id,
                email="admin-workers@example.com",
                full_name="Project admin",
                role=UserRole.ADMIN,
                hashed_password="unused",
            )
            worker = User(
                company_id=company.id,
                email="worker@example.com",
                full_name="Assigned worker",
                role=UserRole.FIELD_STAFF,
                hashed_password="unused",
            )
            project = Project(company_id=company.id, code="P-001", name="Test project")
            db.add_all([self.admin, worker, project])
            db.flush()
            project.members.append(worker)
            item = ProjectItem(
                company_id=company.id,
                project_id=project.id,
                name="Persistent task",
            )
            db.add(item)
            db.commit()
            self.project_id = project.id
            self.item_id = item.id
            self.worker_id = worker.id

        app = FastAPI()
        app.include_router(router)

        def fresh_db():
            with self.sessions() as db:
                yield db

        app.dependency_overrides[get_db] = fresh_db
        app.dependency_overrides[get_current_user] = lambda: self.admin
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        self.engine.dispose()

    def test_added_worker_is_returned_after_reload(self):
        added = self.client.post(
            f"/project-items/{self.item_id}/workers/{self.worker_id}"
        )
        self.assertEqual(added.status_code, 200, added.text)

        reloaded = self.client.get(
            "/project-items", params={"project_id": self.project_id}
        )
        self.assertEqual(reloaded.status_code, 200, reloaded.text)
        item = next(row for row in reloaded.json() if row["id"] == self.item_id)
        self.assertEqual(item["worker_ids"], [self.worker_id])


if __name__ == "__main__":
    unittest.main()
