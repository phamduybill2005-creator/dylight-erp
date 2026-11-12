"""Monthly web reminder calendar, real notifications and restart deduplication."""
import os
import unittest
from datetime import datetime
from unittest.mock import patch

os.environ.update(DATABASE_URL="sqlite:///:memory:", DEBUG="true", AUTO_SEED="false")

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Company, Notification, User, UserRole
from app.routers import notifications


class EvaluationWebReminderTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine, expire_on_commit=False)()
        self.addCleanup(self.engine.dispose)
        self.addCleanup(self.db.close)
        self.cache = patch.object(notifications, "_eval_reminded", set())
        self.cache.start()
        self.addCleanup(self.cache.stop)
        company = Company(name="Reminder", code="WEB-REMINDER")
        self.db.add(company)
        self.db.flush()
        self.user = User(company_id=company.id, email="test@example.invalid", full_name="Test",
                         role=UserRole.FIELD_STAFF, hashed_password="unused")
        self.db.add(self.user)
        self.db.commit()

    def remind(self, now):
        with patch.object(notifications, "vn_now", return_value=now), patch.object(notifications, "publish"):
            notifications._ensure_eval_reminder(self.db, self.user)

    def test_day_one_at_eight_reminds_previous_month_with_deadline(self):
        self.remind(datetime(2026, 11, 1, 8))
        row = self.db.query(Notification).one()
        self.assertEqual(row.title, "Đánh giá định kì tháng 10/2026")
        self.assertEqual(row.body, "Từ ngày 01 đến hết ngày 05/11/2026, mọi người vào mục Đánh giá để chấm đánh giá tháng 10/2026.")
        self.assertEqual(row.recipient_id, self.user.id)
        self.assertIsNone(row.sender_id)

    def test_window_includes_day_five_but_not_six_or_old_day_27(self):
        for now in (datetime(2026, 10, 31, 23), datetime(2026, 11, 1, 7, 59, 59),
                    datetime(2026, 11, 6), datetime(2026, 11, 27, 8)):
            self.remind(now)
        self.assertEqual(self.db.query(Notification).count(), 0)
        self.remind(datetime(2026, 11, 5, 23, 59))
        self.assertEqual(self.db.query(Notification).count(), 1)

    def test_web_catchup_on_day_two_before_eight(self):
        self.remind(datetime(2026, 11, 2, 0, 1))
        self.assertEqual(self.db.query(Notification).count(), 1)

    def test_no_duplicate_after_read_or_restart_and_next_month_new_reminder(self):
        self.remind(datetime(2026, 11, 1, 8))
        row = self.db.query(Notification).one()
        row.is_read = True
        self.db.commit()
        notifications._eval_reminded.clear()
        self.remind(datetime(2026, 11, 5, 10))
        self.assertEqual(self.db.query(Notification).count(), 1)
        self.remind(datetime(2026, 12, 1, 8))
        self.assertEqual(self.db.query(Notification).count(), 2)

    def test_january_targets_previous_december(self):
        self.remind(datetime(2027, 1, 1, 8))
        row = self.db.query(Notification).one()
        self.assertEqual(row.title, "Đánh giá định kì tháng 12/2026")
        self.assertIn("05/01/2027", row.body)

    def test_old_notification_remains_and_does_not_suppress_new_cycle(self):
        self.db.add(Notification(company_id=self.user.company_id, recipient_id=self.user.id,
                                 title="Đến hạn đánh giá tháng 10/2026", is_read=True))
        self.db.commit()
        self.remind(datetime(2026, 11, 1, 8))
        self.assertEqual(self.db.query(Notification).count(), 2)
