"""Commit a unique company/month claim before external HTTP; never reclaim it."""
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.services.zalo_repository import utc_now
from app.zalo_reminder_models import ZaloEvaluationReminder


class ZaloReminderRepository:
    def __init__(self, db: Session):
        self.db = db

    def claim(self, company_id: int, period: str, oa_id: str, group_id: str) -> bool:
        self.db.add(ZaloEvaluationReminder(company_id=company_id, period=period,
            oa_id=oa_id, group_id=group_id, status="claimed", claimed_at=utc_now()))
        try:
            self.db.commit()
        except IntegrityError:
            self.db.rollback()
            if self.db.get(ZaloEvaluationReminder, (company_id, period)) is not None:
                return False
            raise
        return True

    def finish(self, company_id: int, period: str, status: str) -> None:
        self.db.execute(update(ZaloEvaluationReminder).where(
            ZaloEvaluationReminder.company_id == company_id,
            ZaloEvaluationReminder.period == period,
            ZaloEvaluationReminder.status == "claimed",
        ).values(status=status, finished_at=utc_now()))
        self.db.commit()
