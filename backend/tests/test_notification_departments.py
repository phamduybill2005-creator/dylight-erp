"""Department announcements select active members within the sender's company."""
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
from app.models import Company, Notification, User, UserRole
from app.routers.notifications import router


class DepartmentNotificationTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False}, poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        with self.sessions() as db:
            company = Company(name="Company", code="DEPT")
            other = Company(name="Other company", code="OTHER-DEPT")
            db.add_all([company, other])
            db.flush()

            def person(name, department=None, role=UserRole.FIELD_STAFF, **extra):
                return User(company_id=extra.pop("company_id", company.id),
                            email=f"{name}@example.com", full_name=name,
                            hashed_password="unused", role=role,
                            department=department, **extra)

            self.sender = person("sender", "Phòng BIM", UserRole.DIRECTOR)
            self.bim = person("bim", "Phòng BIM")
            self.multi = person("multi", "Phòng AI,  phòng   BIM ", UserRole.MANAGER)
            self.ai = person("ai", "Phòng AI")
            self.map = person("map", "Phòng Bản đồ")
            self.road = person("road", "Phòng Thiết kế đường 2D")
            self.similar = person("similar", "Phòng BIM mở rộng")
            self.inactive = person("inactive", "Phòng BIM", is_active=False)
            self.foreign = person("foreign", "Phòng BIM", company_id=other.id)
            self.unassigned = person("unassigned")
            db.add_all([self.sender, self.bim, self.multi, self.ai, self.map,
                        self.road, self.similar, self.inactive, self.foreign, self.unassigned])
            db.commit()

        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_db] = self._db
        app.dependency_overrides[get_current_user] = lambda: self.sender
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def _db(self):
        with self.sessions() as db:
            yield db

    def _send(self, department):
        return self.client.post("/notifications", json={
            "title": "Department announcement", "body": "Meeting tomorrow",
            "target": "DEPARTMENT", "target_department": department,
        })

    def _recipients(self):
        with self.sessions() as db:
            return {n.recipient_id for n in db.query(Notification).all()}

    def test_each_department_receives_only_its_active_members(self):
        for department, expected in [
            ("Phòng BIM", {self.bim.id, self.multi.id}),
            ("Phòng AI", {self.ai.id, self.multi.id}),
            ("Phòng Bản đồ", {self.map.id}),
            ("Phòng Thiết kế đường 2D", {self.road.id}),
        ]:
            with self.subTest(department=department):
                with self.sessions() as db:
                    db.query(Notification).delete()
                    db.commit()
                response = self._send(department)
                self.assertEqual(response.status_code, 201, response.text)
                self.assertEqual(response.json(), {"sent": len(expected)})
                self.assertEqual(self._recipients(), expected)
                with self.sessions() as db:
                    for notification in db.query(Notification).all():
                        self.assertEqual(notification.sender_id, self.sender.id)
                        self.assertEqual(notification.title, "Department announcement")
                        self.assertEqual(notification.body, "Meeting tomorrow")

    def test_management_roles_can_send(self):
        for role in [UserRole.ADMIN, UserRole.MANAGER, UserRole.MANAGER_MID]:
            with self.subTest(role=role):
                self.sender.role = role
                response = self._send("Phòng BIM")
                self.assertEqual(response.status_code, 201, response.text)

    def test_staff_cannot_send_department_announcements(self):
        self.sender.role = UserRole.FIELD_STAFF
        response = self._send("Phòng BIM")
        self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(self._recipients(), set())

    def test_missing_or_empty_department_is_rejected(self):
        for department in [None, "", "   "]:
            with self.subTest(department=department):
                response = self._send(department)
                self.assertEqual(response.status_code, 400, response.text)
                self.assertIn("Chưa chọn phòng ban", response.json()["detail"])
        self.assertEqual(self._recipients(), set())

    def test_empty_department_has_no_recipients(self):
        response = self._send("Phòng không có người")
        self.assertEqual(response.status_code, 400, response.text)
        self.assertIn("Không có người nhận", response.json()["detail"])
        self.assertEqual(self._recipients(), set())

    def test_existing_everyone_target_still_works(self):
        response = self.client.post("/notifications", json={
            "title": "Everyone", "target": "EVERYONE",
        })
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(self._recipients(), {
            self.bim.id, self.multi.id, self.ai.id, self.map.id,
            self.road.id, self.similar.id, self.unassigned.id,
        })


if __name__ == "__main__":
    unittest.main()
