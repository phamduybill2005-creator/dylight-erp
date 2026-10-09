"""Durable monthly GMF claims; no tokens or message bodies are stored here."""
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

ZALO_REMINDER_TABLE_NAMES = frozenset({"zalo_evaluation_reminders"})


class ZaloEvaluationReminder(Base):
    __tablename__ = "zalo_evaluation_reminders"

    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), primary_key=True)
    period: Mapped[str] = mapped_column(String(7), primary_key=True)  # YYYY-MM in Vietnam
    oa_id: Mapped[str] = mapped_column(String(100))
    group_id: Mapped[str] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(20))  # claimed / sent / failed
    claimed_at: Mapped[datetime] = mapped_column(DateTime)  # UTC, naive
    finished_at: Mapped[datetime | None] = mapped_column(DateTime)
