"""New chat/notification timestamps use VN wall time even when the DB clock is UTC."""
import os
import unittest
from datetime import datetime
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite+pysqlite:///:memory:"
os.environ["DEBUG"] = "true"

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.database import Base
from app.models import Company, User, UserRole, Notification, Conversation, ConversationType, ChatMessage


class VietnamNotificationTimeTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine, expire_on_commit=False)()
        company = Company(name="Timezone test", code="VN-CLOCK")
        self.db.add(company)
        self.db.flush()
        self.user = User(company_id=company.id, email="clock@example.invalid", full_name="Clock", role=UserRole.DIRECTOR, hashed_password="unused")
        self.db.add(self.user)
        self.db.flush()
        self.room = Conversation(company_id=company.id, type=ConversationType.GROUP, title="Clock")
        self.db.add(self.room)
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_manual_and_system_notifications_use_application_vietnam_clock(self):
        utc_time = datetime(2026, 10, 15, 1, 2, 3)
        expected = datetime(2026, 10, 15, 8, 2, 3)
        with patch("app.database.datetime") as clock:
            clock.utcnow.return_value = utc_time
            rows = [Notification(company_id=self.user.company_id, sender_id=sender, recipient_id=self.user.id, title="Clock test") for sender in [None, self.user.id]]
            self.db.add_all(rows)
            self.db.commit()
        for row in rows:
            self.db.refresh(row)
            self.assertEqual(row.created_at, expected)

    def test_chat_default_does_not_fall_back_to_utc_database_clock(self):
        with patch("app.database.datetime") as clock:
            clock.utcnow.return_value = datetime(2026, 10, 15, 1, 2, 3)
            message = ChatMessage(company_id=self.user.company_id, conversation_id=self.room.id, sender_id=self.user.id, body="Clock test")
            self.db.add(message)
            self.db.commit()
        self.db.refresh(message)
        self.assertEqual(message.created_at, datetime(2026, 10, 15, 8, 2, 3))

    def test_explicit_legacy_time_is_never_overwritten_by_new_default(self):
        legacy = datetime(2026, 9, 24, 2, 26)
        notification = Notification(company_id=self.user.company_id, recipient_id=self.user.id, title="History", created_at=legacy)
        self.db.add(notification)
        self.db.commit()
        notification.is_read = True
        self.db.commit()
        self.db.refresh(notification)
        self.assertEqual(notification.created_at, legacy)
