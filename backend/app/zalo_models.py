"""Private integration models. Timestamps here are UTC, stored without timezone."""
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

ZALO_TABLE_NAMES = frozenset({"zalo_oauth_transactions", "zalo_oa_credentials"})


class ZaloOAuthTransaction(Base):
    __tablename__ = "zalo_oauth_transactions"

    state_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    browser_hash: Mapped[str] = mapped_column(String(64))
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    admin_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    token_version: Mapped[int] = mapped_column(Integer)
    app_id: Mapped[str] = mapped_column(String(100))
    oa_id: Mapped[str] = mapped_column(String(100))
    callback_url: Mapped[str] = mapped_column(Text)
    code_verifier_encrypted: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime)
    status: Mapped[str] = mapped_column(String(30))


class ZaloOACredential(Base):
    __tablename__ = "zalo_oa_credentials"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), unique=True)
    oa_id: Mapped[str] = mapped_column(String(100), unique=True)
    app_id: Mapped[str] = mapped_column(String(100))
    access_token_encrypted: Mapped[str] = mapped_column(Text)
    refresh_token_encrypted: Mapped[str] = mapped_column(Text)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    updated_at: Mapped[datetime] = mapped_column(DateTime)
    generation: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(30))
