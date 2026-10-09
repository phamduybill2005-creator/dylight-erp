"""Manual announcement delivery: real database/services, mocked external HTTP only."""
import importlib
import json
import os
import unittest
from datetime import timedelta
from unittest.mock import patch
from urllib.parse import parse_qs

os.environ["DATABASE_URL"] = "sqlite+pysqlite:///:memory:"
os.environ["DEBUG"] = "true"
os.environ["ZALO_ENABLED"] = "false"

import httpx
from cryptography.fernet import Fernet
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import Settings
from app.database import Base, get_db
from app.deps import get_current_user
from app.models import Company, Notification, User, UserRole
from app.routers import notifications
from app.services.zalo_oauth_service import ZaloOAuthService
from app.services.zalo_repository import utc_now
from app.zalo_models import ZaloOACredential


class NotificationZaloTests(unittest.TestCase):
    def setUp(self):
        try:
            module = importlib.import_module("app.services.notification_zalo_service")
        except ModuleNotFoundError:
            self.fail("Announcement Zalo delivery service is not implemented")
        self.engine = create_engine("sqlite+pysqlite:///:memory:", poolclass=StaticPool,
                                    connect_args={"check_same_thread": False})
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        self.db = self.sessions()
        company = Company(name="Test company", code="ANNOUNCE")
        self.db.add(company)
        self.db.flush()
        self.sender = User(company_id=company.id, role=UserRole.DIRECTOR,
                           email="sender@example.com", full_name="Người gửi ERP", hashed_password="unused")
        self.staff = User(company_id=company.id, role=UserRole.FIELD_STAFF, department="Phòng BIM",
                          email="staff@example.com", full_name="Staff", hashed_password="unused")
        self.manager = User(company_id=company.id, role=UserRole.MANAGER, department="Phòng BIM",
                            email="manager@example.com", full_name="Manager", hashed_password="unused")
        self.db.add_all([self.sender, self.staff, self.manager])
        self.db.commit()
        self.config = Settings(_env_file=None, ZALO_ENABLED=True, ZALO_APP_ID="123456",
                               ZALO_APP_SECRET="synthetic-app-secret", ZALO_OA_ID="987654",
                               ZALO_COMPANY_ID=company.id, ZALO_TOKEN_ENCRYPTION_KEY=Fernet.generate_key().decode(),
                               ZALO_GMF_GROUP_ID="978226075868b136e879")
        self.requests = []
        self.handler = self.respond
        self.http = httpx.Client(transport=httpx.MockTransport(self.dispatch))
        self.oauth = ZaloOAuthService(self.db, self.config, self.http)
        repo = self.oauth.repository()
        self.credential = ZaloOACredential(company_id=company.id, oa_id=self.config.ZALO_OA_ID,
                                           app_id=self.config.ZALO_APP_ID,
                                           **repo._token_values("synthetic-access", "synthetic-refresh",
                                                                utc_now() + timedelta(hours=1)))
        self.db.add(self.credential)
        self.db.commit()
        self.commits = 0
        event.listen(self.db, "after_commit", self.committed)
        self.service = module.NotificationZaloService(self.oauth)
        app = FastAPI()
        app.include_router(notifications.router)
        app.dependency_overrides[get_db] = lambda: self.db
        app.dependency_overrides[get_current_user] = lambda: self.sender
        app.dependency_overrides[notifications.get_notification_zalo_service] = lambda: self.service
        self.client = TestClient(app, raise_server_exceptions=False)

    def tearDown(self):
        if hasattr(self, "client"):
            self.client.close()
            self.http.close()
            self.db.close()
            self.engine.dispose()

    def committed(self, session):
        self.commits += 1

    def dispatch(self, request):
        self.assertGreater(self.commits, 0, "ERP notification must commit before any external HTTP")
        self.requests.append(request)
        return self.handler(request)

    def respond(self, request):
        self.assertEqual(request.url.path, "/v3.0/oa/group/message")
        return httpx.Response(200, json={"error": 0, "data": {
            "group_id": self.config.ZALO_GMF_GROUP_ID, "message_id": "synthetic-message",
            "access_token": "synthetic-access"}})

    def send(self, target="EVERYONE", **extra):
        return self.client.post("/notifications", json={
            "title": "Họp", "body": "Ngày mai", "target": target, **extra})

    def assert_safe(self, response):
        for secret in ["synthetic-access", "synthetic-refresh", "synthetic-app-secret",
                       self.config.ZALO_TOKEN_ENCRYPTION_KEY.get_secret_value()]:
            self.assertNotIn(secret, response.text)

    def test_group_targets_send_one_message_after_commit_with_correct_labels(self):
        for target, label, count, extra in [
            ("EVERYONE", "Tất cả mọi người", 2, {}),
            ("MANAGERS", "Các quản lý", 1, {}),
            ("STAFF", "Toàn bộ nhân viên", 1, {}),
            ("DEPARTMENT", "Phòng BIM", 2, {"target_department": "  Phòng   BIM "}),
        ]:
            with self.subTest(target=target):
                self.requests.clear()
                response = self.send(target, **extra)
                self.assertEqual(response.status_code, 201, response.text)
                self.assertEqual(response.json(), {"sent": count, "zalo": {"status": "sent"}})
                self.assertEqual(len(self.requests), 1)
                request = self.requests[0]
                self.assertEqual(request.headers["access_token"], "synthetic-access")
                self.assertEqual(json.loads(request.content), {
                    "recipient": {"group_id": "978226075868b136e879"},
                    "message": {"text": "[THÔNG BÁO DOSCO]\n\nNgười nhận: " + label +
                        "\nTiêu đề: Họp\nNội dung: Ngày mai\nNgười gửi: Người gửi ERP"}})
                self.assert_safe(response)
        self.assertEqual(self.db.query(Notification).count(), 6)

    def test_private_has_no_gmf_fallback(self):
        response = self.send("USER", target_user_id=self.staff.id)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["zalo"], {"status": "skipped", "reason": "private_unavailable"})
        self.assertEqual(self.db.query(Notification).count(), 1)
        self.assertEqual(self.requests, [])

    def test_disabled_missing_group_and_wrong_company_skip_without_http(self):
        for field, value, reason in [("ZALO_ENABLED", False, "disabled"),
                                     ("ZALO_GMF_GROUP_ID", "  ", "group_not_configured"),
                                     ("ZALO_COMPANY_ID", 9999, "company_not_configured")]:
            with self.subTest(field=field):
                previous = getattr(self.config, field)
                setattr(self.config, field, value)
                response = self.send()
                self.assertEqual(response.status_code, 201, response.text)
                self.assertEqual(response.json()["zalo"], {"status": "skipped", "reason": reason})
                self.assertEqual(self.requests, [])
                setattr(self.config, field, previous)

    def test_provider_failure_keeps_erp_and_does_not_retry_or_leak(self):
        self.handler = lambda request: httpx.Response(500, json={"message": "synthetic-access synthetic-app-secret"})
        response = self.send()
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()["zalo"], {"status": "failed", "reason": "send_failed"})
        self.assertEqual(len(self.requests), 1)
        self.assertEqual(self.db.query(Notification).count(), 2)
        self.assert_safe(response)

    def test_timeout_does_not_retry(self):
        def timeout(request):
            raise httpx.ReadTimeout("synthetic-access", request=request)
        self.handler = timeout
        response = self.send()
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["zalo"]["status"], "failed")
        self.assertEqual(len(self.requests), 1)
        self.assertEqual(self.db.query(Notification).count(), 2)
        self.assert_safe(response)

    def test_expired_access_refreshes_once_then_sends_once(self):
        self.credential.expires_at = utc_now() - timedelta(minutes=1)
        self.db.commit()
        self.commits = 0
        def refresh_then_send(request):
            if request.url.path == "/v4/oa/access_token":
                self.assertEqual(parse_qs(request.content.decode())["grant_type"], ["refresh_token"])
                return httpx.Response(200, json={"access_token": "synthetic-access-new",
                    "refresh_token": "synthetic-refresh-new", "expires_in": 90000})
            self.assertEqual(request.headers["access_token"], "synthetic-access-new")
            return self.respond(request)
        self.handler = refresh_then_send
        response = self.send()
        self.assertEqual(response.json()["zalo"]["status"], "sent", response.text)
        self.assertEqual([r.url.path for r in self.requests], ["/v4/oa/access_token", "/v3.0/oa/group/message"])
        self.db.refresh(self.credential)
        self.assertEqual(self.credential.oa_id, "987654")
        self.assertEqual(self.oauth.repository().decrypt(self.credential.refresh_token_encrypted), "synthetic-refresh-new")
        self.assert_safe(response)

    def test_missing_credential_keeps_erp_without_http(self):
        self.db.delete(self.credential)
        self.db.commit()
        response = self.send()
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["zalo"]["status"], "failed")
        self.assertEqual(self.db.query(Notification).count(), 2)
        self.assertEqual(self.requests, [])

    def test_rejected_erp_requests_never_send_zalo(self):
        response = self.send("DEPARTMENT", target_department="Phòng trống")
        self.assertEqual(response.status_code, 400)
        self.sender.role = UserRole.FIELD_STAFF
        response = self.send()
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.requests, [])
        self.assertEqual(self.db.query(Notification).count(), 0)

    def test_failed_erp_commit_never_sends_zalo(self):
        with patch.object(self.db, "commit", side_effect=RuntimeError("synthetic commit failure")):
            response = self.send()
        self.assertEqual(response.status_code, 500)
        self.assertEqual(self.requests, [])
        self.db.rollback()
        self.assertEqual(self.db.query(Notification).count(), 0)

    def test_empty_body_and_department_without_prefix(self):
        self.staff.department = "BIM"
        self.db.commit()
        response = self.send("DEPARTMENT", target_department="BIM", body=None)
        self.assertEqual(response.status_code, 201)
        text = json.loads(self.requests[0].content)["message"]["text"]
        self.assertIn("Người nhận: Phòng BIM\n", text)
        self.assertIn("Nội dung: \n", text)


if __name__ == "__main__":
    unittest.main()
