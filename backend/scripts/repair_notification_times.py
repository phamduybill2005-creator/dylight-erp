"""Preview and repair independently verified UTC-naive notification times.

Run from backend: python -m scripts.repair_notification_times --help
Never infer a historical timezone from the hour or apply a global +7 shift.
"""
import argparse
import json
import re
from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy import and_, or_, update
from app.models import Notification

_OFFSET = timedelta(hours=7)


def build_plan(db, company_id, minutes):
    if not isinstance(company_id, int) or company_id <= 0 or not minutes:
        raise ValueError("A company and explicitly verified UTC minutes are required.")
    ranges = []
    for value in minutes:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}", value):
            raise ValueError("UTC minutes must use YYYY-MM-DDTHH:MM, without an offset.")
        start = datetime.fromisoformat(value)
        ranges.append(and_(Notification.created_at >= start,
                           Notification.created_at < start + timedelta(minutes=1)))
    rows = (db.query(Notification).filter(Notification.company_id == company_id, or_(*ranges))
            .order_by(Notification.id).all())
    return {"version": 1, "company_id": company_id, "verified_source_timezone": "UTC", "rows": [
        {"id": row.id, "recipient_id": row.recipient_id, "title": row.title,
         "before": row.created_at.isoformat(), "after": (row.created_at + _OFFSET).isoformat()}
        for row in rows
    ]}


def apply_plan(db, plan):
    """Apply reviewed exact IDs atomically; stale plans and reruns fail closed."""
    try:
        company_id = plan["company_id"]
        if (plan.get("version") != 1 or plan.get("verified_source_timezone") != "UTC"
                or not isinstance(company_id, int) or company_id <= 0 or not plan["rows"]):
            raise ValueError("Invalid or empty repair plan.")
        seen = set()
        changes = []
        for item in plan["rows"]:
            row_id = item["id"]
            before, after = (datetime.fromisoformat(item[key]) for key in ("before", "after"))
            if (not isinstance(row_id, int) or row_id in seen or before.tzinfo is not None
                    or after.tzinfo is not None or after - before != _OFFSET):
                raise ValueError("Each unique row must have an exact naive UTC-to-VN conversion.")
            seen.add(row_id)
            row = (db.query(Notification).filter(Notification.id == row_id,
                    Notification.company_id == company_id).with_for_update().populate_existing().first())
            if row is None or row.created_at != before:
                raise ValueError(f"Notification {row_id} is missing, changed or already repaired.")
            changes.append((row_id, before, after))
        for row_id, before, after in changes:
            result = db.execute(update(Notification).where(
                Notification.id == row_id, Notification.company_id == company_id,
                Notification.created_at == before,
            ).values(created_at=after))
            if result.rowcount != 1:
                raise ValueError(f"Notification {row_id} changed while applying the plan.")
        db.commit()
        db.expire_all()
        return len(changes)
    except Exception:
        db.rollback()
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    preview = commands.add_parser("preview", help="Read only; create a plan for human review")
    preview.add_argument("--company-id", type=int, required=True)
    preview.add_argument("--utc-minute", action="append", required=True)
    preview.add_argument("--output", type=Path, required=True)
    apply = commands.add_parser("apply", help="Apply a reviewed plan to the configured database")
    apply.add_argument("plan", type=Path)
    args = parser.parse_args()
    # Load the configured database only when executing the CLI, never during import.
    from app.database import SessionLocal
    try:
        with SessionLocal() as db:
            if args.command == "preview":
                plan = build_plan(db, args.company_id, args.utc_minute)
                with args.output.open("x", encoding="utf-8") as output:
                    json.dump(plan, output, ensure_ascii=False, indent=2)
                print(f"Preview only: {len(plan['rows'])} rows. Review {args.output} before apply.")
            else:
                plan = json.loads(args.plan.read_text(encoding="utf-8"))
                count = apply_plan(db, plan)
                print(f"Repaired {count} notifications. Keep the plan as the before/after record.")
    except (ValueError, KeyError, TypeError, OSError) as exc:
        parser.exit(1, f"Repair stopped: {exc}\n")


if __name__ == "__main__":
    main()
