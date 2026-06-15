"""
Router Nhật ký hoạt động (Audit log) — tra cứu ai làm gì, lúc nào.
NHẠY CẢM: chỉ Giám đốc / Quản trị.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_roles
from app.models import ActivityLog, User, UserRole
from app.schemas import ActivityLogOut

router = APIRouter(prefix="/audit", tags=["Nhật ký hoạt động"])

_GUARD = require_roles(UserRole.DIRECTOR)


@router.get("", response_model=list[ActivityLogOut])
def list_audit(
    limit: int = 200,
    db: Session = Depends(get_db),
    current: User = Depends(_GUARD),
):
    return (
        db.query(ActivityLog)
        .filter(ActivityLog.company_id == current.company_id)
        .order_by(ActivityLog.created_at.desc())
        .limit(min(limit, 500))
        .all()
    )
