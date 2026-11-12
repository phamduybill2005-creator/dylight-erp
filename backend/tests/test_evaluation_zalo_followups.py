"""Daily combined lists: fake provider, real durable daily claims and ballot changes."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
import threading
import unittest
from unittest.mock import patch

import httpx
from app.models import PeerReview, User, UserRole
from app.services.zalo_oauth_service import ZaloOAuthService
from tests import test_evaluation_zalo_reminder as fixtures


class EvaluationZaloFollowupTests(unittest.TestCase):
    def setUp(self):
        fixtures.EvaluationZaloReminderTests.setUp(self)
        self.people = [User(company_id=self.config.ZALO_COMPANY_ID, email=f"{name}@followup.invalid",
            full_name=name, role=UserRole.FIELD_STAFF, hashed_password="unused", department="Phòng AI")
            for name in ("An", "Bình")]
        self.director = User(company_id=self.config.ZALO_COMPANY_ID, email="director@followup.invalid",
            full_name="Director", role=UserRole.DIRECTOR, hashed_password="unused")
        self.db.add_all([*self.people, self.director]); self.db.commit()

    respond = fixtures.EvaluationZaloReminderTests.respond

    def dispatch(self, request):
        from app.zalo_reminder_models import ZaloEvaluationDailyReminder
        with self.sessions() as db:
            claims = sum(db.query(model).filter_by(status="claimed").count()
                         for model in (self.model, ZaloEvaluationDailyReminder))
            self.assertEqual(claims, 1)  # commit before every provider HTTP
        with self.lock: self.requests.append(request)
        return self.handler(request)

    def complete(self, voter):
        target = next(person for person in self.people if person.id != voter.id)
        for kind in ("QUALITY", "TEAM"):
            self.db.add(PeerReview(company_id=self.config.ZALO_COMPANY_ID, evaluator_id=voter.id,
                evaluatee_id=target.id, month="2026-10", kind=kind, score_1=5, score_2=4, score_3=3))
        self.db.commit()

    def message(self):
        return json.loads(self.requests[-1].content)["message"]["text"]

    def test_second_day_sends_one_combined_list_of_voters_not_rated_people(self):
        self.complete(self.people[0])
        self.assertEqual(self.service.run_due(datetime(2026, 11, 2, 8)), {"status": "sent"})
        self.assertIn("Chưa hoàn thành đánh giá tháng 10/2026", self.message())
        self.assertIn("1. Bình", self.message())
        self.assertNotIn("1. An", self.message())
        self.assertNotIn("Director", self.message())
        self.assertIn("\nThời hạn: 01/11/2026 – 05/11/2026.", self.message())
        self.assertIn("/peer-review?month=2026-10", self.message())
        self.assertNotIn("score", self.message())
        self.assertEqual(self.service.run_due(datetime(2026, 11, 2, 8, 5))["reason"], "already_claimed")
        self.assertEqual(len(self.requests), 1)

    def test_each_day_rechecks_remaining_voters_and_stops_when_everyone_finishes(self):
        self.assertEqual(self.service.run_due(datetime(2026, 11, 2, 8))["status"], "sent")
        self.assertIn("1. An", self.message()); self.assertIn("2. Bình", self.message())
        self.complete(self.people[0])
        self.assertEqual(self.service.run_due(datetime(2026, 11, 3, 8))["status"], "sent")
        self.assertNotIn("1. An", self.message())
        self.complete(self.people[1])
        for day in (4, 5):
            self.assertEqual(self.service.run_due(datetime(2026, 11, day, 8))["reason"], "all_complete")
        self.assertEqual(len(self.requests), 2)

    def test_no_followups_before_eight_after_morning_or_outside_days_two_to_five(self):
        for now in (datetime(2026, 11, 2, 7, 59), datetime(2026, 11, 3, 9),
                    datetime(2026, 11, 5, 15), datetime(2026, 11, 6, 8), datetime(2026, 11, 27, 8)):
            self.assertEqual(self.service.run_due(now)["reason"], "not_due")
        self.assertEqual(self.requests, [])

    def test_monthly_opening_does_not_block_followups_and_daily_claim_survives_restart_group_change(self):
        self.assertEqual(self.service.run_due(self.due)["status"], "sent")
        now = datetime(2026, 11, 2, 8)
        self.assertEqual(self.service.run_due(now)["status"], "sent")
        self.config.ZALO_GMF_GROUP_ID = "changed-group"
        with self.sessions() as db:
            service = self.module.EvaluationZaloService(ZaloOAuthService(db, self.config, self.http))
            self.assertEqual(service.run_due(now)["reason"], "already_claimed")
        self.assertEqual(len(self.requests), 2)

    def test_complete_morning_check_consumes_date_even_if_ballot_is_withdrawn_later(self):
        for voter in self.people: self.complete(voter)
        now = datetime(2026, 11, 2, 8)
        self.assertEqual(self.service.run_due(now)["reason"], "all_complete")
        self.db.query(PeerReview).filter_by(evaluator_id=self.people[0].id).delete(); self.db.commit()
        self.assertEqual(self.service.run_due(datetime(2026, 11, 2, 8, 5))["reason"], "already_claimed")
        self.assertEqual(self.requests, [])
        self.assertEqual(self.service.run_due(datetime(2026, 11, 3, 8))["status"], "sent")

    def test_timeout_is_not_replayed_but_next_day_can_send(self):
        def timeout(request): raise httpx.ReadTimeout("synthetic-secret", request=request)
        self.handler = timeout
        self.assertEqual(self.service.run_due(datetime(2026, 11, 2, 8))["status"], "failed")
        self.assertEqual(self.service.run_due(datetime(2026, 11, 2, 8, 5))["reason"], "already_claimed")
        self.handler = self.respond
        self.assertEqual(self.service.run_due(datetime(2026, 11, 3, 8))["status"], "sent")
        self.assertEqual(len(self.requests), 2)

    def test_competing_workers_make_only_one_daily_send(self):
        barrier = threading.Barrier(2)
        def run(_):
            with self.sessions() as db:
                service = self.module.EvaluationZaloService(ZaloOAuthService(db, self.config, self.http))
                barrier.wait(timeout=5)
                return service.run_due(datetime(2026, 11, 2, 8))
        with ThreadPoolExecutor(max_workers=2) as workers: results = list(workers.map(run, range(2)))
        self.assertEqual(sorted(result["status"] for result in results), ["sent", "skipped"])
        self.assertEqual(len(self.requests), 1)

    def test_utc_uses_vietnam_morning_window(self):
        self.assertEqual(self.service.run_due(datetime(2026, 11, 2, 0, 59, tzinfo=timezone.utc))["reason"], "not_due")
        self.assertEqual(self.service.run_due(datetime(2026, 11, 2, 1, tzinfo=timezone.utc))["status"], "sent")

    def test_day_five_and_january_use_separate_full_date_claims(self):
        from app.zalo_reminder_models import ZaloEvaluationDailyReminder
        self.assertEqual(self.service.run_due(datetime(2026, 11, 5, 8, 59))["status"], "sent")
        self.assertEqual(self.service.run_due(datetime(2027, 1, 2, 8))["status"], "sent")
        self.assertIn("tháng 12/2026", self.message())
        self.assertIn("\nThời hạn: 01/01/2027 – 05/01/2027.", self.message())
        self.assertEqual({row.period for row in self.db.query(ZaloEvaluationDailyReminder).all()}, {"2026-11-05", "2027-01-02"})

    def test_daily_missing_schema_disabled_or_missing_credential_never_sends(self):
        from app.zalo_reminder_models import ZaloEvaluationDailyReminder
        now = datetime(2026, 11, 2, 8)
        for field in ("ZALO_ENABLED", "ZALO_EVAL_REMINDER_ENABLED"):
            setattr(self.config, field, False)
            self.assertEqual(self.service.run_due(now)["reason"], "disabled")
            setattr(self.config, field, True)
        ZaloEvaluationDailyReminder.__table__.drop(self.engine)
        self.assertEqual(self.service.run_due(now)["reason"], "schema_not_ready")
        ZaloEvaluationDailyReminder.__table__.create(self.engine)
        self.db.delete(self.credential); self.db.commit()
        self.assertEqual(self.service.run_due(now)["reason"], "credential_unavailable")
        self.assertEqual(self.requests, [])

    def test_failed_daily_claim_commit_never_reaches_provider(self):
        with patch.object(self.db, "commit", side_effect=RuntimeError("synthetic-secret")):
            self.assertEqual(self.service.run_due(datetime(2026, 11, 2, 8))["status"], "failed")
        self.assertEqual(self.requests, [])

    def test_daily_finish_failure_cannot_allow_a_second_send(self):
        from app.services.zalo_reminder_repository import ZaloReminderRepository
        with patch.object(ZaloReminderRepository, "finish", side_effect=RuntimeError("synthetic-secret")):
            self.assertEqual(self.service.run_due(datetime(2026, 11, 2, 8))["status"], "failed")
        self.assertEqual(self.service.run_due(datetime(2026, 11, 2, 8, 5))["reason"], "already_claimed")
        self.assertEqual(len(self.requests), 1)
