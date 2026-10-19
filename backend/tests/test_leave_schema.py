"""Legacy PostgreSQL enums must accept withdrawal before the API starts."""
import unittest
from unittest.mock import MagicMock, patch
from sqlalchemy.dialects import postgresql, sqlite
from app.leave_schema import ensure_leave_canceled_status


class LeaveSchemaTests(unittest.TestCase):
    def engine(self, labels=("PENDING", "APPROVED", "REJECTED")):
        engine = MagicMock()
        engine.dialect = postgresql.dialect()
        inspector = MagicMock()
        inspector.has_table.return_value = True
        inspector.get_columns.return_value = [{"name": "status", "type": postgresql.ENUM(*labels, name="leavestatus")}]
        return engine, inspector

    def test_existing_postgres_enum_gets_only_additive_status(self):
        engine, inspector = self.engine()
        with patch("app.leave_schema.inspect", return_value=inspector):
            ensure_leave_canceled_status(engine)
        conn = engine.begin.return_value.__enter__.return_value
        self.assertEqual(str(conn.execute.call_args.args[0]), "ALTER TYPE leavestatus ADD VALUE IF NOT EXISTS 'CANCELED'")
        engine.begin.return_value.__exit__.assert_called_once_with(None, None, None)

    def test_existing_value_and_sqlite_need_no_schema_write(self):
        engine, inspector = self.engine(("PENDING", "APPROVED", "REJECTED", "CANCELED"))
        with patch("app.leave_schema.inspect", return_value=inspector):
            ensure_leave_canceled_status(engine)
        engine.begin.return_value.__enter__.return_value.execute.assert_not_called()
        engine.dialect = sqlite.dialect()
        engine.reset_mock()
        ensure_leave_canceled_status(engine)
        engine.begin.assert_not_called()

    def test_legacy_varchar_status_needs_no_enum_migration(self):
        from sqlalchemy import String
        engine, inspector = self.engine()
        inspector.get_columns.return_value = [{"name": "status", "type": String(8)}]
        with patch("app.leave_schema.inspect", return_value=inspector):
            ensure_leave_canceled_status(engine)
        engine.begin.return_value.__enter__.return_value.execute.assert_not_called()

    def test_schema_failure_is_not_silently_ignored(self):
        engine, inspector = self.engine()
        engine.begin.return_value.__enter__.return_value.execute.side_effect = RuntimeError("test DDL failure")
        with patch("app.leave_schema.inspect", return_value=inspector), self.assertRaises(RuntimeError):
            ensure_leave_canceled_status(engine)
