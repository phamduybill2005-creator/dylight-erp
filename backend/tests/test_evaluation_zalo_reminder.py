"""Scheduled evaluation reminders: disposable DB and fake provider HTTP only."""
import importlib
import json
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

os.environ.update(DATABASE_URL="sqlite:///:memory:", DEBUG="true", AUTO_SEED="false",
                  YUNATT_ENABLED="false", ZALO_ENABLED="false", ZALO_EVAL_REMINDER_ENABLED="false")

import httpx
from cryptography.fernet import Fernet
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.config import Settings
from app.database import Base
from app.models import Company, Notification
from app.services.zalo_oauth_service import ZaloOAuthService
from app.services.zalo_repository import utc_now
from app.zalo_models import ZaloOACredential


class EvaluationZaloReminderTests(unittest.TestCase):
    def setUp(self):
        try:
            self.module = importlib.import_module("app.services.evaluation_zalo_service")
            self.model = importlib.import_module("app.zalo_reminder_models").ZaloEvaluationReminder
        except ModuleNotFoundError:
            self.fail("Scheduled evaluation GMF reminders are not implemented")
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.url = "sqlite:///" + str(Path(self.directory.name) / "test.db")
        self.engine = create_engine(self.url, connect_args={"check_same_thread": False})
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine)
        self.db = self.sessions()
        company = Company(name="Company", code="EVAL-GMF")
        self.db.add(company)
        self.db.commit()
        self.config = Settings(_env_file=None, ZALO_ENABLED=True, ZALO_EVAL_REMINDER_ENABLED=True,
            ZALO_COMPANY_ID=company.id, ZALO_APP_ID="123456", ZALO_OA_ID="987654",
            ZALO_APP_SECRET="synthetic-secret", ZALO_TOKEN_ENCRYPTION_KEY=Fernet.generate_key().decode(),
            ZALO_GMF_GROUP_ID="synthetic-group")
        self.requests = []
        self.lock = threading.Lock()
        self.handler = self.respond
        self.http = httpx.Client(transport=httpx.MockTransport(self.dispatch))
        self.oauth = ZaloOAuthService(self.db, self.config, self.http)
        self.credential = ZaloOACredential(company_id=company.id, app_id="123456", oa_id="987654",
            **self.oauth.repository()._token_values("synthetic-access", "synthetic-refresh",
                                                  utc_now() + timedelta(hours=1)))
        self.db.add(self.credential)
        self.db.commit()
        self.service = self.module.EvaluationZaloService(self.oauth)
        self.due = datetime(2026, 10, 27, 8)
        self.addCleanup(self.engine.dispose)
        self.addCleanup(self.db.close)
        self.addCleanup(self.http.close)

    def dispatch(self, request):
        # The durable claim must be visible BEFORE any provider call.
        with self.sessions() as db:
            self.assertEqual(db.query(self.model).filter_by(status="claimed").count(), 1)
        with self.lock:
            self.requests.append(request)
        return self.handler(request)

    def respond(self, request):
        self.assertEqual(request.url.path, "/v3.0/oa/group/message")
        return httpx.Response(200, json={"error": 0, "data": {"message_id": "synthetic-message"}})

    def test_day_27_at_eight_sends_one_company_message_with_evaluation_link(self):
        result = self.service.run_due(self.due)
        self.assertEqual(result, {"status": "sent"})
        self.assertEqual(len(self.requests), 1)
        expected = ("[THÔNG BÁO DOSCO]\n\nNgười nhận: Tất cả mọi người\n"
            "Tiêu đề: Đến hạn đánh giá tháng 10/2026\n"
            "Nội dung: Theo quy định, ngày 27 hằng tháng mọi người vào mục Đánh giá "
            "để chấm đánh giá tháng 10/2026.\nNgười gửi: Hệ thống\n\n"
            "Mở đánh giá: https://erp.dosco.vn/evaluations")
        self.assertEqual(json.loads(self.requests[0].content),
            {"recipient": {"group_id": "synthetic-group"}, "message": {"text": expected}})
        row = self.db.query(self.model).one()
        self.assertEqual((row.period, row.oa_id, row.group_id, row.status),
                         ("2026-10", "987654", "synthetic-group", "sent"))
        self.assertIsNotNone(row.finished_at)
        self.assertEqual(self.db.query(Notification).count(), 0)

    def test_before_eight_other_days_and_other_months_do_not_claim_or_send(self):
        for now in [datetime(2026, 10, 26, 23), datetime(2026, 10, 27, 7, 59, 59),
                    datetime(2026, 10, 28), datetime(2026, 11, 1, 8)]:
            with self.subTest(now=now):
                self.assertEqual(self.service.run_due(now)["status"], "skipped")
        self.assertEqual(self.requests, [])
        self.assertEqual(self.db.query(self.model).count(), 0)

    def test_vietnam_time_is_used_for_aware_utc_datetime(self):
        self.assertEqual(self.service.run_due(datetime(2026, 10, 27, 0, 59, tzinfo=timezone.utc))["status"], "skipped")
        self.assertEqual(self.service.run_due(datetime(2026, 10, 27, 1, tzinfo=timezone.utc))["status"], "sent")
        self.assertEqual(len(self.requests), 1)

    def test_late_start_on_day_27_catches_up_once(self):
        self.assertEqual(self.service.run_due(datetime(2026, 10, 27, 23, 59))["status"], "sent")
        self.assertEqual(self.service.run_due(datetime(2026, 10, 27, 23, 59))["status"], "skipped")
        self.assertEqual(len(self.requests), 1)

    def test_new_process_session_or_changed_group_cannot_send_month_again(self):
        self.assertEqual(self.service.run_due(self.due)["status"], "sent")
        with self.sessions() as db:
            service = self.module.EvaluationZaloService(ZaloOAuthService(db, self.config, self.http))
            self.assertEqual(service.run_due(self.due)["reason"], "already_claimed")
            self.config.ZALO_GMF_GROUP_ID = "different-group"
            self.assertEqual(service.run_due(self.due)["reason"], "already_claimed")
        self.assertEqual(len(self.requests), 1)

    def test_next_month_gets_a_separate_claim(self):
        self.assertEqual(self.service.run_due(self.due)["status"], "sent")
        self.assertEqual(self.service.run_due(datetime(2026, 11, 27, 8))["status"], "sent")
        self.assertEqual(len(self.requests), 2)
        self.assertIn("Đến hạn đánh giá tháng 11/2026", json.loads(self.requests[1].content)["message"]["text"])
        self.assertEqual(self.db.query(self.model).count(), 2)

    def test_disabled_missing_group_wrong_company_or_missing_credential_never_claim(self):
        for key, value in [("ZALO_ENABLED", False), ("ZALO_EVAL_REMINDER_ENABLED", False),
                           ("ZALO_GMF_GROUP_ID", " "), ("ZALO_COMPANY_ID", 999)]:
            with self.subTest(key=key):
                old = getattr(self.config, key)
                setattr(self.config, key, value)
                try:
                    self.assertEqual(self.service.run_due(self.due)["status"], "skipped")
                finally:
                    setattr(self.config, key, old)
        self.db.delete(self.credential)
        self.db.commit()
        self.assertEqual(self.service.run_due(self.due)["status"], "skipped")
        self.assertEqual(self.requests, [])
        self.assertEqual(self.db.query(self.model).count(), 0)

    def test_missing_schema_fails_closed_without_implicit_create_or_provider_call(self):
        self.model.__table__.drop(self.engine)
        self.assertEqual(self.service.run_due(self.due), {"status": "skipped", "reason": "schema_not_ready"})
        from sqlalchemy import inspect
        self.assertFalse(inspect(self.engine).has_table(self.model.__tablename__))
        self.assertEqual(self.requests, [])

    def test_schema_without_company_month_primary_key_never_sends(self):
        from sqlalchemy import text
        self.model.__table__.drop(self.engine)
        with self.engine.begin() as connection:
            connection.execute(text("CREATE TABLE zalo_evaluation_reminders ("
                "company_id INTEGER NOT NULL, period VARCHAR(7) NOT NULL, oa_id VARCHAR(100) NOT NULL, "
                "group_id VARCHAR(100) NOT NULL, status VARCHAR(20) NOT NULL, claimed_at DATETIME NOT NULL, "
                "finished_at DATETIME)"))
        self.assertEqual(self.service.run_due(self.due), {"status": "skipped", "reason": "schema_not_ready"})
        self.assertEqual(self.requests, [])

    def test_failed_claim_commit_never_sends(self):
        with patch.object(self.db, "commit", side_effect=RuntimeError("synthetic-secret")):
            result = self.service.run_due(self.due)
        self.assertEqual(result, {"status": "failed", "reason": "reminder_failed"})
        self.assertEqual(self.requests, [])
        self.assertEqual(self.db.query(self.model).count(), 0)

    def test_timeout_consumes_claim_and_never_retries_even_after_new_session(self):
        def timeout(request):
            raise httpx.ReadTimeout("synthetic-access synthetic-secret", request=request)
        self.handler = timeout
        result = self.service.run_due(self.due)
        self.assertEqual(result, {"status": "failed", "reason": "reminder_failed"})
        self.assertEqual(self.db.query(self.model).one().status, "failed")
        with self.sessions() as db:
            service = self.module.EvaluationZaloService(ZaloOAuthService(db, self.config, self.http))
            self.assertEqual(service.run_due(self.due)["reason"], "already_claimed")
        self.assertEqual(len(self.requests), 1)
        self.assertNotIn("synthetic", json.dumps(result))

    def test_crash_after_claim_cannot_cause_resend(self):
        def crash(request):
            raise SystemExit("simulated crash after durable claim")
        self.handler = crash
        with self.assertRaises(SystemExit):
            self.service.run_due(self.due)
        self.db.rollback()
        self.assertEqual(self.db.query(self.model).one().status, "claimed")
        self.assertEqual(self.service.run_due(self.due)["reason"], "already_claimed")
        self.assertEqual(len(self.requests), 1)

    def test_result_recording_failure_does_not_allow_another_send(self):
        with patch.object(self.service.repository, "finish", side_effect=RuntimeError("synthetic-secret")):
            result = self.service.run_due(self.due)
        self.assertEqual(result, {"status": "failed", "reason": "reminder_failed"})
        self.assertEqual(self.db.query(self.model).one().status, "claimed")
        self.assertEqual(self.service.run_due(self.due)["reason"], "already_claimed")
        self.assertEqual(len(self.requests), 1)

    def test_rollback_failure_does_not_expose_exception_or_call_provider(self):
        with patch.object(self.db, "commit", side_effect=RuntimeError("synthetic-secret")), \
             patch.object(self.db, "rollback", side_effect=RuntimeError("synthetic-access")):
            result = self.service.run_due(self.due)
        self.db.rollback()
        self.assertEqual(result, {"status": "failed", "reason": "reminder_failed"})
        self.assertEqual(self.requests, [])

    def test_two_workers_compete_for_one_durable_claim(self):
        barrier = threading.Barrier(2)
        def run():
            with self.sessions() as db:
                service = self.module.EvaluationZaloService(ZaloOAuthService(db, self.config, self.http))
                barrier.wait(timeout=5)
                return service.run_due(self.due)
        with ThreadPoolExecutor(max_workers=2) as workers:
            results = list(workers.map(lambda _: run(), range(2)))
        self.assertEqual(sorted(r["status"] for r in results), ["sent", "skipped"])
        self.assertEqual(len(self.requests), 1)
        self.assertEqual(self.db.query(self.model).count(), 1)

    def test_expired_token_refreshes_once_before_one_group_message(self):
        self.credential.expires_at = utc_now() - timedelta(seconds=1)
        self.db.commit()
        def refresh_then_send(request):
            if request.url.path == "/v4/oa/access_token":
                return httpx.Response(200, json={"access_token": "synthetic-new-access",
                    "refresh_token": "synthetic-new-refresh", "expires_in": "90000"})
            self.assertEqual(request.headers["access_token"], "synthetic-new-access")
            return self.respond(request)
        self.handler = refresh_then_send
        self.assertEqual(self.service.run_due(self.due), {"status": "sent"})
        self.assertEqual([r.url.path for r in self.requests], ["/v4/oa/access_token", "/v3.0/oa/group/message"])


if __name__ == "__main__":
    unittest.main()
