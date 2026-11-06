"""Read-time evaluation counts from the same per-session attendance decisions."""
from collections import defaultdict
from datetime import date

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.models import Attendance, AttendanceSessionOverride, EvaluationMonthReview, LeaveRequest, LeaveStatus, User
from app.services import attendance_reconciliation as reconciliation

COUNT_FIELDS = ("late_cp", "late_kp", "leave_cp", "leave_kp")
PENDING_STATUSES = {"NEEDS_REVIEW", "WAITING_DATA", "PENDING_APPROVAL"}


def attendance_user_ids(db: Session, company_id: int, first: date, last: date):
    """Current roster plus company users with evidence in the selected period."""
    evidenced = {uid for (uid,) in db.query(Attendance.user_id).filter(
        Attendance.company_id == company_id, Attendance.work_date >= first, Attendance.work_date <= last)}
    evidenced.update(uid for (uid,) in db.query(LeaveRequest.user_id).filter(
        LeaveRequest.company_id == company_id,
        LeaveRequest.status.in_([LeaveStatus.APPROVED, LeaveStatus.PENDING]),
        LeaveRequest.from_date <= last, LeaveRequest.to_date >= first))
    evidenced.update(uid for (uid,) in db.query(AttendanceSessionOverride.user_id).filter(
        AttendanceSessionOverride.company_id == company_id,
        AttendanceSessionOverride.work_date >= first, AttendanceSessionOverride.work_date <= last))
    evidenced.update(uid for (uid,) in db.query(EvaluationMonthReview.user_id).filter(
        EvaluationMonthReview.company_id == company_id,
        EvaluationMonthReview.month >= first.strftime("%Y-%m"),
        EvaluationMonthReview.month <= last.strftime("%Y-%m")))
    return [uid for (uid,) in db.query(User.id).filter(User.company_id == company_id,
        or_((User.is_active.is_(True) & User.is_approved.is_(True)), User.id.in_(evidenced)))]


def attendance_totals(db: Session, company_id: int, first: date, last: date, *, user_ids=None, now=None):
    """Return {(user_id, YYYY-MM): counts}; never write reviews or actual punches.

    Evaluate all selected dates in one batch, including evidence-only retired staff.
    Future calendar dates never contribute; incomplete evidence is counted separately.
    """
    now = now or reconciliation.vn_now()
    last = min(last, now.date())
    if last < first:
        return {}
    if user_ids is None:
        user_ids = attendance_user_ids(db, company_id, first, last)
    # Employment begins at the first actual punch in the user's entire history.
    # Empty/note-only rows and future clock values must not start assessment.
    starts = dict(db.query(Attendance.user_id, func.min(Attendance.work_date)).filter(
        Attendance.company_id == company_id, Attendance.user_id.in_(user_ids),
        Attendance.work_date <= now.date(),
        or_(Attendance.check_in <= now, Attendance.check_out <= now),
    ).group_by(Attendance.user_id).all())
    result = reconciliation.reconcile(db, company_id, first, last, now=now, user_ids=user_ids)
    totals = defaultdict(lambda: dict.fromkeys((*COUNT_FIELDS, "attendance_pending_sessions"), 0))
    for row in result["rows"]:
        counts = totals[(row["user_id"], row["work_date"].strftime("%Y-%m"))]
        start = starts.get(row["user_id"])
        if start is None or row["work_date"] < start:
            continue
        statuses = [row[session]["status"] for session in ("morning", "afternoon")]
        # A late day contributes once, even if an upstream rule later adds another session.
        counts["late_cp"] += int("EXCUSED_LATE" in statuses)
        counts["late_kp"] += int("UNEXCUSED_LATE" in statuses)
        counts["leave_cp"] += 0.5 * statuses.count("EXCUSED_ABSENCE")
        counts["leave_kp"] += 0.5 * statuses.count("UNEXCUSED_ABSENCE")
        counts["attendance_pending_sessions"] += sum(status in PENDING_STATUSES for status in statuses)
    return dict(totals)
