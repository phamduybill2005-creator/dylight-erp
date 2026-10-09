"""Inspect real APScheduler jobs while preventing threads and external HTTP."""
import os
from datetime import datetime, timezone
import unittest
from unittest.mock import Mock, patch

os.environ.update(DATABASE_URL="sqlite:///:memory:", DEBUG="true", AUTO_SEED="false",
                  YUNATT_ENABLED="false", ZALO_ENABLED="false", ZALO_EVAL_REMINDER_ENABLED="false")

from apscheduler.schedulers.background import BackgroundScheduler
from app.config import Settings
from app.services import scheduler


class ZaloReminderSchedulerTests(unittest.TestCase):
    def setUp(self):
        self.config = Settings(_env_file=None, YUNATT_ENABLED=False, ZALO_ENABLED=True,
                               ZALO_EVAL_REMINDER_ENABLED=True)
        self.config_patch = patch.object(scheduler, "settings", self.config)
        self.config_patch.start()
        self.addCleanup(self.config_patch.stop)
        self.scheduler_patch = patch.object(scheduler, "_scheduler", None)
        self.scheduler_patch.start()
        self.addCleanup(self.scheduler_patch.stop)

    def test_zalo_job_starts_without_yunatt_with_vietnam_day_27_window(self):
        with patch.object(BackgroundScheduler, "start") as start:
            scheduler.start_scheduler()
            self.assertIsNotNone(scheduler._scheduler)
            start.assert_called_once()
            jobs = {job.id: job for job in scheduler._scheduler.get_jobs()}
        self.assertEqual(set(jobs), {"zalo_eval_reminder", "zalo_eval_startup"})
        trigger = jobs["zalo_eval_reminder"].trigger
        # 07:59:59 VN -> next fire 08:00 VN / 01:00 UTC on the 27th.
        next_fire = trigger.get_next_fire_time(None, datetime(2026, 10, 27, 0, 59, 59, tzinfo=timezone.utc))
        self.assertEqual(next_fire.astimezone(timezone.utc), datetime(2026, 10, 27, 1, tzinfo=timezone.utc))
        self.assertEqual(str(trigger.timezone), "Asia/Ho_Chi_Minh")
        after_window = trigger.get_next_fire_time(None, datetime(2026, 10, 27, 17, tzinfo=timezone.utc))
        self.assertEqual(after_window.astimezone(timezone.utc), datetime(2026, 11, 27, 1, tzinfo=timezone.utc))
        self.assertEqual(jobs["zalo_eval_reminder"].max_instances, 1)

    def test_global_zalo_or_feature_disabled_does_not_start_zalo_job(self):
        for field in ("ZALO_ENABLED", "ZALO_EVAL_REMINDER_ENABLED"):
            with self.subTest(field=field):
                old = getattr(self.config, field)
                setattr(self.config, field, False)
                with patch.object(BackgroundScheduler, "start") as start:
                    scheduler.start_scheduler()
                    start.assert_not_called()
                self.assertIsNone(scheduler._scheduler)
                setattr(self.config, field, old)

    def test_yunatt_schedule_is_retained_and_multiple_start_calls_are_idempotent(self):
        self.config.YUNATT_ENABLED = True
        with patch.object(BackgroundScheduler, "start") as start:
            scheduler.start_scheduler()
            initial = scheduler._scheduler
            scheduler.start_scheduler()
        self.assertIs(scheduler._scheduler, initial)
        start.assert_called_once()
        jobs = {job.id: job for job in initial.get_jobs()}
        self.assertEqual(set(jobs), {"yunatt_daily_sync", "zalo_eval_reminder", "zalo_eval_startup"})
        next_fire = jobs["yunatt_daily_sync"].trigger.get_next_fire_time(
            None, datetime(2026, 10, 9, 0, tzinfo=timezone.utc))
        self.assertEqual(next_fire.astimezone(timezone.utc), datetime(2026, 10, 9, 13, tzinfo=timezone.utc))

    def test_worker_owns_and_closes_session_and_never_logs_exception_contents(self):
        self.assertTrue(hasattr(scheduler, "_run_eval_reminder"), "Monthly reminder worker is missing")
        db = Mock()
        with patch("app.database.SessionLocal", return_value=db), \
             patch("app.services.evaluation_zalo_service.EvaluationZaloService") as service, \
             self.assertLogs("app.services.scheduler", level="WARNING") as logs:
            service.return_value.run_due.side_effect = RuntimeError("synthetic-secret synthetic-access")
            scheduler._run_eval_reminder()
        db.rollback.assert_called_once()
        db.close.assert_called_once()
        self.assertNotIn("synthetic", " ".join(logs.output))

    def test_worker_cleanup_failures_never_escape_into_scheduler_error_logs(self):
        db = Mock()
        db.rollback.side_effect = RuntimeError("synthetic-secret")
        db.close.side_effect = RuntimeError("synthetic-access")
        with patch("app.database.SessionLocal", return_value=db), \
             patch("app.services.evaluation_zalo_service.EvaluationZaloService") as service, \
             self.assertLogs("app.services.scheduler", level="WARNING") as logs:
            service.return_value.run_due.side_effect = RuntimeError("synthetic-refresh")
            scheduler._run_eval_reminder()
        self.assertNotIn("synthetic", " ".join(logs.output))


if __name__ == "__main__":
    unittest.main()
