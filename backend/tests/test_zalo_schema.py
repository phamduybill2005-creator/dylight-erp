"""Migration tests use only disposable databases; never the configured ERP database."""
import importlib.util
import io
import os
from pathlib import Path
import unittest
import subprocess
import sys
import tempfile

os.environ.update(DATABASE_URL="sqlite:///:memory:", AUTO_SEED="false", YUNATT_ENABLED="false", ZALO_ENABLED="false")

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

REVISION = Path(__file__).resolve().parents[1] / "alembic/versions/c72d40e9a615_add_zalo_oauth.py"


class ZaloSchemaTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location("zalo_revision", REVISION)
        self.revision = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.revision)
        self.engine = sa.create_engine("sqlite:///:memory:")
        with self.engine.begin() as conn:
            conn.execute(sa.text("CREATE TABLE companies (id INTEGER PRIMARY KEY, name TEXT)"))
            conn.execute(sa.text("CREATE TABLE users (id INTEGER PRIMARY KEY)"))
            conn.execute(sa.text("INSERT INTO companies VALUES (1, 'Existing ERP data')"))
        self.addCleanup(self.engine.dispose)

    def upgrade(self):
        with self.engine.begin() as conn:
            with Operations.context(MigrationContext.configure(conn)):
                self.revision.upgrade()

    def test_adds_only_two_tables_preserves_erp_and_is_idempotent(self):
        self.upgrade()
        self.upgrade()
        with self.engine.connect() as conn:
            self.assertEqual(set(sa.inspect(conn).get_table_names()), {
                "companies", "users", "zalo_oauth_transactions", "zalo_oa_credentials"})
            self.assertTrue(self.revision.check_schema(conn))
            self.assertEqual(conn.scalar(sa.text("SELECT name FROM companies WHERE id=1")), "Existing ERP data")
            self.assertNotIn("alembic_version", sa.inspect(conn).get_table_names())

    def test_check_only_does_not_create_tables(self):
        with self.engine.connect() as conn:
            self.assertFalse(self.revision.check_schema(conn))
            self.assertEqual(set(sa.inspect(conn).get_table_names()), {"companies", "users"})

    def test_migration_and_orm_schema_match(self):
        from app.database import Base
        import app.models
        from app.zalo_models import ZALO_TABLE_NAMES
        Base.metadata.create_all(self.engine, tables=[Base.metadata.tables[name] for name in ZALO_TABLE_NAMES])
        with self.engine.connect() as conn:
            self.assertTrue(self.revision.check_schema(conn))
        self.upgrade()  # Existing compatible schema is safe even without an Alembic baseline.

    def test_prepare_script_defaults_to_read_only_and_applies_only_isolated_revision(self):
        script = REVISION.parents[2] / "scripts/zalo_prepare_db.py"
        with tempfile.TemporaryDirectory() as directory:
            url = "sqlite:///" + str(Path(directory) / "disposable.db")
            engine = sa.create_engine(url)
            with engine.begin() as conn:
                conn.execute(sa.text("CREATE TABLE companies (id INTEGER PRIMARY KEY)"))
                conn.execute(sa.text("CREATE TABLE users (id INTEGER PRIMARY KEY)"))
            engine.dispose()
            env = {**os.environ, "DATABASE_URL": url, "DEBUG": "true", "ZALO_ENABLED": "false"}
            def run(*args):
                result = subprocess.run([sys.executable, str(script), *args], cwd=directory, env=env,
                                        capture_output=True, text=True, timeout=15)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                return result.stdout
            self.assertIn("Check only", run())
            engine = sa.create_engine(url)
            self.assertEqual(set(sa.inspect(engine).get_table_names()), {"companies", "users"})
            engine.dispose()
            self.assertIn("ready", run("--apply"))
            self.assertIn("ready", run())
            engine = sa.create_engine(url)
            self.assertEqual(set(sa.inspect(engine).get_table_names()), {"companies", "users", *self.revision.SPECS})
            engine.dispose()

    def test_partial_schema_rejected(self):
        with self.engine.begin() as conn:
            conn.execute(sa.text("CREATE TABLE zalo_oa_credentials (id INTEGER PRIMARY KEY)"))
        with self.assertRaises(RuntimeError):
            self.upgrade()

    def test_wrong_existing_schema_rejected(self):
        self.upgrade()
        with self.engine.begin() as conn:
            conn.execute(sa.text("ALTER TABLE zalo_oa_credentials ADD COLUMN unexpected TEXT"))
        with self.assertRaises(RuntimeError):
            self.upgrade()

    def test_missing_business_tables_rejected_without_ddl(self):
        with self.engine.begin() as conn:
            conn.execute(sa.text("DROP TABLE users"))
        with self.assertRaises(RuntimeError):
            self.upgrade()
        self.assertNotIn("zalo_oa_credentials", sa.inspect(self.engine).get_table_names())

    def test_downgrade_only_removes_zalo_tables(self):
        self.upgrade()
        with self.engine.begin() as conn:
            with Operations.context(MigrationContext.configure(conn)):
                self.revision.downgrade()
        self.assertEqual(set(sa.inspect(self.engine).get_table_names()), {"companies", "users"})

    def test_postgresql_offline_sql_is_isolated(self):
        output = io.StringIO()
        context = MigrationContext.configure(dialect_name="postgresql", opts={"as_sql": True, "output_buffer": output})
        with Operations.context(context):
            self.revision.upgrade()
        sql = output.getvalue()
        self.assertEqual(sql.count("CREATE TABLE"), 2)
        self.assertIn("REFERENCES companies (id)", sql)
        self.assertIn("REFERENCES users (id)", sql)
        self.assertIn("access_token_encrypted", sql)
        self.assertNotIn("ALTER TABLE", sql)
        self.assertNotIn("DROP TABLE", sql)


if __name__ == "__main__":
    unittest.main()
