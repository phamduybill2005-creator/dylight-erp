"""Repair only independently verified UTC notification timestamps."""
import json
import os
import unittest
from datetime import datetime

os.environ["DATABASE_URL"] = "sqlite+pysqlite:///:memory:"
os.environ["DEBUG"] = "true"

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.database import Base
from app.models import Company, Notification, User, UserRole
from scripts.repair_notification_times import apply_plan, build_plan


class RepairNotificationTimesTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine, expire_on_commit=False)()
        company = Company(name="Clock repair", code="CLOCK-REPAIR")
        self.db.add(company)
        self.db.flush()
        self.company_id = company.id
        user = User(company_id=company.id, email="repair@example.invalid", full_name="Repair",
                    role=UserRole.ADMIN, hashed_password="unused")
        self.db.add(user)
        self.db.flush()
        self.rows = [Notification(company_id=company.id, recipient_id=user.id, title="History",
                                  created_at=datetime(2026, 10, 15, h, m, 12), is_read=True)
                     for h, m in [(1, 24), (1, 13), (8, 30)]]
        self.db.add_all(self.rows)
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def plan(self):
        return build_plan(self.db, self.company_id, ["2026-10-15T01:24", "2026-10-15T01:13"])

    def test_preview_does_not_write_and_contains_exact_before_and_after(self):
        plan = self.plan()
        self.assertEqual(len(plan["rows"]), 2)
        self.assertEqual(self.db.get(Notification, self.rows[0].id).created_at.hour, 1)
        first = next(r for r in plan["rows"] if r["id"] == self.rows[0].id)
        self.assertEqual(first["before"], "2026-10-15T01:24:12")
        self.assertEqual(first["after"], "2026-10-15T08:24:12")

    def test_apply_only_repairs_selected_rows_and_does_not_double_shift(self):
        plan = json.loads(json.dumps(self.plan()))
        self.assertEqual(apply_plan(self.db, plan), 2)
        self.assertEqual(self.db.get(Notification, self.rows[0].id).created_at.hour, 8)
        self.assertEqual(self.db.get(Notification, self.rows[1].id).created_at.hour, 8)
        self.assertEqual(self.db.get(Notification, self.rows[2].id).created_at.hour, 8)
        self.assertTrue(all(row.is_read and row.title == "History" for row in self.rows))
        with self.assertRaises(ValueError):
            apply_plan(self.db, plan)

    def test_conflicting_or_foreign_company_rows_abort_the_whole_plan(self):
        for field, bad in [("before", "2026-10-14T01:13:12"), ("after", "2026-10-15T20:13:12")]:
            plan = self.plan()
            plan["rows"][-1][field] = bad
            with self.assertRaises(ValueError):
                apply_plan(self.db, plan)
            self.assertEqual(self.db.get(Notification, self.rows[0].id).created_at.hour, 1)
        plan = self.plan()
        plan["company_id"] += 100
        with self.assertRaises(ValueError):
            apply_plan(self.db, plan)

    def test_preview_rejects_unscoped_or_zoned_inputs(self):
        for minutes in [[], ["2026-10-15"], ["2026-10-15T01:24Z"], ["2026-10-15T01:24:01"]]:
            with self.assertRaises(ValueError):
                build_plan(self.db, self.company_id, minutes)

    def test_only_selected_company_is_previewed_and_date_rolls_over_at_midnight(self):
        self.rows[0].created_at = datetime(2026, 12, 31, 18, 24, 12)
        self.db.commit()
        self.assertEqual(build_plan(self.db, self.company_id + 100, ["2026-12-31T18:24"])["rows"], [])
        plan = build_plan(self.db, self.company_id, ["2026-12-31T18:24"])
        self.assertEqual(plan["rows"][0]["after"], "2027-01-01T01:24:12")
        apply_plan(self.db, plan)
        self.assertEqual(self.db.get(Notification, self.rows[0].id).created_at, datetime(2027, 1, 1, 1, 24, 12))
