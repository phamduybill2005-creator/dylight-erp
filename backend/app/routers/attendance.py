"""
Router Chấm công (Attendance).

- Nhân viên tự bấm vào/ra trong app (check-in / check-out) — 1 bản ghi / người / ngày.
- Quản lý / Giám đốc xem bảng chấm công toàn đội + tổng hợp giờ làm để đánh giá hiệu quả.
- Máy chấm công gọi /attendance/punch (xác thực bằng X-API-Key, KHÔNG dùng JWT).
"""
from datetime import date, datetime

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import get_current_user, require_roles
from app.models import Attendance, AttendanceSource, PaymentDirection, User, UserRole
from app.schemas import (
    AttendanceOut, AttendanceSummary, MachinePunch,
    AttendanceImportRequest, AttendanceImportResult,
)

router = APIRouter(prefix="/attendance", tags=["Chấm công"])

# Vai trò được xem chấm công toàn công ty (ADMIN tự được phép trong require_roles).
_MANAGER_ROLES = (UserRole.MANAGER, UserRole.ACCOUNTANT, UserRole.DIRECTOR)


def _resolve_user(db: Session, company_id: int, ref: str) -> User | None:
    """Tìm nhân viên TRONG CÔNG TY theo user_id (số) / email / số CCCD."""
    ref = (ref or "").strip()
    if not ref:
        return None
    user = None
    if ref.isdigit():
        u = db.get(User, int(ref))
        if u and u.company_id == company_id:
            user = u
    if user is None:
        user = (
            db.query(User)
            .filter(
                User.company_id == company_id,
                (User.email == ref.lower()) | (User.identity_card == ref),
            )
            .first()
        )
    return user


def _today_record(db: Session, user: User) -> Attendance | None:
    return (
        db.query(Attendance)
        .filter(Attendance.user_id == user.id, Attendance.work_date == date.today())
        .first()
    )


