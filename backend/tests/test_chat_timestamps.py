"""Use the room's authoritative last-send clock; do not reinterpret mixed legacy dates."""
import os
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite+pysqlite:///:memory:"
os.environ["DEBUG"] = "true"

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.deps import get_current_user
from app.models import Company, Conversation, ConversationMember, ConversationType, ChatMessage, User, UserRole
from app.routers.chat import router


class ChatTimestampTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        with self.sessions() as db:
            company = Company(name="Clock test", code="CHAT-CLOCK")
            db.add(company)
            db.flush()
            self.user = User(company_id=company.id, email="clock@example.invalid", full_name="Clock test", role=UserRole.FIELD_STAFF, hashed_password="unused")
            db.add(self.user)
            db.flush()
            self.room = Conversation(company_id=company.id, type=ConversationType.GROUP, title="Test clock", created_by_id=self.user.id)
            db.add(self.room)
            db.flush()
            db.add(ConversationMember(company_id=company.id, conversation_id=self.room.id, user_id=self.user.id))
            db.commit()
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_db] = self.database
        app.dependency_overrides[get_current_user] = lambda: self.user
        self.client = TestClient(app)

    def database(self):
        with self.sessions() as db:
            yield db

    def tearDown(self):
        self.client.close()
        self.engine.dispose()

    def test_new_message_and_room_preview_represent_the_same_instant(self):
        instant = datetime(2026, 9, 24, 2, 26, tzinfo=timezone.utc)
        with patch("app.routers.chat.datetime") as clock:
            clock.now.return_value = instant
            response = self.client.post(f"/chat/conversations/{self.room.id}/messages", json={"body": "Clock fixture"})
        self.assertEqual(response.status_code, 201, response.text)
        message_time = datetime.fromisoformat(response.json()["created_at"])
        self.assertIsNotNone(message_time.tzinfo)
        self.assertEqual(message_time, instant)
        room = self.client.get(f"/chat/conversations/{self.room.id}").json()
        preview_time = datetime.fromisoformat(room["last_message_at"])
        self.assertEqual(preview_time, instant)
        with self.sessions() as db:
            self.assertEqual(db.get(ChatMessage, response.json()["id"]).created_at, datetime(2026, 9, 24, 9, 26))
            self.assertEqual(db.get(Conversation, self.room.id).last_message_at, datetime(2026, 9, 24, 9, 26))

    def test_last_legacy_utc_message_uses_verified_room_clock_without_rewriting_history(self):
        legacy = datetime(2026, 9, 24, 2, 26)
        with self.sessions() as db:
            row = ChatMessage(company_id=self.user.company_id, conversation_id=self.room.id, sender_id=self.user.id, body="Legacy", created_at=legacy)
            db.add(row)
            db.get(Conversation, self.room.id).last_message_at = datetime(2026, 9, 24, 9, 26)
            db.commit()
            message_id = row.id
        response = self.client.get(f"/chat/conversations/{self.room.id}/messages")
        self.assertEqual(response.status_code, 200, response.text)
        timestamp = datetime.fromisoformat(response.json()[0]["created_at"])
        self.assertEqual(timestamp, legacy.replace(tzinfo=timezone.utc))
        self.assertEqual(timestamp.astimezone(timezone(timedelta(hours=7))).hour, 9)
        with self.sessions() as db:
            self.assertEqual(db.get(ChatMessage, message_id).created_at, legacy)

    def test_mixed_older_history_is_not_globally_shifted_or_tagged_as_utc(self):
        legacy_dates = [datetime(2026, 9, 24, 9, 20), datetime(2026, 9, 24, 2, 21), datetime(2026, 9, 24, 2, 26)]
        with self.sessions() as db:
            rows = [ChatMessage(company_id=self.user.company_id, conversation_id=self.room.id, sender_id=self.user.id, body="History", created_at=value) for value in legacy_dates]
            db.add_all(rows)
            db.get(Conversation, self.room.id).last_message_at = datetime(2026, 9, 24, 9, 26)
            db.commit()
            last_id = rows[-1].id
        response = self.client.get(f"/chat/conversations/{self.room.id}/messages").json()
        self.assertEqual(datetime.fromisoformat(response[0]["created_at"]), legacy_dates[0])
        self.assertEqual(datetime.fromisoformat(response[1]["created_at"]), legacy_dates[1])
        self.assertEqual(datetime.fromisoformat(response[2]["created_at"]), datetime(2026, 9, 24, 9, 26, tzinfo=timezone(timedelta(hours=7))))
        older_page = self.client.get(f"/chat/conversations/{self.room.id}/messages", params={"before": last_id, "limit": 1}).json()
        self.assertEqual(datetime.fromisoformat(older_page[0]["created_at"]), legacy_dates[1])

    def test_legacy_vietnam_last_message_is_not_shifted_again(self):
        local_time = datetime(2026, 9, 24, 9, 26)
        with self.sessions() as db:
            db.add(ChatMessage(company_id=self.user.company_id, conversation_id=self.room.id, sender_id=self.user.id, body="Already correct", created_at=local_time))
            db.get(Conversation, self.room.id).last_message_at = local_time
            db.commit()
        response = self.client.get(f"/chat/conversations/{self.room.id}/messages").json()
        self.assertEqual(datetime.fromisoformat(response[0]["created_at"]), local_time.replace(tzinfo=timezone(timedelta(hours=7))))

    def test_legacy_room_preview_is_tagged_as_vietnam_not_shifted_again(self):
        with self.sessions() as db:
            db.get(Conversation, self.room.id).last_message_at = datetime(2026, 9, 24, 9, 26)
            db.commit()
        response = self.client.get("/chat/conversations")
        timestamp = datetime.fromisoformat(response.json()[0]["last_message_at"])
        self.assertEqual(timestamp.utcoffset(), timedelta(hours=7))
        self.assertEqual(timestamp.hour, 9)

    def test_room_without_messages_keeps_null_preview(self):
        response = self.client.get(f"/chat/conversations/{self.room.id}")
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()["last_message_at"])
