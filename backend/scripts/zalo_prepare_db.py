"""Check by default; --apply executes only the isolated Zalo revision, never upgrade head."""
import argparse
import importlib.util
from pathlib import Path
import sys

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Explicitly apply only the two Zalo tables")
    args = parser.parse_args()
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy.exc import SQLAlchemyError
    from app.database import engine

    spec = importlib.util.spec_from_file_location("zalo_revision", BACKEND / "alembic/versions/c72d40e9a615_add_zalo_oauth.py")
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    try:
        with engine.begin() as connection:
            if args.apply:
                with Operations.context(MigrationContext.configure(connection)):
                    migration.upgrade()
            present = migration.check_schema(connection)
        print("Zalo schema ready." if present else "Zalo migration pending. Check only; no changes made.")
        return 0
    except (SQLAlchemyError, RuntimeError):
        # Database error strings can contain credentials or bound parameters.
        print("Database check/apply failed. Review connectivity and existing schema; no automatic baseline stamping.", file=sys.stderr)
        return 1
    finally:
        engine.dispose()


if __name__ == "__main__":
    sys.exit(main())
