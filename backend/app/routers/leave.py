"""
Router Nghỉ phép (Leave) — nhân viên xin nghỉ, quản lý trực tiếp / Giám đốc duyệt.
"""
import calendar
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.audit import log_activity
from app.database import get_db, vn_now
from app.deps import get_current_user, require_roles
from app.models import LeaveRequest, LeaveStatus, User, UserRole
from app.schemas import LeaveCreate, LeaveDecision, LeaveOut

router = APIRouter(prefix="/leave", tags=["Nghỉ phép"])

_MANAGER_ROLES = (UserRole.MANAGER, UserRole.ACCOUNTANT, UserRole.DIRECTOR)


@router.post("", response_model=LeaveOut, status_code=201)
def create_leave(payload: LeaveCreate, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    if payload.to_date < payload.from_date:
        raise HTTPException(400, "Ngày kết thúc phải sau ngày bắt đầu.")
    rec = LeaveRequest(company_id=current.company_id, user_id=current.id, **payload.model_dump())
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return rec


@router.get("/me", response_model=list[LeaveOut])
def my_leaves(db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    return (
        db.query(LeaveRequest)
        .filter(LeaveRequest.user_id == current.id)
        .order_by(LeaveRequest.from_date.desc())
        .all()
    )


@router.get("", response_model=list[LeaveOut])
def list_leaves(
    status: LeaveStatus | None = None,
    db: Session = Depends(get_db),
    current: User = Depends(require_roles(*_MANAGER_ROLES)),
):
    """Quản lý/Giám đốc xem đơn nghỉ (mặc định toàn công ty)."""
    q = db.query(LeaveRequest).filter(LeaveRequest.company_id == current.company_id)
    if status:
        q = q.filter(LeaveRequest.status == status)
    return q.order_by(LeaveRequest.status, LeaveRequest.from_date.desc()).all()


@router.get("/schedule", response_model=list[LeaveOut])
def get_schedule_leaves(
    from_date: date | None = None,
    to_date: date | None = None,
    month: str | None = None,  # Định dạng YYYY-MM
    status: LeaveStatus | None = None,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Lấy danh sách nghỉ phép / đi muộn toàn công ty cho bảng Lịch làm việc."""
    q = db.query(LeaveRequest).filter(LeaveRequest.company_id == current.company_id)
    if status:
        q = q.filter(LeaveRequest.status == status)
    else:
        # Chỉ hiển thị các đơn ĐÃ ĐƯỢC DUYỆT (APPROVED) lên bảng lịch làm việc
        q = q.filter(LeaveRequest.status == LeaveStatus.APPROVED)

    if month:
        try:
            parts = month.split("-")
            y, m = int(parts[0]), int(parts[1])
            _, last_day = calendar.monthrange(y, m)
            m_start = date(y, m, 1)
            m_end = date(y, m, last_day)
            q = q.filter(LeaveRequest.from_date <= m_end, LeaveRequest.to_date >= m_start)
        except Exception:
            pass
    elif from_date and to_date:
        q = q.filter(LeaveRequest.from_date <= to_date, LeaveRequest.to_date >= from_date)

    return q.order_by(LeaveRequest.from_date.asc()).all()


@router.post("/{leave_id}/decide", response_model=LeaveOut)
def decide_leave(
    leave_id: int,
    payload: LeaveDecision,
    db: Session = Depends(get_db),
    current: User = Depends(require_roles(*_MANAGER_ROLES)),
):
    rec = db.get(LeaveRequest, leave_id)
    if not rec or rec.company_id != current.company_id:
        raise HTTPException(404, "Không tìm thấy đơn nghỉ.")
    if payload.status not in (LeaveStatus.APPROVED, LeaveStatus.REJECTED):
        raise HTTPException(400, "Trạng thái duyệt không hợp lệ.")
    rec.status = payload.status
    rec.decided_by_id = current.id
    rec.decided_at = vn_now()
    db.commit()
    db.refresh(rec)
    log_activity(db, current, f"leave.{payload.status.value.lower()}", "leave_request", rec.id,
                 f"{rec.user_name}: {rec.from_date}→{rec.to_date}")
    return rec
