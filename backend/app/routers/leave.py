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
from app.schemas import LeaveCreate, LeaveDecision, LeaveOut, StudentWeekSchedulePayload

router = APIRouter(prefix="/leave", tags=["Nghỉ phép"])

_MANAGER_ROLES = (UserRole.MANAGER, UserRole.ACCOUNTANT, UserRole.DIRECTOR)


@router.post("", response_model=LeaveOut, status_code=201)
def create_leave(payload: LeaveCreate, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    if payload.to_date < payload.from_date:
        raise HTTPException(400, "Ngày kết thúc phải sau ngày bắt đầu.")
    rec = LeaveRequest(company_id=current.company_id, user_id=current.id, source="LEAVE", **payload.model_dump())
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return rec


@router.get("/me", response_model=list[LeaveOut])
def my_leaves(db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    """Chỉ lấy các đơn xin nghỉ phép được tạo trong mục Nghỉ phép (loại bỏ đơn đăng ký lịch làm việc)."""
    from sqlalchemy import or_
    return (
        db.query(LeaveRequest)
        .filter(
            LeaveRequest.user_id == current.id,
            LeaveRequest.from_date >= date(2026, 9, 1),
            or_(LeaveRequest.source == "LEAVE", LeaveRequest.source.is_(None)),
            LeaveRequest.source != "SCHEDULE",
        )
        .order_by(LeaveRequest.from_date.desc())
        .all()
    )


@router.get("", response_model=list[LeaveOut])
def list_leaves(
    status: LeaveStatus | None = None,
    db: Session = Depends(get_db),
    current: User = Depends(require_roles(*_MANAGER_ROLES)),
):
    """Quản lý/Giám đốc xem đơn nghỉ (mặc định toàn công ty). Chỉ lấy đơn tạo trong mục Nghỉ phép từ T9/2026 trở đi."""
    from sqlalchemy import or_
    q = db.query(LeaveRequest).filter(
        LeaveRequest.company_id == current.company_id,
        LeaveRequest.from_date >= date(2026, 9, 1),
        or_(LeaveRequest.source == "LEAVE", LeaveRequest.source.is_(None)),
        LeaveRequest.source != "SCHEDULE",
    )
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
    """Lấy danh sách nghỉ phép / đi muộn toàn công ty cho bảng Lịch làm việc.
    Chỉ lấy các đơn từ tháng 9/2026 trở đi (loại bỏ hoàn toàn dữ liệu test cũ).
    """
    MIN_DATE = date(2026, 9, 1)
    q = db.query(LeaveRequest).filter(
        LeaveRequest.company_id == current.company_id,
        LeaveRequest.from_date >= MIN_DATE,
    )
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


@router.delete("/{leave_id}")
def delete_leave(
    leave_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Xóa đơn xin nghỉ phép (Dành cho Quản lý/Giám đốc hoặc chính người làm đơn)."""
    rec = db.get(LeaveRequest, leave_id)
    if not rec or rec.company_id != current.company_id:
        raise HTTPException(404, "Không tìm thấy đơn nghỉ.")
    is_admin = current.role in _MANAGER_ROLES or current.role == UserRole.ADMIN
    if not is_admin and rec.user_id != current.id:
        raise HTTPException(403, "Không có quyền xóa đơn nghỉ này.")
    info = f"{rec.user_name}: {rec.from_date}→{rec.to_date} ({rec.reason})"
    db.delete(rec)
    db.commit()
    log_activity(db, current, "leave.delete", "leave_request", leave_id, info)
    return {"message": "Đã xóa đơn nghỉ thành công."}


@router.post("/student-week-schedule", response_model=list[LeaveOut])
def save_student_week_schedule(
    payload: StudentWeekSchedulePayload,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Đăng ký lịch làm việc theo tuần cho sinh viên (hoặc nhân viên).
    - Sinh viên có thể tự đăng ký lịch cho mình.
    - Quản lý/Giám đốc/Admin có thể đăng ký/chỉnh sửa cho bất kỳ ai trong công ty.
    - Ca làm:
      + ALL_DAY: Đi làm cả ngày (xóa đơn nghỉ nếu có)
      + MORNING_ONLY: Làm sáng - Nghỉ chiều -> leave_type="AFTERNOON"
      + AFTERNOON_ONLY: Làm chiều - Nghỉ sáng -> leave_type="MORNING"
      + OFF: Nghỉ cả ngày -> leave_type="FULL"
    - Tự động duyệt (APPROVED) để hiện ngay lập tức lên bảng Lịch làm việc tổng.
    """
    target_user_id = current.id
    is_admin = current.role in _MANAGER_ROLES or current.role == UserRole.ADMIN
    if payload.user_id is not None and payload.user_id != current.id:
        if not is_admin:
            raise HTTPException(403, "Chỉ Quản lý hoặc Giám đốc mới có thể đăng ký lịch cho người khác.")
        target_user = db.get(User, payload.user_id)
        if not target_user or target_user.company_id != current.company_id:
            raise HTTPException(404, "Không tìm thấy nhân sự.")
        target_user_id = target_user.id

    if not payload.days:
        return []

    dates = [d.date for d in payload.days]
    min_d = min(dates)
    max_d = max(dates)

    # Tìm các đơn nghỉ hiện có của user trong khoảng ngày này (tính theo đơn ngày)
    existing_leaves = (
        db.query(LeaveRequest)
        .filter(
            LeaveRequest.company_id == current.company_id,
            LeaveRequest.user_id == target_user_id,
            LeaveRequest.from_date <= max_d,
            LeaveRequest.to_date >= min_d,
        )
        .all()
    )
    existing_map = {l.from_date: l for l in existing_leaves if l.from_date == l.to_date}

    results: list[LeaveRequest] = []

    for item in payload.days:
        curr_leave = existing_map.get(item.date)
        if item.shift == "ALL_DAY":
            # Đi làm cả ngày -> xóa đơn nghỉ nếu có
            if curr_leave:
                db.delete(curr_leave)
        elif item.shift in ("MORNING_ONLY", "AFTERNOON_ONLY", "OFF"):
            # MORNING_ONLY = Làm sáng, nghỉ chiều -> leave_type="AFTERNOON"
            # AFTERNOON_ONLY = Làm chiều, nghỉ sáng -> leave_type="MORNING"
            # OFF = Nghỉ cả ngày -> leave_type="FULL"
            l_type = (
                "AFTERNOON"
                if item.shift == "MORNING_ONLY"
                else ("MORNING" if item.shift == "AFTERNOON_ONLY" else "FULL")
            )
            default_reason = (
                "Đi học (Nghỉ chiều)"
                if l_type == "AFTERNOON"
                else ("Đi học (Nghỉ sáng)" if l_type == "MORNING" else "Đi học (Nghỉ cả ngày)")
            )
            reason = item.reason.strip() if item.reason and item.reason.strip() else default_reason

            if curr_leave:
                curr_leave.leave_type = l_type
                curr_leave.reason = reason
                curr_leave.status = LeaveStatus.APPROVED
                curr_leave.source = "SCHEDULE"
                curr_leave.decided_by_id = current.id
                curr_leave.decided_at = vn_now()
                results.append(curr_leave)
            else:
                new_leave = LeaveRequest(
                    company_id=current.company_id,
                    user_id=target_user_id,
                    from_date=item.date,
                    to_date=item.date,
                    leave_type=l_type,
                    reason=reason,
                    status=LeaveStatus.APPROVED,
                    source="SCHEDULE",
                    decided_by_id=current.id,
                    decided_at=vn_now(),
                )
                db.add(new_leave)
                results.append(new_leave)

    db.commit()
    for r in results:
        db.refresh(r)

    log_activity(
        db,
        current,
        "leave.student_schedule",
        "user",
        target_user_id,
        f"Đăng ký lịch sinh viên tuần ({min_d} - {max_d}): {len(results)} ngày nghỉ/nửa ngày",
    )
    return results
