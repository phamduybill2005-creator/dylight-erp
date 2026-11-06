"""Read-only reconciliation; permission and data completeness never alter punches."""
from collections import defaultdict
from datetime import date, datetime, time, timedelta

from sqlalchemy.orm import Session

from app.config import settings
from app.database import vn_now
from app.models import (
    Attendance, AttendanceSource, AttendanceDataConfirmation, AttendanceSessionOverride,
    LeaveRequest, LeaveStatus, User,
)

ATTENTION_STATUSES = {
    "UNEXCUSED_ABSENCE", "UNEXCUSED_LATE", "PENDING_APPROVAL", "NEEDS_REVIEW", "WAITING_DATA",
}


def _minutes(value, default=None):
    if not value:
        return default
    try:
        h, m = str(value).split(":")
        h, m = int(h), int(m)
        return h * 60 + m if 0 <= h < 24 and 0 <= m < 60 else default
    except (ValueError, TypeError):
        return default


def _clock(value):
    return value.hour * 60 + value.minute


def shift_end(work_date: date, session: str, user=None) -> datetime:
    minute = settings.MORNING_END_MIN if session == "AM" else settings.AFTERNOON_END_MIN
    personal_end = _minutes(getattr(user, "work_end", None)) if user else None
    if personal_end is not None and ((session == "AM" and personal_end <= settings.AFTERNOON_START_MIN)
                                     or (session == "PM" and personal_end > settings.AFTERNOON_START_MIN)):
        minute = personal_end
    return datetime.combine(work_date, time.min) + timedelta(minutes=minute)


def coverage_end(db: Session, company_id: int, work_date: date, session: str) -> datetime:
    """A company-wide completeness assertion must wait for personal shifts too."""
    end = shift_end(work_date, session)
    for (work_end,) in db.query(User.work_end).filter(User.company_id == company_id,
            User.is_active.is_(True), User.is_approved.is_(True)):
        minute = _minutes(work_end)
        if minute is not None and ((session == "AM" and minute <= settings.AFTERNOON_START_MIN)
                                   or (session == "PM" and minute > settings.AFTERNOON_START_MIN)):
            end = max(end, datetime.combine(work_date, time.min) + timedelta(minutes=minute))
    return end


def _covers(kind: str, session: str, late=False) -> bool:
    kind = (kind or "FULL").upper()
    if late:
        return kind in (("LATE", "LATE_MORNING") if session == "AM" else ("LATE_AFTERNOON",))
    return kind in (("FULL", "MORNING") if session == "AM" else ("FULL", "AFTERNOON"))


def _leave_sort(leave):
    return leave.decided_at or leave.created_at or datetime.min, leave.id or 0


def permission_out(record):
    if not record or not record.decision:
        return None
    return {
        "decision": record.decision, "reason": record.reason,
        "approved_by": record.approved_by,
        "recorded_by": record.recorded_by_name or (record.recorded_by.full_name if record.recorded_by else "—"),
        "updated_at": record.updated_at,
    }


def confirmation_out(record):
    return {
        "work_date": record.work_date, "session": record.session,
        "confirmed_by": record.confirmed_by_name or (record.confirmed_by.full_name if record.confirmed_by else "—"),
        "confirmed_at": record.confirmed_at, "reason": record.reason,
    }


