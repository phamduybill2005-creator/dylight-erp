"""Check by default; --apply creates only the monthly reminder table, never upgrade head."""
import argparse
import importlib.util
from pathlib import Path
import sys

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Apply only the reminder table migration")
    args = parser.parse_args()
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy.exc import SQLAlchemyError
    from app.database import engine

    spec = importlib.util.spec_from_file_location("reminder_revision",
        BACKEND / "alembic/versions/e18c27a6d904_add_zalo_evaluation_reminders.py")
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    try:
        with engine.begin() as connection:
            if args.apply:
                with Operations.context(MigrationContext.configure(connection)):
                    migration.upgrade()
            present = migration.check_schema(connection)
        print("Zalo reminder schema ready." if present else "Reminder migration pending. Check only; no changes made.")
        return 0
    except (SQLAlchemyError, RuntimeError):
        print("Reminder schema check/apply failed. Review connectivity/schema; no automatic stamping.", file=sys.stderr)
        return 1
    finally:
        engine.dispose()


if __name__ == "__main__":
    sys.exit(main())
