"""
Router Nhật ký hoạt động (Audit log) — tra cứu ai làm gì, lúc nào.
NHẠY CẢM: chỉ Giám đốc / Quản trị.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.audit import ACTION_LABELS, ENTITY_LABELS
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
    rows = (
        db.query(ActivityLog)
        .filter(ActivityLog.company_id == current.company_id)
        .order_by(ActivityLog.created_at.desc(), ActivityLog.id.desc())
        .limit(min(limit, 500))
        .all()
    )
    # Dịch mã hành động / loại đối tượng sang tiếng Việt. Dịch lúc ĐỌC chứ không
    # lưu nhãn vào CSDL -> cả các dòng ghi từ trước cũng hiện tiếng Việt, và mã
    # gốc vẫn còn để lọc. Mã chưa có nhãn thì hiện nguyên mã.
    out = []
    for r in rows:
        o = ActivityLogOut.model_validate(r)
        o.action_label = ACTION_LABELS.get(r.action, r.action)
        o.entity_label = ENTITY_LABELS.get(r.entity_type, r.entity_type) if r.entity_type else None
        out.append(o)
    return out
