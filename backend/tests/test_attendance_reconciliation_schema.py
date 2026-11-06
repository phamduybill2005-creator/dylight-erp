"""Reconciliation schema upgrades run only against disposable SQLite databases."""
import ast
from contextlib import redirect_stdout
import importlib.util
import io
from pathlib import Path
import unittest

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

BACKEND = Path(__file__).resolve().parents[1]
REVISION = BACKEND / "alembic/versions/f48a11b6c920_add_attendance_reconciliation.py"


class ReconciliationSchemaTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location("attendance_reconciliation_revision", REVISION)
        self.revision = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.revision)
        self.engine = sa.create_engine("sqlite+pysqlite:///:memory:")
        self.addCleanup(self.engine.dispose)
        with self.engine.begin() as connection:
            connection.execute(sa.text("CREATE TABLE companies (id INTEGER PRIMARY KEY, code TEXT, name TEXT)"))
            connection.execute(sa.text("INSERT INTO companies VALUES (1, 'TEST', 'Existing company')"))
            connection.execute(sa.text("CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT)"))
            connection.execute(sa.text("INSERT INTO users VALUES (2, 'FIELD_STAFF')"))
            connection.execute(sa.text("""CREATE TABLE leave_requests (
                id INTEGER PRIMARY KEY, user_id INTEGER, from_date DATE, to_date DATE,
                leave_type TEXT, source TEXT, reason TEXT)"""))
            connection.execute(sa.text("""INSERT INTO leave_requests VALUES
                (3, 2, '2026-11-05', '2026-11-05', 'LATE_MORNING', 'LEAVE', 'Existing permission')"""))
            connection.execute(sa.text("CREATE TABLE alembic_version (version_num VARCHAR(32) PRIMARY KEY)"))
            connection.execute(sa.text("INSERT INTO alembic_version VALUES ('existing-baseline')"))

    def migrate(self, direction="upgrade"):
        with self.engine.begin() as connection:
            with Operations.context(MigrationContext.configure(connection)):
                getattr(self.revision, direction)()

    def assert_business_data_preserved(self):
        with self.engine.connect() as connection:
            self.assertEqual(connection.scalar(sa.text("SELECT name FROM companies WHERE id=1")), "Existing company")
            self.assertEqual(connection.scalar(sa.text("SELECT reason FROM leave_requests WHERE id=3")), "Existing permission")
            self.assertEqual(connection.scalar(sa.text("SELECT version_num FROM alembic_version")), "existing-baseline")

    def test_upgrade_is_idempotent_and_preserves_existing_permissions_and_business_data(self):
        self.migrate()
        with self.engine.begin() as connection:
            connection.execute(sa.text("UPDATE leave_requests SET allowed_arrival_time='08:30' WHERE id=3"))
            connection.execute(sa.text("""INSERT INTO attendance_session_overrides
                (id, company_id, user_id, work_date, session, decision, reason, approved_by,
                 recorded_by_id, recorded_by_name, created_at, updated_at)
                VALUES (1, 1, 2, '2026-11-05', 'AM', 'EXCUSED_LATE', 'Existing exception',
                        'Director', 2, 'Recorder', '2026-11-06 18:00:00', '2026-11-06 18:00:00')"""))
        self.migrate()
        self.assert_business_data_preserved()
        self.assertEqual(set(sa.inspect(self.engine).get_table_names()), {
            "companies", "users", "leave_requests", "alembic_version",
            "attendance_session_overrides", "attendance_data_confirmations"})
        with self.engine.connect() as connection:
            self.assertEqual(connection.scalar(sa.text("SELECT allowed_arrival_time FROM leave_requests WHERE id=3")), "08:30")
            self.assertEqual(connection.scalar(sa.text("SELECT reason FROM attendance_session_overrides WHERE id=1")), "Existing exception")

    def test_downgrade_and_reupgrade_preserve_existing_business_rows(self):
        self.migrate()
        self.migrate("downgrade")
        self.assertEqual(set(sa.inspect(self.engine).get_table_names()), {
            "companies", "users", "leave_requests", "alembic_version"})
        self.assertNotIn("allowed_arrival_time", {column["name"] for column in sa.inspect(self.engine).get_columns("leave_requests")})
        self.assert_business_data_preserved()
        self.migrate()
        self.assertIn("allowed_arrival_time", {column["name"] for column in sa.inspect(self.engine).get_columns("leave_requests")})
        self.assert_business_data_preserved()

    def test_migration_matches_model_columns_nullability_and_session_uniqueness(self):
        from app.models import AttendanceDataConfirmation, AttendanceSessionOverride

        self.migrate()
        inspector = sa.inspect(self.engine)
        for model in (AttendanceSessionOverride, AttendanceDataConfirmation):
            with self.subTest(table=model.__tablename__):
                actual = {column["name"]: column for column in inspector.get_columns(model.__tablename__)}
                self.assertEqual(set(actual), set(model.__table__.columns.keys()))
                for column in model.__table__.columns:
                    self.assertEqual(actual[column.name]["nullable"], column.nullable, column.name)
                unique_keys = {tuple(constraint["column_names"]) for constraint in inspector.get_unique_constraints(model.__tablename__)}
                expected = ("company_id", "work_date", "session")
                if model is AttendanceSessionOverride:
                    expected = ("company_id", "user_id", "work_date", "session")
                self.assertIn(expected, unique_keys)
                foreign_keys = inspector.get_foreign_keys(model.__tablename__)
                author_field = "recorded_by_id" if model is AttendanceSessionOverride else "confirmed_by_id"
                author_key = next(key for key in foreign_keys if key["constrained_columns"] == [author_field])
                self.assertEqual(author_key["options"].get("ondelete"), "SET NULL")

    def test_startup_schema_function_adds_legacy_arrival_column_without_importing_app(self):
        # Execute only the actual migration function, avoiding app.main's global
        # engine, application startup, background schedulers and external services.
        source = (BACKEND / "app/main.py").read_text(encoding="utf-8-sig")
        parsed = ast.parse(source)
        function = next(node for node in parsed.body if isinstance(node, ast.FunctionDef)
                        and node.name == "_ensure_schema")
        module = ast.Module(body=[function], type_ignores=[])
        namespace = {"engine": self.engine, "inspect": sa.inspect, "text": sa.text}
        exec(compile(module, str(BACKEND / "app/main.py"), "exec"), namespace)
        output = io.StringIO()
        with redirect_stdout(output):
            namespace["_ensure_schema"]()
            namespace["_ensure_schema"]()
        self.assertNotIn("bo qua", output.getvalue())
        self.assertIn("allowed_arrival_time", {column["name"] for column in sa.inspect(self.engine).get_columns("leave_requests")})
        self.assert_business_data_preserved()
        self.migrate()  # Explicit migration remains safe after the startup addition.
        self.assert_business_data_preserved()


if __name__ == "__main__":
    unittest.main()
