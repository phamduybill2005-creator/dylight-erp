"""Tenant-scoped derived attendance and audited ADMIN-only confirmations."""
import json
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.attendance_reconciliation_schemas import (
    AttendanceCoverageOut, AttendanceCoverageWrite, AttendancePermissionWrite, AttendanceDayPermissionWrite,
    AttendanceReconciliationDay, AttendanceReconciliationOut,
    AttendanceForgotPunchWrite,
)
from app.database import get_db
from app.deps import get_current_user
from app.events import publish
from app.models import ActivityLog, AttendanceDataConfirmation, AttendanceSessionOverride, AttendanceForgotPunch, User, UserRole
from app.services import attendance_reconciliation as service

router = APIRouter(prefix="/reconciliation")


def _senior(user):
    return user.role in (UserRole.ADMIN, UserRole.DIRECTOR) or (
        user.role == UserRole.MANAGER and not user.manager_id and not user.manager_ids)


def _admin(user):
    if user.role != UserRole.ADMIN:
        raise HTTPException(403, "Chỉ Quản trị hệ thống được xác nhận dữ liệu hoặc xác nhận có phép.")


@router.get("", response_model=AttendanceReconciliationOut)
def get_reconciliation(from_date: date, to_date: date, user_id: int | None = None,
                       db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    if to_date < from_date or (to_date - from_date).days >= 31:
        raise HTTPException(400, "Chọn khoảng ngày hợp lệ, tối đa 31 ngày.")
    if not _senior(current):
        user_id = current.id
    return service.reconcile(db, current.company_id, from_date, to_date, user_id=user_id)


def _set_permissions(payload, sessions, db, current):
    _admin(current)
    now = service.vn_now()
    if payload.work_date > now.date():
        raise HTTPException(400, "Chỉ xác nhận ngày hôm nay hoặc ngày đã qua.")
    employee = db.query(User).filter(User.id == payload.user_id, User.company_id == current.company_id,
                                    User.is_active.is_(True), User.is_approved.is_(True)).first()
    if employee is None:
        raise HTTPException(404, "Không tìm thấy nhân viên trong công ty.")
    records = db.query(AttendanceSessionOverride).filter(
        AttendanceSessionOverride.company_id == current.company_id,
        AttendanceSessionOverride.user_id == employee.id,
        AttendanceSessionOverride.work_date == payload.work_date,
        AttendanceSessionOverride.session.in_(sessions)).order_by(AttendanceSessionOverride.session).with_for_update().all()
    by_session = {record.session: record for record in records}
    try:
        changes = []
        for session in sorted(sessions):
            record = by_session.get(session)
            before = {k: getattr(record, k) for k in ("decision", "reason", "approved_by")} if record else None
            if record is None:
                record = AttendanceSessionOverride(company_id=current.company_id, user_id=employee.id,
                    work_date=payload.work_date, session=session, created_at=now)
                db.add(record)
            record.decision = payload.decision
            record.reason = payload.reason
            record.approved_by = payload.approved_by
            record.recorded_by_id = current.id
            record.recorded_by_name = current.full_name
            record.updated_at = now
            changes.append((record, before))
        db.flush()
        for record, before in changes:
            after = {k: getattr(record, k) for k in ("decision", "reason", "approved_by")}
            db.add(ActivityLog(company_id=current.company_id, user_id=current.id,
                action="attendance.permission", entity_type="attendance_session_override", entity_id=record.id,
                detail=f"{employee.full_name} · {payload.work_date:%d/%m/%Y} · {record.session}: "
                       + json.dumps(before, ensure_ascii=False) + " → " + json.dumps(after, ensure_ascii=False)
                       + f" · Người ghi nhận: {current.full_name} (#{current.id})"))
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Xác nhận vừa được cập nhật ở phiên khác. Tải lại để kiểm tra.")
    except Exception:
        db.rollback()
        raise
    publish(current.company_id, "attendance")
    publish(current.company_id, "audit")
    return service.reconcile(db, current.company_id, payload.work_date, payload.work_date, employee.id, now)["rows"][0]


@router.put("/override", response_model=AttendanceReconciliationDay)
def set_permission(payload: AttendancePermissionWrite, db: Session = Depends(get_db),
                   current: User = Depends(get_current_user)):
    return _set_permissions(payload, [payload.session], db, current)


@router.put("/override-day", response_model=AttendanceReconciliationDay)
def set_day_permission(payload: AttendanceDayPermissionWrite, db: Session = Depends(get_db),
                       current: User = Depends(get_current_user)):
    return _set_permissions(payload, payload.sessions, db, current)


@router.post("/confirm-data", response_model=AttendanceCoverageOut)
def confirm_data(payload: AttendanceCoverageWrite, db: Session = Depends(get_db),
                 current: User = Depends(get_current_user)):
    _admin(current)
    now = service.vn_now()
    if now < service.coverage_end(db, current.company_id, payload.work_date, payload.session):
        raise HTTPException(400, "Buổi làm việc chưa kết thúc; chưa được xác nhận dữ liệu đã đủ.")
    record = db.query(AttendanceDataConfirmation).filter(
        AttendanceDataConfirmation.company_id == current.company_id,
        AttendanceDataConfirmation.work_date == payload.work_date,
        AttendanceDataConfirmation.session == payload.session).with_for_update().first()
    before = record.reason if record else None
    try:
        if record is None:
            record = AttendanceDataConfirmation(company_id=current.company_id,
                work_date=payload.work_date, session=payload.session)
            db.add(record)
        record.reason = payload.reason
        record.confirmed_by_id = current.id
        record.confirmed_by_name = current.full_name
        record.confirmed_at = now
        db.flush()
        db.add(ActivityLog(company_id=current.company_id, user_id=current.id,
            action="attendance.data_confirmation", entity_type="attendance_data_confirmation", entity_id=record.id,
            detail=f"{payload.work_date:%d/%m/%Y} · {payload.session}: "
                   + json.dumps(before, ensure_ascii=False) + " → " + json.dumps(payload.reason, ensure_ascii=False)
                   + f" · Người ghi nhận: {current.full_name} (#{current.id})"))
        db.commit()
        db.refresh(record)
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Dữ liệu vừa được xác nhận ở phiên khác. Tải lại để kiểm tra.")
    except Exception:
        db.rollback()
        raise
    publish(current.company_id, "attendance")
    publish(current.company_id, "audit")
    return service.confirmation_out(record)


@router.put("/forgot-punch", response_model=AttendanceReconciliationDay)
def set_forgot_punch(payload: AttendanceForgotPunchWrite, db: Session = Depends(get_db),
                     current: User = Depends(get_current_user)):
    _admin(current)
    now = service.vn_now()
    if payload.work_date > now.date():
        raise HTTPException(400, "Chỉ xác nhận ngày hôm nay hoặc ngày đã qua.")
    if payload.reported_at and payload.reported_at > now:
        raise HTTPException(400, "Thời điểm báo không được ở tương lai.")
    employee = db.query(User).filter(User.id == payload.user_id, User.company_id == current.company_id,
                                    User.is_active.is_(True), User.is_approved.is_(True)).first()
    if employee is None:
        raise HTTPException(404, "Không tìm thấy nhân viên trong công ty.")
    record = db.query(AttendanceForgotPunch).filter(
        AttendanceForgotPunch.company_id == current.company_id,
        AttendanceForgotPunch.user_id == employee.id,
        AttendanceForgotPunch.work_date == payload.work_date,
        AttendanceForgotPunch.punch == payload.punch).with_for_update().first()
    fields = ("decision", "reported_at", "reason", "approved_by", "recorded_by_id", "recorded_by_name")
    before = {key: getattr(record, key) for key in fields} if record else None
    try:
        if record is None:
            record = AttendanceForgotPunch(company_id=current.company_id, user_id=employee.id,
                work_date=payload.work_date, punch=payload.punch, created_at=now)
            db.add(record)
        for key in ("decision", "reported_at", "reason", "approved_by"):
            setattr(record, key, getattr(payload, key))
        record.recorded_by_id = current.id
        record.recorded_by_name = current.full_name
        record.updated_at = now
        db.flush()
        after = {key: getattr(record, key) for key in fields}
        db.add(ActivityLog(company_id=current.company_id, user_id=current.id,
            action="attendance.forgot_punch", entity_type="attendance_forgot_punch", entity_id=record.id,
            detail=f"{employee.full_name} · {payload.work_date:%d/%m/%Y} · {payload.punch}: "
                   + json.dumps(before, ensure_ascii=False, default=lambda value: value.isoformat()) + " → "
                   + json.dumps(after, ensure_ascii=False, default=lambda value: value.isoformat())
                   + f" · Người ghi nhận: {current.full_name} (#{current.id})"))
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Xác nhận vừa được cập nhật ở phiên khác. Tải lại để kiểm tra.")
    except Exception:
        db.rollback()
        raise
    publish(current.company_id, "attendance")
    publish(current.company_id, "audit")
    return service.reconcile(db, current.company_id, payload.work_date, payload.work_date, employee.id, now)["rows"][0]
