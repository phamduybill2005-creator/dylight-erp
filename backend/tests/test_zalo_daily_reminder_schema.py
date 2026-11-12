"""Daily claims are isolated and do not rewrite monthly claims or schema version."""
import importlib.util
import io
import unittest

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from tests import test_zalo_reminder_schema as fixtures


class ZaloDailyReminderSchemaTests(unittest.TestCase):
    def setUp(self):
        fixtures.ZaloReminderSchemaTests.setUp(self)
        path = fixtures.BACKEND / "alembic/versions/h60c33d8e142_add_daily_evaluation_reminders.py"
        spec = importlib.util.spec_from_file_location("daily_reminder_revision", path)
        self.revision = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.revision)

    upgrade = fixtures.ZaloReminderSchemaTests.upgrade

    def test_frozen_revision_creates_only_daily_table_and_matches_model(self):
        with self.engine.connect() as connection:
            self.assertFalse(self.revision.check_schema(connection))
        self.upgrade(); self.upgrade()
        self.assertEqual(set(sa.inspect(self.engine).get_table_names()),
                         {"companies", "alembic_version", "zalo_evaluation_daily_reminders"})
        from app.zalo_reminder_models import ZaloEvaluationDailyReminder
        ZaloEvaluationDailyReminder.__table__.drop(self.engine)
        ZaloEvaluationDailyReminder.__table__.create(self.engine)
        with self.engine.connect() as connection:
            self.assertTrue(self.revision.check_schema(connection))

    def test_worker_preparation_keeps_both_claim_tables_and_revision_unchanged(self):
        from app.services.zalo_reminder_schema import prepare_reminder_schema
        prepare_reminder_schema(self.engine)
        with self.engine.begin() as connection:
            for table, period, status in (("zalo_evaluation_reminders", "2026-11", "sent"),
                    ("zalo_evaluation_daily_reminders", "2026-11-02", "complete")):
                connection.execute(sa.text(f"INSERT INTO {table} "
                    "(company_id,period,oa_id,group_id,status,claimed_at) VALUES (1,:period,'oa','group',:status,'2026-11-02 01:00:00')"),
                    {"period": period, "status": status})
        prepare_reminder_schema(self.engine)
        with self.engine.connect() as connection:
            self.assertEqual(connection.scalar(sa.text("SELECT status FROM zalo_evaluation_reminders")), "sent")
            self.assertEqual(connection.scalar(sa.text("SELECT status FROM zalo_evaluation_daily_reminders")), "complete")
            self.assertEqual(connection.scalar(sa.text("SELECT version_num FROM alembic_version")), "production-baseline")
        self.assertEqual(set(sa.inspect(self.engine).get_table_names()),
                         {"companies", "alembic_version", "zalo_evaluation_reminders", "zalo_evaluation_daily_reminders"})

    def test_incompatible_daily_schema_fails_closed_and_offline_sql_only_creates_daily_table(self):
        with self.engine.begin() as connection:
            connection.execute(sa.text("CREATE TABLE zalo_evaluation_daily_reminders (id INTEGER PRIMARY KEY)"))
        with self.assertRaises(RuntimeError): self.upgrade()
        self.assertEqual([c["name"] for c in sa.inspect(self.engine).get_columns("zalo_evaluation_daily_reminders")], ["id"])
        output = io.StringIO()
        context = MigrationContext.configure(dialect_name="postgresql", opts={"as_sql": True, "output_buffer": output})
        with Operations.context(context): self.revision.upgrade()
        self.assertEqual(output.getvalue().count("CREATE TABLE"), 1)
        self.assertNotIn("ALTER TABLE", output.getvalue())
        self.assertIn("PRIMARY KEY (company_id, period)", output.getvalue())
