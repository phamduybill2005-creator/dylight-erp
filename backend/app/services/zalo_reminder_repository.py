"""Commit a unique company/period claim before external HTTP; never reclaim it."""
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.services.zalo_repository import utc_now
from app.zalo_reminder_models import ZaloEvaluationReminder


class ZaloReminderRepository:
    def __init__(self, db: Session, model=ZaloEvaluationReminder):
        self.db = db
        self.model = model

    def claim(self, company_id: int, period: str, oa_id: str, group_id: str) -> bool:
        self.db.add(self.model(company_id=company_id, period=period,
            oa_id=oa_id, group_id=group_id, status="claimed", claimed_at=utc_now()))
        try:
            self.db.commit()
        except IntegrityError:
            self.db.rollback()
            if self.db.get(self.model, (company_id, period)) is not None:
                return False
            raise
        return True

    def finish(self, company_id: int, period: str, status: str) -> None:
        self.db.execute(update(self.model).where(
            self.model.company_id == company_id,
            self.model.period == period,
            self.model.status == "claimed",
        ).values(status=status, finished_at=utc_now()))
        self.db.commit()
