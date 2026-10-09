"""Leave submissions and decisions use real services with mocked external HTTP."""
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

    def test_opening_link_does_not_send_more_group_messages(self):
        response=self.submit()
        leave_id=response.json()["id"]
        self.current=self.director
        self.assertEqual(self.client.get(f"/leave/{leave_id}").status_code,200)
        self.assertEqual(len(self.requests),1)

    def decide(self, leave_id, status="APPROVED"):
        self.current = self.director
        return self.client.post(f"/leave/{leave_id}/decide", json={"status": status})

    def test_approval_sends_one_result_after_decision_and_web_notification_commit(self):
        leave_id = self.submit().json()["id"]
        committed = []
        def after_commit(request):
            with self.sessions() as db:
                row = db.get(LeaveRequest, leave_id)
                committed.append((row.status, row.decided_by_id,
                    db.query(Notification).filter_by(recipient_id=self.staff.id).count()))
            return self.respond(request)
        self.handler = after_commit
        response = self.decide(leave_id)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["status"], "APPROVED")
        self.assertEqual(committed, [(LeaveStatus.APPROVED, self.director.id, 1)])
        self.assertEqual(len(self.requests), 2)
        expected = ("[KẾT QUẢ ĐƠN XIN NGHỈ DOSCO]\n\nNgười gửi: Nhân viên ERP\n"
            f"Từ ngày: {self.when:%d/%m/%Y}\nĐến ngày: {self.when+timedelta(days=1):%d/%m/%Y}\n"
            "Thời gian nghỉ: Cả ngày\nLý do: GIA ĐÌNH\nNghỉ phép: Nghỉ\n"
            "Trạng thái: Đã duyệt\nNgười xử lý: Director\n\n"
            f"Xem đơn: https://erp.dosco.vn/leave?request_id={leave_id}")
        self.assertEqual(json.loads(self.requests[-1].content),
            {"recipient": {"group_id": "synthetic-group"}, "message": {"text": expected}})
        self.assert_safe(response)

    def test_rejection_sends_the_rejected_result_once(self):
        leave_id = self.submit().json()["id"]
        response = self.decide(leave_id, "REJECTED")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["status"], "REJECTED")
        self.assertEqual(len(self.requests), 2)
        text = json.loads(self.requests[-1].content)["message"]["text"]
        self.assertIn("Trạng thái: Từ chối\nNgười xử lý: Director", text)
        self.assertNotIn("Chờ duyệt", text)
        self.assertEqual(self.db.query(Notification).filter_by(recipient_id=self.staff.id).count(),1)
        self.assert_safe(response)

    def test_decision_preserves_each_selected_leave_and_late_label(self):
        for kind, label in [("MORNING", "Thời gian nghỉ: Buổi sáng"),
                             ("AFTERNOON", "Thời gian nghỉ: Buổi chiều"),
                             ("LATE_MORNING", "Buổi đi muộn: Đi muộn sáng"),
                             ("LATE_AFTERNOON", "Buổi đi muộn: Đi muộn chiều")]:
            with self.subTest(kind=kind):
                self.current = self.staff
                leave_id = self.submit(kind).json()["id"]
                self.requests.clear()
                response = self.decide(leave_id)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(len(self.requests), 1)
                text = json.loads(self.requests[0].content)["message"]["text"]
                self.assertIn(label, text)
                self.assertIn("Nghỉ phép: " + ("Đi muộn" if kind.startswith("LATE") else "Nghỉ"), text)

    def test_repeated_or_competing_decisions_do_not_send_the_result_again(self):
        leave_id = self.submit().json()["id"]
        self.assertEqual(self.decide(leave_id).status_code, 200)
        self.assertEqual(len(self.requests), 2)
        self.current = self.manager
        for status in ("APPROVED", "REJECTED"):
            response = self.client.post(f"/leave/{leave_id}/decide", json={"status": status})
            self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(len(self.requests), 2)
        self.assertEqual(self.db.get(LeaveRequest, leave_id).status, LeaveStatus.APPROVED)
        self.assertEqual(self.db.query(Notification).filter_by(recipient_id=self.staff.id).count(), 1)

    def test_stale_pending_session_cannot_send_a_second_decision_message(self):
        from fastapi import HTTPException
        from app.schemas import LeaveDecision
        from app.services.leave_zalo_service import LeaveZaloService

        leave_id = self.submit().json()["id"]
        with self.sessions() as stale:
            old = stale.get(LeaveRequest, leave_id)
            self.assertEqual(old.status, LeaveStatus.PENDING)
            self.assertEqual(self.decide(leave_id).status_code, 200)
            self.assertEqual(len(self.requests), 2)
            self.assertEqual(old.status, LeaveStatus.PENDING)
            with self.assertRaises(HTTPException) as rejected:
                leave.decide_leave(leave_id, LeaveDecision(status=LeaveStatus.REJECTED),
                    db=stale, current=self.manager,
                    zalo=LeaveZaloService(ZaloOAuthService(stale, self.config, self.http)))
            self.assertEqual(rejected.exception.status_code, 409)
        self.assertEqual(len(self.requests), 2)
        self.assertEqual(self.db.get(LeaveRequest, leave_id).status, LeaveStatus.APPROVED)

    def test_disabled_blank_group_and_wrong_company_keep_the_decision_without_sending(self):
        for key, value in [("ZALO_ENABLED", False), ("ZALO_GMF_GROUP_ID", " "), ("ZALO_COMPANY_ID", 999)]:
            with self.subTest(key=key):
                self.current = self.staff
                leave_id = self.submit().json()["id"]
                self.requests.clear()
                old = getattr(self.config, key)
                setattr(self.config, key, value)
                try:
                    response = self.decide(leave_id)
                    self.assertEqual(response.status_code, 200, response.text)
                    self.assertEqual(response.json()["status"], "APPROVED")
                    self.assertEqual(self.requests, [])
                finally:
                    setattr(self.config, key, old)

    def test_decision_timeout_keeps_result_and_web_notification_without_retry_or_leak(self):
        leave_id = self.submit().json()["id"]
        self.requests.clear()
        def timeout(request):
            raise httpx.ReadTimeout("synthetic-access synthetic-secret", request=request)
        self.handler = timeout
        response = self.decide(leave_id)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["status"], "APPROVED")
        self.assertEqual(len(self.requests), 1)
        self.assertEqual(self.db.get(LeaveRequest, leave_id).status, LeaveStatus.APPROVED)
        self.assertEqual(self.db.query(Notification).filter_by(recipient_id=self.staff.id).count(), 1)
        self.assertEqual(self.decide(leave_id).status_code, 409)
        self.assertEqual(len(self.requests), 1)
        self.assert_safe(response)

    def test_provider_rejection_keeps_the_web_rejection_without_retry_or_leak(self):
        leave_id = self.submit().json()["id"]
        self.requests.clear()
        self.handler = lambda request: httpx.Response(200, json={"error": -2017, "message": "synthetic-access"})
        response = self.decide(leave_id, "REJECTED")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["status"], "REJECTED")
        self.assertEqual(len(self.requests), 1)
        self.assertEqual(self.db.query(Notification).filter_by(recipient_id=self.staff.id).count(), 1)
        self.assert_safe(response)

    def test_missing_credential_does_not_undo_the_decision(self):
        leave_id = self.submit().json()["id"]
        self.db.delete(self.credential)
        self.db.commit()
        self.requests.clear()
        response = self.decide(leave_id)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["status"], "APPROVED")
        self.assertEqual(self.requests, [])
        self.assertEqual(self.db.query(Notification).filter_by(recipient_id=self.staff.id).count(), 1)
        self.assert_safe(response)

    def test_expired_token_refreshes_once_then_sends_one_decision_message(self):
        leave_id = self.submit().json()["id"]
        self.credential.expires_at = utc_now() - timedelta(seconds=1)
        self.db.commit()
        self.requests.clear()
        def refresh_then_send(request):
            if request.url.path == "/v4/oa/access_token":
                return httpx.Response(200, json={"access_token": "synthetic-new-access",
                    "refresh_token": "synthetic-new-refresh", "expires_in": "90000"})
            self.assertEqual(request.headers["access_token"], "synthetic-new-access")
            return httpx.Response(200, json={"error": 0, "data": {"message_id": "synthetic-result"}})
        self.handler = refresh_then_send
        response = self.decide(leave_id)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual([r.url.path for r in self.requests], ["/v4/oa/access_token", "/v3.0/oa/group/message"])
        self.assertNotIn("synthetic-new-access", response.text)
        self.assertNotIn("synthetic-new-refresh", response.text)

    def test_failed_token_refresh_preserves_decision_snapshot_without_sending_gmf(self):
        leave_id = self.submit().json()["id"]
        self.credential.expires_at = utc_now() - timedelta(seconds=1)
        self.db.commit()
        self.requests.clear()
        def refresh_timeout(request):
            raise httpx.ReadTimeout("synthetic-refresh synthetic-secret", request=request)
        self.handler = refresh_timeout
        response = self.decide(leave_id)
        self.assertEqual(response.status_code, 200, response.text)
        saved = response.json()
        self.assertEqual(saved["status"], "APPROVED")
        self.assertEqual(saved["user_name"], "Nhân viên ERP")
        self.assertEqual(saved["decided_by_name"], "Director")
        self.assertEqual(saved["from_date"], self.when.isoformat())
        self.assertEqual(saved["to_date"], (self.when + timedelta(days=1)).isoformat())
        self.assertEqual([r.url.path for r in self.requests], ["/v4/oa/access_token"])
        with self.sessions() as db:
            self.assertEqual(db.get(LeaveRequest, leave_id).status, LeaveStatus.APPROVED)
            self.assertEqual(db.query(Notification).filter_by(recipient_id=self.staff.id).count(), 1)
        self.assertEqual(self.decide(leave_id).status_code, 409)
        self.assertEqual(len(self.requests), 1)
        self.assert_safe(response)

    def test_invalid_unauthorized_foreign_and_missing_decisions_never_send(self):
        leave_id = self.submit().json()["id"]
        self.requests.clear()
        self.assertEqual(self.client.post(f"/leave/{leave_id}/decide", json={"status": "APPROVED"}).status_code, 403)
        self.current = self.director
        self.assertEqual(self.client.post(f"/leave/{leave_id}/decide", json={"status": "PENDING"}).status_code, 400)
        self.assertEqual(self.client.post("/leave/99999/decide", json={"status": "APPROVED"}).status_code, 404)
        company = Company(name="Foreign", code="FOREIGN-GMF")
        self.db.add(company)
        self.db.flush()
        foreign = User(company_id=company.id, email="foreign@example.com", full_name="Foreign",
                       role=UserRole.DIRECTOR, hashed_password="unused")
        self.db.add(foreign)
        self.db.commit()
        self.current = foreign
        self.assertEqual(self.client.post(f"/leave/{leave_id}/decide", json={"status": "APPROVED"}).status_code, 404)
        self.assertEqual(self.requests, [])
        self.assertEqual(self.db.get(LeaveRequest, leave_id).status, LeaveStatus.PENDING)

    def test_failed_decision_commit_does_not_send_or_notify(self):
        leave_id = self.submit().json()["id"]
        self.requests.clear()
        with patch.object(self.db, "commit", side_effect=RuntimeError("synthetic failed commit")):
            response = self.decide(leave_id)
        self.assertEqual(response.status_code, 500)
        self.db.rollback()
        self.assertEqual(self.requests, [])
        self.assertEqual(self.db.get(LeaveRequest, leave_id).status, LeaveStatus.PENDING)
        self.assertEqual(self.db.query(Notification).filter_by(recipient_id=self.staff.id).count(), 0)

    def test_student_schedule_decision_is_not_sent_to_gmf(self):
        leave_id = self.submit().json()["id"]
        self.db.get(LeaveRequest, leave_id).source = "SCHEDULE"
        self.db.commit()
        self.requests.clear()
        response = self.decide(leave_id)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["status"], "APPROVED")
        self.assertEqual(self.requests, [])

    def test_pending_snapshot_is_not_sent_as_a_decision_result(self):
        from app.schemas import LeaveOut
        from app.services.leave_zalo_service import LeaveZaloService

        leave_id = self.submit().json()["id"]
        saved = LeaveOut.model_validate(self.db.get(LeaveRequest, leave_id))
        self.requests.clear()
        result = LeaveZaloService(self.oauth).send_decision(saved)
        self.assertEqual(result, {"status": "skipped", "reason": "not_decided"})
        self.assertEqual(self.requests, [])

    def test_legacy_leave_with_null_source_still_sends_a_decision(self):
        leave_id = self.submit().json()["id"]
        self.db.get(LeaveRequest, leave_id).source = None
        self.db.commit()
        self.requests.clear()
        response = self.decide(leave_id)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(self.requests), 1)

    def test_self_approval_sends_one_result_without_adding_self_web_notification(self):
        self.current = self.manager
        leave_id = self.submit().json()["id"]
        self.requests.clear()
        response = self.client.post(f"/leave/{leave_id}/decide", json={"status": "APPROVED"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(self.requests), 1)
        self.assertIn("Người xử lý: Manager", json.loads(self.requests[0].content)["message"]["text"])
        self.assertEqual(self.db.query(Notification).filter_by(recipient_id=self.manager.id).count(), 0)


if __name__ == "__main__":
    unittest.main()