def assess_day(user, work_date, attendance, leaves, overrides, confirmations, now):
    """Derive a day from matching user/day inputs; no mutation or database writes."""
    relevant = sorted((l for l in leaves if l.user_id == user.id
                       and l.company_id == user.company_id and l.from_date <= work_date <= l.to_date),
                      key=_leave_sort, reverse=True)
    approved = [l for l in relevant if l.status == LeaveStatus.APPROVED]
    schedules = [l for l in approved if l.source == "SCHEDULE"]
    schedule = schedules[0] if schedules else None
    applications = [l for l in approved if l.source != "SCHEDULE"]
    pending = [l for l in relevant if l.status == LeaveStatus.PENDING and l.source != "SCHEDULE"]
    decisions = {o.session: o for o in overrides if o.user_id == user.id
                 and o.company_id == user.company_id and o.work_date == work_date}
    complete = {c.session for c in confirmations if c.company_id == user.company_id
                and c.work_date == work_date}
    holidays = {s.strip() for s in settings.ATTENDANCE_HOLIDAYS.split(",") if s.strip()}
    regular_day = work_date.weekday() != 6 and work_date.isoformat() not in holidays
    before_account = bool(user.created_at and work_date < user.created_at.date())
    ci = attendance.check_in if attendance else None
    co = attendance.check_out if attendance else None
    invalid = bool((ci and ci.date() != work_date) or (co and co.date() != work_date)
                   or (ci and co and co < ci) or (co and not ci)
                   or (ci and ci > now) or (co and co > now))
    morning_boundary = _clock(shift_end(work_date, "AM", user))
    morning_present = bool(ci and _clock(ci) <= morning_boundary)
    afternoon_only = bool(ci and _clock(ci) > morning_boundary)
    afternoon_present = afternoon_only or bool(morning_present and co and _clock(co) >= settings.AFTERNOON_START_MIN)
    personal_start = _minutes(user.work_start)
    personal_end = _minutes(user.work_end)
    unpaired_machine = bool(attendance and attendance.source == AttendanceSource.MACHINE and ci and not co
                            and not attendance.check_in_corrected)

    def session_result(session):
        override = permission_out(decisions.get(session))
        result = {
            "session": session, "status": "PRESENT", "late_minutes": 0,
            "explanation": "", "leave_id": None, "permission_source": None,
            "override": override, "data_confirmed": session in complete,
        }

        def finish(status, explanation, leave=None, source=None):
            result.update(status=status, explanation=explanation,
                          leave_id=leave.id if leave else None, permission_source=source)
            return result

        scheduled = regular_day
        if session == "AM" and personal_start is not None and personal_start > morning_boundary:
            scheduled = False
        if session == "PM" and personal_end is not None and personal_end <= settings.AFTERNOON_START_MIN:
            scheduled = False
        if schedule and _covers(schedule.leave_type, session):
            scheduled = False
        if not scheduled:
            return finish("NOT_SCHEDULED", "Buổi không có lịch làm việc.")
        if work_date > now.date():
            return finish("NOT_FINISHED", "Chưa đến ngày làm việc.")
        if invalid:
            return finish("NEEDS_REVIEW", "Mốc vào/ra bị thiếu hoặc không hợp lệ; cần đối chiếu máy.")

        present = morning_present if session == "AM" else afternoon_present
        absence_leave = next((l for l in applications if _covers(l.leave_type, session)), None)
        if unpaired_machine and now >= shift_end(work_date, session, user):
            if absence_leave and not present:
                return finish("EXCUSED_ABSENCE", "Đơn nghỉ đúng buổi đã được duyệt.", absence_leave, "LEAVE")
            if override and override["decision"] == "EXCUSED_ABSENCE" and not present:
                return finish("EXCUSED_ABSENCE", f"Admin xác nhận: {override['reason']}", source="ADMIN")
            return finish("NEEDS_REVIEW", "Chỉ có một lượt quẹt máy, chưa xác định được là giờ vào hay giờ ra.")
        if present:
            if absence_leave or (override and override["decision"] == "EXCUSED_ABSENCE"):
                return finish("NEEDS_REVIEW", "Có chấm công trong buổi đã được phép nghỉ; cần kiểm tra lại.", absence_leave)
            if session == "AM":
                start = personal_start if personal_start is not None else settings.WORK_START_HOUR * 60
                late = max(0, _clock(ci) - start)
            elif afternoon_only:
                start = personal_start if personal_start is not None and personal_start > settings.MORNING_END_MIN else settings.AFTERNOON_START_MIN
                late = max(0, _clock(ci) - start)
            else:
                late = 0  # A full-day employee is never assessed for afternoon lateness.
            result["late_minutes"] = late
            if late == 0:
                return finish("PRESENT", "Có chấm công; không đi muộn buổi này.")
            if override and override["decision"] == "EXCUSED_LATE":
                return finish("EXCUSED_LATE", f"Admin xác nhận: {override['reason']}", source="ADMIN")
            late_leaves = [l for l in applications if _covers(l.leave_type, session, late=True)]
            for late_leave in late_leaves:
                allowed = _minutes(late_leave.allowed_arrival_time)
                if allowed is None or _clock(ci) <= allowed:
                    return finish("EXCUSED_LATE", "Đơn đi muộn đúng buổi đã được duyệt.", late_leave, "LEAVE")
            if late_leaves:
                return finish("UNEXCUSED_LATE", "Giờ vào muộn hơn giờ đến đã được duyệt.", late_leaves[0])
            pending_late = next((l for l in pending if _covers(l.leave_type, session, late=True)), None)
            if pending_late:
                return finish("PENDING_APPROVAL", "Đơn đi muộn đang chờ duyệt.", pending_late)
            if attendance.is_late_override is False and session not in decisions:
                return finish("EXCUSED_LATE", "Đã có xác nhận miễn trễ được lưu trước đây.", source="ADMIN")
            return finish("UNEXCUSED_LATE", "Có chấm công muộn, chưa có phép hợp lệ cho buổi này.")

        if absence_leave:
            return finish("EXCUSED_ABSENCE", "Đơn nghỉ đúng buổi đã được duyệt.", absence_leave, "LEAVE")
        if override and override["decision"] == "EXCUSED_ABSENCE":
            return finish("EXCUSED_ABSENCE", f"Admin xác nhận: {override['reason']}", source="ADMIN")
        pending_leave = next((l for l in pending if _covers(l.leave_type, session)
                              or _covers(l.leave_type, session, late=True)), None)
        if pending_leave:
            return finish("PENDING_APPROVAL", "Có đơn đang chờ duyệt; chưa chốt nghỉ không phép.", pending_leave)
        if now < shift_end(work_date, session, user):
            return finish("NOT_FINISHED", "Buổi làm việc chưa kết thúc; chưa chốt vắng mặt.")
        if session == "PM" and morning_present and not co:
            return finish("NEEDS_REVIEW", "Có giờ vào sáng nhưng thiếu giờ ra; chưa đủ căn cứ xác định nghỉ chiều.")
        if before_account:
            return finish("NEEDS_REVIEW", "Chưa có căn cứ lịch làm cho ngày trước khi tạo tài khoản; cần xác minh.")
        if not user.is_active or not user.is_approved:
            return finish("NEEDS_REVIEW", "Cần kiểm tra lịch làm lịch sử của nhân sự không còn hoạt động.")
        if session not in complete:
            return finish("WAITING_DATA", "Chưa xác nhận dữ liệu máy đã đủ cho buổi này.")
        return finish("UNEXCUSED_ABSENCE", "Buổi đã kết thúc, dữ liệu đã được xác nhận đủ và chưa có phép hợp lệ.")

    morning, afternoon = session_result("AM"), session_result("PM")
    return {
        "user_id": user.id, "full_name": user.full_name, "department": user.department,
        "work_date": work_date, "attendance_id": attendance.id if attendance else None,
        "check_in": ci, "check_out": co, "morning": morning, "afternoon": afternoon,
        "needs_attention": any(s["status"] in ATTENTION_STATUSES for s in (morning, afternoon)),
        "can_edit_permission": bool(user.is_active and user.is_approved),
    }


