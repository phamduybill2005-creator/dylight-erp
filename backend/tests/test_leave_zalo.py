"""Leave submissions use real ERP/OAuth services; all external HTTP is mocked."""
import importlib
import json
import os
import unittest
from datetime import date, timedelta
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite+pysqlite:///:memory:"
os.environ["DEBUG"] = "true"
os.environ["ZALO_ENABLED"] = "false"

import httpx
from cryptography.fernet import Fernet
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import Settings
from app.database import Base, get_db
from app.deps import get_current_user
from app.models import Company, LeaveRequest, LeaveStatus, Notification, User, UserRole
from app.routers import leave
from app.services.zalo_oauth_service import ZaloOAuthService
from app.services.zalo_repository import utc_now
from app.zalo_models import ZaloOACredential


class LeaveZaloTests(unittest.TestCase):
    def setUp(self):
        try:
            module = importlib.import_module("app.services.leave_zalo_service")
        except ModuleNotFoundError:
            self.fail("Leave GMF service is not implemented")
        self.engine = create_engine("sqlite+pysqlite:///:memory:", poolclass=StaticPool,
                                    connect_args={"check_same_thread": False})
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine)
        self.db = self.sessions()
        company = Company(name="Company", code="LEAVE-GMF")
        self.db.add(company)
        self.db.flush()
        self.staff = User(company_id=company.id, email="staff@example.com", full_name="Nhân viên ERP",
                          role=UserRole.FIELD_STAFF, hashed_password="unused")
        self.director = User(company_id=company.id, email="director@example.com", full_name="Director",
                             role=UserRole.DIRECTOR, hashed_password="unused")
        self.manager = User(company_id=company.id, email="manager@example.com", full_name="Manager",
                            role=UserRole.MANAGER, hashed_password="unused")
        self.db.add_all([self.staff, self.director, self.manager])
        self.db.commit()
        self.current = self.staff
        self.when = date.today() + timedelta(days=3)
        self.config = Settings(_env_file=None, ZALO_ENABLED=True, ZALO_COMPANY_ID=company.id,
            ZALO_APP_ID="123456", ZALO_OA_ID="987654", ZALO_APP_SECRET="synthetic-secret",
            ZALO_TOKEN_ENCRYPTION_KEY=Fernet.generate_key().decode(), ZALO_GMF_GROUP_ID="synthetic-group")
        self.requests = []
        self.handler = self.respond
        self.http = httpx.Client(transport=httpx.MockTransport(self.dispatch))
        self.oauth = ZaloOAuthService(self.db, self.config, self.http)
        repo = self.oauth.repository()
        self.credential = ZaloOACredential(company_id=company.id, app_id="123456", oa_id="987654",
            **repo._token_values("synthetic-access", "synthetic-refresh", utc_now()+timedelta(hours=1)))
        self.db.add(self.credential)
        self.db.commit()
        app = FastAPI()
        app.include_router(leave.router)
        app.dependency_overrides[get_db] = lambda: self.db
        app.dependency_overrides[get_current_user] = lambda: self.current
        app.dependency_overrides[leave.get_leave_zalo_service] = lambda: module.LeaveZaloService(self.oauth)
        self.client = TestClient(app, raise_server_exceptions=False)

    def tearDown(self):
        if hasattr(self, "client"):
            self.client.close()
            self.http.close()
            self.db.close()
            self.engine.dispose()

    def dispatch(self, request):
        # A separate session sees the committed leave and the original web notifications.
        with self.sessions() as db:
            self.assertGreater(db.query(LeaveRequest).count(), 0)
            self.assertGreater(db.query(Notification).count(), 0)
        self.requests.append(request)
        return self.handler(request)

    def respond(self, request):
        self.assertEqual(request.url.path, "/v3.0/oa/group/message")
        self.assertEqual(request.headers["access_token"], "synthetic-access")
        return httpx.Response(200, json={"error": 0, "data": {"message_id": "synthetic-message", "group_id": "synthetic-group"}})

    def submit(self, leave_type="FULL", **extra):
        return self.client.post("/leave", json={"from_date": self.when.isoformat(),
            "to_date": (self.when+timedelta(days=1)).isoformat(), "reason": "GIA ĐÌNH", "leave_type": leave_type, **extra})

    def assert_safe(self, response):
        for value in ["synthetic-access", "synthetic-refresh", "synthetic-secret", self.config.ZALO_TOKEN_ENCRYPTION_KEY.get_secret_value()]:
            self.assertNotIn(value, response.text)

    def test_one_group_message_matches_full_web_form_and_exact_leave_link(self):
        response = self.submit()
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()["zalo"], {"status": "sent"})
        self.assertEqual(len(self.requests), 1)
        expected = ("[ĐƠN XIN NGHỈ DOSCO]\n\nNgười gửi: Nhân viên ERP\n"
            f"Từ ngày: {self.when:%d/%m/%Y}\nĐến ngày: {self.when+timedelta(days=1):%d/%m/%Y}\n"
            "Thời gian nghỉ: Cả ngày\nLý do: GIA ĐÌNH\nNghỉ phép: Nghỉ\nTrạng thái: Chờ duyệt\n\n"
            f"Xem và xử lý đơn: https://erp.dosco.vn/leave?request_id={response.json()['id']}")
        self.assertEqual(json.loads(self.requests[0].content), {"recipient": {"group_id": "synthetic-group"}, "message": {"text": expected}})
        self.assertEqual(self.db.query(Notification).count(), 2)
        self.assert_safe(response)

    def test_each_selected_leave_or_late_label_matches_web(self):
        for kind, label in [("MORNING", "Thời gian nghỉ: Buổi sáng"), ("AFTERNOON", "Thời gian nghỉ: Buổi chiều"),
                             ("LATE_MORNING", "Buổi đi muộn: Đi muộn sáng"), ("LATE_AFTERNOON", "Buổi đi muộn: Đi muộn chiều")]:
            with self.subTest(kind=kind):
                self.requests.clear()
                response = self.submit(kind, reason="ỐM ĐAU")
                self.assertEqual(response.status_code, 201, response.text)
                self.assertEqual(len(self.requests), 1)
                text = json.loads(self.requests[0].content)["message"]["text"]
                self.assertIn(label, text)
                self.assertIn("Lý do: ỐM ĐAU", text)
                self.assertIn("Nghỉ phép: " + ("Đi muộn" if kind.startswith("LATE") else "Nghỉ"), text)

    def test_disabled_blank_group_and_wrong_company_do_not_send(self):
        for key, value, reason in [("ZALO_ENABLED", False, "disabled"), ("ZALO_GMF_GROUP_ID", " ", "group_not_configured"),
                                    ("ZALO_COMPANY_ID", 999, "company_not_configured")]:
            with self.subTest(key=key):
                old=getattr(self.config,key)
                setattr(self.config,key,value)
                response=self.submit()
                self.assertEqual(response.status_code,201,response.text)
                self.assertEqual(response.json()["zalo"],{"status":"skipped","reason":reason})
                self.assertEqual(self.requests,[])
                setattr(self.config,key,old)

    def test_timeout_keeps_leave_and_web_notifications_without_retry_or_leak(self):
        def timeout(request):
            raise httpx.ReadTimeout("synthetic-access", request=request)
        self.handler=timeout
        response=self.submit()
        self.assertEqual(response.status_code,201,response.text)
        self.assertEqual(response.json()["zalo"],{"status":"failed","reason":"send_failed"})
        self.assertEqual(len(self.requests),1)
        self.assertEqual(self.db.query(LeaveRequest).count(),1)
        self.assertEqual(self.db.query(Notification).count(),2)
        self.assert_safe(response)

    def test_missing_credential_does_not_undo_leave(self):
        self.db.delete(self.credential)
        self.db.commit()
        response=self.submit()
        self.assertEqual(response.status_code,201,response.text)
        self.assertEqual(response.json()["zalo"]["status"],"failed")
        self.assertEqual(self.requests,[])
        self.assertEqual(self.db.query(LeaveRequest).count(),1)

    def test_expired_token_refreshes_once_then_sends_once(self):
        self.credential.expires_at = utc_now() - timedelta(seconds=1)
        self.db.commit()
        def refresh_then_send(request):
            if request.url.path == "/v4/oa/access_token":
                return httpx.Response(200, json={"access_token": "synthetic-new-access",
                    "refresh_token": "synthetic-new-refresh", "expires_in": "90000"})
            self.assertEqual(request.url.path, "/v3.0/oa/group/message")
            self.assertEqual(request.headers["access_token"], "synthetic-new-access")
            return httpx.Response(200, json={"error": 0, "data": {"message_id": "synthetic-message"}})
        self.handler = refresh_then_send
        response = self.submit()
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()["zalo"], {"status": "sent"})
        self.assertEqual([r.url.path for r in self.requests], ["/v4/oa/access_token", "/v3.0/oa/group/message"])
        self.assertNotIn("synthetic-new-access", response.text)
        self.assertNotIn("synthetic-new-refresh", response.text)

    def test_rejected_or_failed_erp_submission_never_calls_zalo(self):
        response=self.submit(from_date=date.today().isoformat())
        self.assertEqual(response.status_code,400)
        response=self.submit(to_date=(self.when-timedelta(days=1)).isoformat())
        self.assertEqual(response.status_code,400)
        with patch.object(self.db,"commit",side_effect=RuntimeError("synthetic failed commit")):
            response=self.submit()
        self.assertEqual(response.status_code,500)
        self.assertEqual(self.requests,[])
        self.db.rollback()
        self.assertEqual(self.db.query(LeaveRequest).count(),0)

    def test_opening_link_and_deciding_do_not_send_more_group_messages(self):
        response=self.submit()
        leave_id=response.json()["id"]
        self.current=self.director
        self.assertEqual(self.client.get(f"/leave/{leave_id}").status_code,200)
        decided=self.client.post(f"/leave/{leave_id}/decide",json={"status":"APPROVED"})
        self.assertEqual(decided.status_code,200,decided.text)
        self.assertEqual(decided.json()["status"],"APPROVED")
        self.assertEqual(len(self.requests),1)
        self.assertEqual(self.db.query(Notification).filter_by(recipient_id=self.staff.id).count(),1)


if __name__ == "__main__":
    unittest.main()
