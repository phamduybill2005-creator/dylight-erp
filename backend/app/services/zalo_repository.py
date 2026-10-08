"""Encrypted persistence, durable single-use claims and generation-checked updates."""
from datetime import datetime, timezone
from uuid import uuid4

from cryptography.fernet import Fernet
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.models import Company
from app.zalo_models import ZaloOACredential, ZaloOAuthTransaction


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class ZaloRepository:
    def __init__(self, db: Session, cipher: Fernet):
        self.db, self.cipher = db, cipher

    def encrypt(self, value: str) -> str:
        return self.cipher.encrypt(value.encode()).decode()

    def decrypt(self, value: str) -> str:
        return self.cipher.decrypt(value.encode()).decode()

    def create_attempt(self, attempt: ZaloOAuthTransaction) -> None:
        # Serialize the first attempts too, when there are no integration rows yet.
        self.db.execute(select(Company.id).where(Company.id == attempt.company_id).with_for_update())
        self.db.execute(update(ZaloOAuthTransaction).where(
            ZaloOAuthTransaction.company_id == attempt.company_id
        ).values(status="superseded", code_verifier_encrypted=None))
        self.db.execute(delete(ZaloOAuthTransaction).where(ZaloOAuthTransaction.expires_at < utc_now()))
        self.db.add(attempt)
        self.db.commit()

    def get_attempt(self, state_hash: str) -> ZaloOAuthTransaction | None:
        return self.db.scalar(select(ZaloOAuthTransaction).where(
            ZaloOAuthTransaction.state_hash == state_hash
        ).execution_options(populate_existing=True))

    def consume_attempt(self, state_hash: str, browser_hash: str) -> bool:
        result = self.db.execute(update(ZaloOAuthTransaction).where(
            ZaloOAuthTransaction.state_hash == state_hash,
            ZaloOAuthTransaction.browser_hash == browser_hash,
            ZaloOAuthTransaction.expires_at > utc_now(),
            ZaloOAuthTransaction.status == "pending",
            ZaloOAuthTransaction.consumed_at.is_(None),
        ).values(status="exchanging", consumed_at=utc_now(), code_verifier_encrypted=None))
        self.db.commit()  # Commit before HTTP so a retry cannot exchange this code again.
        return result.rowcount == 1

    def get_credentials(self, company_id: int) -> ZaloOACredential | None:
        return self.db.scalar(select(ZaloOACredential).where(
            ZaloOACredential.company_id == company_id
        ).execution_options(populate_existing=True))

    def save_connection(self, state_hash: str, company_id: int, oa_id: str, app_id: str,
                        access: str, refresh: str, expires_at: datetime) -> bool:
        # Same lock order as initiation; the latest authorization attempt wins.
        self.db.execute(select(Company.id).where(Company.id == company_id).with_for_update())
        result = self.db.execute(update(ZaloOAuthTransaction).where(
            ZaloOAuthTransaction.state_hash == state_hash,
            ZaloOAuthTransaction.status == "exchanging",
        ).values(status="completed"))
        if result.rowcount != 1:
            self.db.rollback()
            return False
        values = self._token_values(access, refresh, expires_at)
        row = self.get_credentials(company_id)
        if row is None:
            self.db.add(ZaloOACredential(company_id=company_id, oa_id=oa_id, app_id=app_id, **values))
        else:
            self.db.execute(update(ZaloOACredential).where(ZaloOACredential.id == row.id)
                            .values(oa_id=oa_id, app_id=app_id, **values))
        self.db.commit()
        return True

    def claim_refresh(self, credential_id: int, generation: str) -> bool:
        result = self.db.execute(update(ZaloOACredential).where(
            ZaloOACredential.id == credential_id, ZaloOACredential.generation == generation,
            ZaloOACredential.status == "active",
        ).values(status="refreshing", updated_at=utc_now()))
        self.db.commit()
        return result.rowcount == 1

    def finish_refresh(self, credential_id: int, generation: str, access: str, refresh: str,
                       expires_at: datetime) -> bool:
        result = self.db.execute(update(ZaloOACredential).where(
            ZaloOACredential.id == credential_id, ZaloOACredential.generation == generation,
            ZaloOACredential.status == "refreshing",
        ).values(**self._token_values(access, refresh, expires_at)))
        self.db.commit()
        return result.rowcount == 1

    def fail_refresh(self, credential_id: int, generation: str) -> None:
        self.db.rollback()
        self.db.execute(update(ZaloOACredential).where(
            ZaloOACredential.id == credential_id, ZaloOACredential.generation == generation,
            ZaloOACredential.status == "refreshing",
        ).values(status="reconnect_required", updated_at=utc_now()))
        self.db.commit()

    def _token_values(self, access: str, refresh: str, expires_at: datetime) -> dict:
        return dict(access_token_encrypted=self.encrypt(access), refresh_token_encrypted=self.encrypt(refresh),
                    expires_at=expires_at, updated_at=utc_now(), generation=uuid4().hex, status="active")