def reconcile(db: Session, company_id: int, from_date: date, to_date: date, user_id=None, now=None):
    now = now or vn_now()
    users_query = db.query(User).filter(User.company_id == company_id)
    if user_id is not None:
        users_query = users_query.filter(User.id == user_id)
    else:
        users_query = users_query.filter(User.is_active.is_(True), User.is_approved.is_(True))
    users = users_query.order_by(User.full_name, User.id).all()
    ids = [u.id for u in users]
    records = db.query(Attendance).filter(Attendance.company_id == company_id, Attendance.user_id.in_(ids),
        Attendance.work_date >= from_date, Attendance.work_date <= to_date).all() if ids else []
    leaves = db.query(LeaveRequest).filter(LeaveRequest.company_id == company_id, LeaveRequest.user_id.in_(ids),
        LeaveRequest.from_date <= to_date, LeaveRequest.to_date >= from_date,
        LeaveRequest.status.in_([LeaveStatus.APPROVED, LeaveStatus.PENDING])).all() if ids else []
    overrides = db.query(AttendanceSessionOverride).filter(AttendanceSessionOverride.company_id == company_id,
        AttendanceSessionOverride.user_id.in_(ids), AttendanceSessionOverride.work_date >= from_date,
        AttendanceSessionOverride.work_date <= to_date).all() if ids else []
    confirmations = db.query(AttendanceDataConfirmation).filter(AttendanceDataConfirmation.company_id == company_id,
        AttendanceDataConfirmation.work_date >= from_date, AttendanceDataConfirmation.work_date <= to_date).all()
    by_record = {(r.user_id, r.work_date): r for r in records}
    by_leave, by_override, by_confirmation = defaultdict(list), defaultdict(list), defaultdict(list)
    for leave in leaves:
        by_leave[leave.user_id].append(leave)
    for override in overrides:
        by_override[override.user_id].append(override)
    for confirmation in confirmations:
        by_confirmation[confirmation.work_date].append(confirmation)
    rows, day = [], from_date
    while day <= to_date:
        for user in users:
            rows.append(assess_day(user, day, by_record.get((user.id, day)), by_leave[user.id],
                                   by_override[user.id], by_confirmation[day], now))
        day += timedelta(days=1)
    return {
        "rows": rows,
        "confirmations": [confirmation_out(c) for c in confirmations],
        "confirmation_available": {s: now >= coverage_end(db, company_id, to_date, s) for s in ("AM", "PM")},
    }
