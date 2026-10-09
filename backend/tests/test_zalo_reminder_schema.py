"""The reminder migration creates one table only, on disposable databases."""
import importlib.util
import io
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

os.environ.update(DATABASE_URL="sqlite:///:memory:", DEBUG="true", AUTO_SEED="false",
                  YUNATT_ENABLED="false", ZALO_ENABLED="false", ZALO_EVAL_REMINDER_ENABLED="false")

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

BACKEND = Path(__file__).resolve().parents[1]
REVISION = BACKEND / "alembic/versions/e18c27a6d904_add_zalo_evaluation_reminders.py"


class ZaloReminderSchemaTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(REVISION.is_file(), "Isolated reminder migration is missing")
        spec = importlib.util.spec_from_file_location("reminder_revision", REVISION)
        self.revision = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.revision)
        self.engine = sa.create_engine("sqlite:///:memory:")
        self.addCleanup(self.engine.dispose)
        with self.engine.begin() as connection:
            connection.execute(sa.text("CREATE TABLE companies (id INTEGER PRIMARY KEY, name TEXT)"))
            connection.execute(sa.text("INSERT INTO companies VALUES (1, 'Existing ERP')"))
            connection.execute(sa.text("CREATE TABLE alembic_version (version_num VARCHAR(32) PRIMARY KEY)"))
            connection.execute(sa.text("INSERT INTO alembic_version VALUES ('production-baseline')"))

    def upgrade(self):
        with self.engine.begin() as connection:
            with Operations.context(MigrationContext.configure(connection)):
                self.revision.upgrade()

    def test_check_is_read_only_then_apply_creates_one_table_and_preserves_baseline(self):
        with self.engine.connect() as connection:
            self.assertFalse(self.revision.check_schema(connection))
        self.assertEqual(set(sa.inspect(self.engine).get_table_names()), {"companies", "alembic_version"})
        self.upgrade()
        self.upgrade()
        with self.engine.connect() as connection:
            self.assertTrue(self.revision.check_schema(connection))
            self.assertEqual(connection.scalar(sa.text("SELECT name FROM companies WHERE id=1")), "Existing ERP")
            self.assertEqual(connection.scalar(sa.text("SELECT version_num FROM alembic_version")), "production-baseline")
        self.assertEqual(set(sa.inspect(self.engine).get_table_names()),
                         {"companies", "alembic_version", "zalo_evaluation_reminders"})

    def test_orm_schema_matches_migration_including_company_month_primary_key(self):
        import app.models  # Register the referenced companies table.
        from app.zalo_reminder_models import ZaloEvaluationReminder
        ZaloEvaluationReminder.__table__.create(self.engine)
        with self.engine.connect() as connection:
            self.assertTrue(self.revision.check_schema(connection))
        self.upgrade()

    def test_incompatible_existing_schema_is_rejected_without_mutation(self):
        with self.engine.begin() as connection:
            connection.execute(sa.text("CREATE TABLE zalo_evaluation_reminders (id INTEGER PRIMARY KEY)"))
        with self.assertRaises(RuntimeError):
            self.upgrade()
        self.assertEqual([c["name"] for c in sa.inspect(self.engine).get_columns("zalo_evaluation_reminders")], ["id"])

    def test_missing_erp_company_table_is_rejected(self):
        with self.engine.begin() as connection:
            connection.execute(sa.text("DROP TABLE companies"))
        with self.assertRaises(RuntimeError):
            self.upgrade()
        self.assertFalse(sa.inspect(self.engine).has_table("zalo_evaluation_reminders"))

    def test_offline_sql_creates_one_table_without_other_migrations(self):
        output = io.StringIO()
        context = MigrationContext.configure(dialect_name="postgresql", opts={"as_sql": True, "output_buffer": output})
        with Operations.context(context):
            self.revision.upgrade()
        sql = output.getvalue()
        self.assertEqual(sql.count("CREATE TABLE"), 1)
        self.assertIn("PRIMARY KEY (company_id, period)", sql)
        self.assertIn("REFERENCES companies (id)", sql)
        self.assertNotIn("ALTER TABLE", sql)
        self.assertNotIn("access_token", sql)

    def test_helper_defaults_to_check_only_and_apply_preserves_alembic_version(self):
        script = BACKEND / "scripts/zalo_prepare_reminders.py"
        self.assertTrue(script.is_file(), "Reminder preparation script is missing")
        with tempfile.TemporaryDirectory() as directory:
            url = "sqlite:///" + str(Path(directory) / "test.db")
            engine = sa.create_engine(url)
            with engine.begin() as connection:
                connection.execute(sa.text("CREATE TABLE companies (id INTEGER PRIMARY KEY)"))
                connection.execute(sa.text("CREATE TABLE alembic_version (version_num VARCHAR(32) PRIMARY KEY)"))
                connection.execute(sa.text("INSERT INTO alembic_version VALUES ('keep-this-revision')"))
            engine.dispose()
            env = {**os.environ, "DATABASE_URL": url, "DEBUG": "true", "ZALO_ENABLED": "false"}
            def run(*args):
                result = subprocess.run([sys.executable, str(script), *args], env=env, cwd=directory,
                    capture_output=True, text=True, timeout=15)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                return result.stdout
            self.assertIn("Check only", run())
            engine = sa.create_engine(url)
            self.assertFalse(sa.inspect(engine).has_table("zalo_evaluation_reminders"))
            engine.dispose()
            self.assertIn("ready", run("--apply"))
            self.assertIn("ready", run("--apply"))
            engine = sa.create_engine(url)
            with engine.connect() as connection:
                self.assertEqual(connection.scalar(sa.text("SELECT version_num FROM alembic_version")), "keep-this-revision")
            self.assertEqual(set(sa.inspect(engine).get_table_names()),
                             {"companies", "alembic_version", "zalo_evaluation_reminders"})
            engine.dispose()


if __name__ == "__main__":
    unittest.main()
