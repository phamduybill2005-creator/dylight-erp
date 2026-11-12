"""Automatic Zalo reminder activation and isolated background schema preparation."""
import importlib
import os
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import Settings
from app.models import Company
from app.services import scheduler
from app.services.evaluation_zalo_service import EvaluationZaloService


class EvaluationZaloActivationTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
        self.addCleanup(self.engine.dispose)
        Company.__table__.create(self.engine)
        with self.engine.begin() as connection:
            connection.execute(text("CREATE TABLE alembic_version (version_num VARCHAR(32) PRIMARY KEY)"))
            connection.execute(text("INSERT INTO alembic_version VALUES ('production-baseline')"))
        self.sessions = sessionmaker(bind=self.engine)
        self.config = Settings(_env_file=None, DEBUG=True, ZALO_ENABLED=True, ZALO_EVAL_REMINDER_ENABLED=True,
                               ZALO_COMPANY_ID=1, ZALO_GMF_GROUP_ID="synthetic-group")

    def preparer(self):
        try:
            return importlib.import_module("app.services.zalo_reminder_schema").prepare_reminder_schema
        except ModuleNotFoundError:
            self.fail("Configured reminder workers must prepare their isolated claim schema.")

    def test_existing_zalo_installation_enables_reminder_by_default_but_explicit_false_is_respected(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("ZALO_EVAL_REMINDER_ENABLED", None)
            config = Settings(_env_file=None, DEBUG=True, ZALO_ENABLED=True)
            self.assertTrue(config.ZALO_EVAL_REMINDER_ENABLED)
            self.assertFalse(Settings(_env_file=None, DEBUG=True, ZALO_ENABLED=True,
                                      ZALO_EVAL_REMINDER_ENABLED=False).ZALO_EVAL_REMINDER_ENABLED)

    def test_background_worker_prepares_schema_before_checking_due_without_provider_http(self):
        checked = []
        def due_check():
            checked.append(inspect(self.engine).has_table("zalo_evaluation_reminders"))
            return {"status": "skipped", "reason": "not_due"}
        with patch.object(scheduler, "settings", self.config), \
             patch("app.database.SessionLocal", self.sessions), \
             patch.object(EvaluationZaloService, "run_due", side_effect=due_check):
            scheduler._run_eval_reminder()
        self.assertEqual(checked, [True])
        self.assertEqual(set(inspect(self.engine).get_table_names()),
                         {"companies", "alembic_version", "zalo_evaluation_reminders", "zalo_evaluation_daily_reminders"})

    def test_preparation_is_idempotent_and_keeps_prior_claims_and_schema_version(self):
        prepare = self.preparer()
        prepare(self.engine)
        with self.engine.begin() as connection:
            connection.execute(text("INSERT INTO zalo_evaluation_reminders "
                "(company_id,period,oa_id,group_id,status,claimed_at) "
                "VALUES (1,'2026-10','synthetic-oa','synthetic-group','failed','2026-10-27 01:00:00')"))
        prepare(self.engine)
        with self.engine.connect() as connection:
            self.assertEqual(connection.scalar(text("SELECT status FROM zalo_evaluation_reminders")), "failed")
            self.assertEqual(connection.scalar(text("SELECT version_num FROM alembic_version")), "production-baseline")
        self.assertEqual(set(inspect(self.engine).get_table_names()),
                         {"companies", "alembic_version", "zalo_evaluation_reminders", "zalo_evaluation_daily_reminders"})

    def test_incompatible_daily_schema_prevents_sender_without_mutation(self):
        with self.engine.begin() as connection:
            connection.execute(text("CREATE TABLE zalo_evaluation_daily_reminders (id INTEGER PRIMARY KEY)"))
        with patch.object(scheduler, "settings", self.config), \
             patch("app.database.SessionLocal", self.sessions), \
             patch.object(EvaluationZaloService, "run_due") as send, \
             self.assertLogs("app.services.scheduler", level="WARNING"):
            scheduler._run_eval_reminder()
        send.assert_not_called()
        self.assertEqual([column["name"] for column in inspect(self.engine).get_columns("zalo_evaluation_daily_reminders")], ["id"])

    def test_incompatible_schema_prevents_sender_without_mutating_it(self):
        with self.engine.begin() as connection:
            connection.execute(text("CREATE TABLE zalo_evaluation_reminders (id INTEGER PRIMARY KEY)"))
        with patch.object(scheduler, "settings", self.config), \
             patch("app.database.SessionLocal", self.sessions), \
             patch.object(EvaluationZaloService, "run_due") as send, \
             self.assertLogs("app.services.scheduler", level="WARNING"):
            scheduler._run_eval_reminder()
        send.assert_not_called()
        self.assertEqual([column["name"] for column in inspect(self.engine).get_columns("zalo_evaluation_reminders")], ["id"])

    def test_disabled_or_missing_group_worker_does_not_create_schema(self):
        for field, value in (("ZALO_ENABLED", False), ("ZALO_EVAL_REMINDER_ENABLED", False),
                             ("ZALO_GMF_GROUP_ID", ""), ("ZALO_COMPANY_ID", 0)):
            original = getattr(self.config, field)
            setattr(self.config, field, value)
            with patch.object(scheduler, "settings", self.config), \
                 patch("app.database.SessionLocal", self.sessions), \
                 patch.object(EvaluationZaloService, "run_due", return_value={"status": "skipped", "reason": "disabled"}):
                scheduler._run_eval_reminder()
            self.assertFalse(inspect(self.engine).has_table("zalo_evaluation_reminders"))
            setattr(self.config, field, original)


if __name__ == "__main__":
    unittest.main()
