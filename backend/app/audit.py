"""Tiện ích ghi nhật ký hoạt động (audit log) — ai làm gì, lúc nào."""
from sqlalchemy.orm import Session

from app.models import ActivityLog, User


def log_activity(
    db: Session,
    user: User,
    action: str,
    entity_type: str | None = None,
    entity_id: int | None = None,
    detail: str | None = None,
) -> None:
    """Ghi 1 dòng audit. Tự nuốt lỗi để không làm hỏng nghiệp vụ chính."""
    try:
        db.add(ActivityLog(
            company_id=user.company_id, user_id=user.id, action=action,
            entity_type=entity_type, entity_id=entity_id, detail=detail,
        ))
        db.commit()
    except Exception:
        db.rollback()