@router.post("/check-in", response_model=AttendanceOut)
def check_in(db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    """Bấm giờ vào cho hôm nay. Giữ mốc vào đầu tiên nếu đã bấm."""
    rec = _today_record(db, current)
    if rec is None:
        rec = Attendance(
            company_id=current.company_id, user_id=current.id, work_date=date.today(),
            check_in=datetime.now(), source=AttendanceSource.MANUAL,
        )
        db.add(rec)
    elif rec.check_in is None:
        rec.check_in = datetime.now()
    db.commit()
    db.refresh(rec)
    return rec


@router.post("/check-out", response_model=AttendanceOut)
def check_out(db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    """Bấm giờ ra cho hôm nay (cập nhật mốc ra mới nhất)."""
    rec = _today_record(db, current)
    if rec is None:
        rec = Attendance(
            company_id=current.company_id, user_id=current.id, work_date=date.today(),
            check_out=datetime.now(), source=AttendanceSource.MANUAL,
        )
        db.add(rec)
    else:
        rec.check_out = datetime.now()
    db.commit()
    db.refresh(rec)
    return rec


@router.get("/me", response_model=list[AttendanceOut])
def my_attendance(
    from_date: date | None = None,
    to_date: date | None = None,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Lịch sử chấm công của chính người đăng nhập."""
    q = db.query(Attendance).filter(Attendance.user_id == current.id)
    if from_date:
        q = q.filter(Attendance.work_date >= from_date)
    if to_date:
        q = q.filter(Attendance.work_date <= to_date)
    return q.order_by(Attendance.work_date.desc()).all()


@router.get("", response_model=list[AttendanceOut])
def list_attendance(
    user_id: int | None = None,
    work_date: date | None = None,
    db: Session = Depends(get_db),
    current: User = Depends(require_roles(*_MANAGER_ROLES)),
):
    """Danh sách chấm công toàn công ty (cho Quản lý / Giám đốc)."""
    q = db.query(Attendance).filter(Attendance.company_id == current.company_id)
    if user_id:
        q = q.filter(Attendance.user_id == user_id)
    if work_date:
        q = q.filter(Attendance.work_date == work_date)
    return q.order_by(Attendance.work_date.desc(), Attendance.user_id.asc()).all()


@router.get("/summary", response_model=list[AttendanceSummary])
def attendance_summary(
    period: str | None = None,
    db: Session = Depends(get_db),
    current: User = Depends(require_roles(*_MANAGER_ROLES)),
):
    """
    Tổng hợp số ngày công, số ngày đi trễ, tổng giờ làm theo từng người trong kỳ.
    period = 'YYYY-MM' (mặc định tháng hiện tại).
    """
    period = period or date.today().strftime("%Y-%m")
    records = (
        db.query(Attendance)
        .filter(Attendance.company_id == current.company_id)
        .filter(Attendance.work_date >= date.fromisoformat(period + "-01"))
        .all()
    )
    # Lọc đúng tháng (so khớp tiền tố "YYYY-MM") rồi gom theo người.
    by_user: dict[int, AttendanceSummary] = {}
    users = {u.id: u for u in db.query(User).filter(User.company_id == current.company_id).all()}
    for rec in records:
        if not rec.work_date.strftime("%Y-%m") == period:
            continue
        u = users.get(rec.user_id)
        if not u:
            continue
        s = by_user.setdefault(
            rec.user_id, AttendanceSummary(user_id=rec.user_id, full_name=u.full_name)
        )
        if rec.check_in:
            s.present_days += 1
        if rec.is_late:
            s.late_days += 1
        s.total_hours += round(rec.worked_minutes / 60, 2)
    for s in by_user.values():
        s.total_hours = round(s.total_hours, 2)
    return sorted(by_user.values(), key=lambda s: s.full_name)


@router.post("/import", response_model=AttendanceImportResult)
def import_attendance(
    payload: AttendanceImportRequest,
    db: Session = Depends(get_db),
    current: User = Depends(require_roles(*_MANAGER_ROLES)),
):
    """
    NHẬP CHẤM CÔNG HÀNG LOẠT từ file (CSV xuất từ phần mềm máy chấm công).
    Gom các lần quẹt theo (nhân viên, ngày): sớm nhất = giờ VÀO, muộn nhất = giờ RA;
    gộp với dữ liệu sẵn có. Khớp nhân viên theo CCCD / email / user_id trong cùng công ty.
    """
    cid = current.company_id
    rows = 0
    matched = 0
    unmatched: set[str] = set()
    cache: dict[str, User | None] = {}
    by_day: dict[tuple[int, date], list[datetime]] = {}

    for r in payload.punches:
        rows += 1
        ref = (r.employee_ref or "").strip()
        if not ref:
            continue
        if ref not in cache:
            cache[ref] = _resolve_user(db, cid, ref)
        u = cache[ref]
        if u is None:
            unmatched.add(ref)
            continue
        matched += 1
        by_day.setdefault((u.id, r.timestamp.date()), []).append(r.timestamp)

    days = 0
    days_no_checkout = 0
    for (uid, d), times in by_day.items():
        uniq = sorted(set(times))   # bỏ mốc trùng hệt nhau
        tmin, tmax = uniq[0], uniq[-1]
        rec = (
            db.query(Attendance)
            .filter(Attendance.user_id == uid, Attendance.work_date == d)
            .first()
        )
        if rec is None:
            rec = Attendance(company_id=cid, user_id=uid, work_date=d, source=AttendanceSource.MACHINE)
            db.add(rec)
        if rec.check_in is None or tmin < rec.check_in:
            rec.check_in = tmin
        if tmax > tmin and (rec.check_out is None or tmax > rec.check_out):
            rec.check_out = tmax
        rec.source = AttendanceSource.MACHINE
        days += 1
        if rec.check_out is None or rec.check_out <= rec.check_in:
            days_no_checkout += 1

    db.commit()
    return AttendanceImportResult(
        rows=rows, matched=matched, days_updated=days,
        days_no_checkout=days_no_checkout, unmatched=sorted(unmatched),
    )


@router.post("/punch", response_model=AttendanceOut)
def machine_punch(
    payload: MachinePunch,
    db: Session = Depends(get_db),
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
):
    """
    Endpoint cho MÁY CHẤM CÔNG gọi (không dùng JWT).
    Xác thực bằng header X-API-Key khớp settings.ATTENDANCE_API_KEY.
    Tra nhân viên theo employee_ref (user_id / email / số CCCD) rồi ghi mốc vào/ra.
    """
    if not settings.ATTENDANCE_API_KEY:
        raise HTTPException(503, "Chưa cấu hình ATTENDANCE_API_KEY cho máy chấm công.")
    if x_api_key != settings.ATTENDANCE_API_KEY:
        raise HTTPException(401, "X-API-Key không hợp lệ.")

    ref = payload.employee_ref.strip()
    user: User | None = None
    if ref.isdigit():
        user = db.get(User, int(ref))
    if user is None:
        # Email không phân biệt hoa/thường (khớp _resolve_user). Lưu ý: ATTENDANCE_API_KEY
        # là khóa CHUNG toàn hệ thống (chưa tách theo công ty) — cần bảo mật/đổi định kỳ.
        user = (
            db.query(User)
            .filter((User.email == ref.lower()) | (User.identity_card == ref))
            .first()
        )
    if user is None:
        raise HTTPException(404, "Không tìm thấy nhân viên khớp employee_ref.")

    ts = payload.timestamp or datetime.now()
    rec = (
        db.query(Attendance)
        .filter(Attendance.user_id == user.id, Attendance.work_date == ts.date())
        .first()
    )
    if rec is None:
        rec = Attendance(
            company_id=user.company_id, user_id=user.id, work_date=ts.date(),
            source=AttendanceSource.MACHINE, device_id=payload.device_id,
        )
        db.add(rec)
    rec.source = AttendanceSource.MACHINE
    if payload.device_id:
        rec.device_id = payload.device_id
    if payload.direction == PaymentDirection.IN:
        if rec.check_in is None:
            rec.check_in = ts
    else:
        rec.check_out = ts
    db.commit()
    db.refresh(rec)
    return rec
