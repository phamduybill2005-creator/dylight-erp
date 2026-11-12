"""Prepare only durable reminder claims for an enabled, configured background job."""
import importlib.util
from functools import lru_cache
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.engine import Engine

from app.models import Company  # noqa: F401 — register the referenced companies metadata.
from app.zalo_reminder_models import ZaloEvaluationDailyReminder, ZaloEvaluationReminder


@lru_cache(maxsize=2)
def _schema_check(filename):
    revision = Path(__file__).resolve().parents[2] / "alembic/versions" / filename
    spec = importlib.util.spec_from_file_location("zalo_reminder_schema_revision", revision)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.check_schema


def prepare_reminder_schema(engine: Engine) -> None:
    """Create only reminder tables; preserve claims and reject incompatible existing schemas.

    Reuse the frozen migration's full schema check without invoking Alembic's
    process-global operation proxy from concurrent scheduler threads.
    """
    with engine.begin() as connection:
        if connection.dialect.name == "postgresql":
            connection.execute(text("SELECT pg_advisory_xact_lock(726102727)"))
        for model, filename in (
            (ZaloEvaluationReminder, "e18c27a6d904_add_zalo_evaluation_reminders.py"),
            (ZaloEvaluationDailyReminder, "h60c33d8e142_add_daily_evaluation_reminders.py"),
        ):
            check = _schema_check(filename)
            if not check(connection):
                model.__table__.create(connection, checkfirst=True)
            if not check(connection):
                raise RuntimeError("Reminder claim schema is unavailable.")
