"""
Router Chấm công (Attendance).

- Nhân viên tự bấm vào/ra trong app (check-in / check-out) — 1 bản ghi / người / ngày.
- Quản lý / Giám đốc xem bảng chấm công toàn đội + tổng hợp giờ làm để đánh giá hiệu quả.
- Máy chấm công gọi /attendance/punch (xác thực bằng X-API-Key, KHÔNG dùng JWT).
"""
import hmac
from datetime import date, datetime

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db, vn_now
from app.deps import get_current_user, require_roles
from app.models import Attendance, AttendanceSource, PaymentDirection, User, UserRole
from app.schemas import (
    AttendanceOut, AttendanceUpdate, AttendanceSummary, MachinePunch,
    AttendanceImportRequest, AttendanceImportResult,
    YunattSyncResult, YunattPerson, YunattSyncStatus,
)
from app.services import yunatt_service

router = APIRouter(prefix="/attendance", tags=["Chấm công"])

# Vai trò được xem chấm công toàn công ty (ADMIN tự được phép trong require_roles).
_MANAGER_ROLES = (UserRole.MANAGER, UserRole.ACCOUNTANT, UserRole.DIRECTOR)


def _is_senior_manager_up(user: User) -> bool:
    is_top = not user.manager_id and (not user.manager_ids or len(user.manager_ids) == 0)
    return user.role in (UserRole.ADMIN, UserRole.DIRECTOR) or (user.role == UserRole.MANAGER and is_top)


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
            company_id=current.company_id, user_id=current.id, work_date=vn_now().date(),
            check_in=vn_now(), source=AttendanceSource.MANUAL,
        )
        db.add(rec)
    elif rec.check_in is None:
        rec.check_in = vn_now()
    db.commit()
    db.refresh(rec)
    return rec


@router.post("/check-out", response_model=AttendanceOut)
def check_out(db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    """Bấm giờ ra cho hôm nay (cập nhật mốc ra mới nhất)."""
    rec = _today_record(db, current)
    if rec is None:
        rec = Attendance(
            company_id=current.company_id, user_id=current.id, work_date=vn_now().date(),
            check_out=vn_now(), source=AttendanceSource.MANUAL,
        )
        db.add(rec)
    else:
        now = vn_now()
        # Chỉ CHẶN khi giờ ra SỚM HƠN giờ vào (bấm nhầm / lệch đồng hồ) làm giờ công về 0.
        # Cho phép bằng nhau (vào-ra cùng giây) — tránh chặn oan.
        if rec.check_in is None or now >= rec.check_in:
            rec.check_out = now
        else:
            raise HTTPException(400, "Giờ ra không được sớm hơn giờ vào. Kiểm tra lại đồng hồ.")
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
    from_date: date | None = None,
    to_date: date | None = None,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Danh sách chấm công.
    - Quản trị hệ thống, Giám đốc, Quản lý cấp cao: xem được toàn bộ.
    - Các tài khoản còn lại: CHỈ xem được của chính mình.
    """
    if not _is_senior_manager_up(current):
        user_id = current.id

    q = db.query(Attendance).filter(Attendance.company_id == current.company_id)
    if user_id:
        q = q.filter(Attendance.user_id == user_id)
    if work_date:
        q = q.filter(Attendance.work_date == work_date)
    if from_date:
        q = q.filter(Attendance.work_date >= from_date)
    if to_date:
        q = q.filter(Attendance.work_date <= to_date)
    return q.order_by(Attendance.work_date.desc(), Attendance.user_id.asc()).all()


@router.put("/{attendance_id}", response_model=AttendanceOut)
def update_attendance(
    attendance_id: int,
    payload: AttendanceUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(require_roles(UserRole.ADMIN, UserRole.DIRECTOR, UserRole.MANAGER)),
):
    """Sửa mác đi trễ & ghi chú lý do của 1 bản ghi chấm công (CHỈ Quản trị hệ thống, Giám đốc, Quản lý cấp cao)."""
    if not _is_senior_manager_up(current):
        raise HTTPException(403, "Chỉ Quản trị hệ thống, Giám đốc và Quản lý cấp cao mới được chỉnh sửa mác đi trễ và ghi chú lý do.")

    rec = db.get(Attendance, attendance_id)
    if not rec or rec.company_id != current.company_id:
        raise HTTPException(404, "Không tìm thấy bản ghi chấm công.")

    if payload.is_late_override is not None:
        rec.is_late_override = payload.is_late_override
    if payload.note is not None:
        rec.note = payload.note
    db.commit()
    db.refresh(rec)
    return rec


@router.get("/summary", response_model=list[AttendanceSummary])
def attendance_summary(
    period: str | None = None,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """
    Tổng hợp số ngày công, số ngày đi trễ, tổng giờ làm theo từng người trong kỳ.
    - Quản trị hệ thống, Giám đốc, Quản lý cấp cao: xem được toàn bộ nhân sự.
    - Các tài khoản còn lại: CHỈ xem được của chính mình.
    """
    period = period or date.today().strftime("%Y-%m")
    q = (
        db.query(Attendance)
        .filter(Attendance.company_id == current.company_id)
        .filter(Attendance.work_date >= date.fromisoformat(period + "-01"))
    )
    if not _is_senior_manager_up(current):
        q = q.filter(Attendance.user_id == current.id)

    records = q.all()
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
            s.present_days += float(rec.work_credit)   # công theo ca: cả ngày=1, nửa ngày=0.5
        if rec.is_late:
            s.late_days += 1
        s.total_hours += round(rec.worked_minutes / 60, 2)
    for s in by_user.values():
        s.total_hours = round(s.total_hours, 2)
        s.present_days = round(s.present_days, 1)
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


@router.post("/sync-yunatt", response_model=YunattSyncResult)
def sync_yunatt(
    db: Session = Depends(get_db),
    current: User = Depends(require_roles(*_MANAGER_ROLES)),
):
    """
    ĐỒNG BỘ NGAY từ cổng Yunatt: backend đăng nhập (Playwright), kéo lượt quẹt
    tháng này + tháng trước rồi ghi vào bảng Attendance của công ty người đăng nhập.
    Endpoint khai báo `def` (chạy ở threadpool) để Playwright sync hoạt động.
    """
    if not settings.YUNATT_ENABLED:
        raise HTTPException(503, "Tính năng đồng bộ Yunatt đang tắt (đặt YUNATT_ENABLED=true).")
    try:
        return yunatt_service.run_sync(db, current.company_id, trigger="manual")
    except yunatt_service.YunattError as e:
        db.rollback()
        yunatt_service.record_failure(db, current.company_id, str(e), trigger="manual")
        raise HTTPException(502, str(e))


@router.get("/yunatt/status", response_model=YunattSyncStatus | None)
def yunatt_status(
    db: Session = Depends(get_db),
    current: User = Depends(require_roles(*_MANAGER_ROLES)),
):
    """Trạng thái lần đồng bộ Yunatt gần nhất (None nếu chưa từng chạy) — để theo dõi job 20:00."""
    return yunatt_service.latest_status(db, current.company_id)


@router.get("/yunatt/persons", response_model=list[YunattPerson])
def yunatt_persons(
    db: Session = Depends(get_db),
    current: User = Depends(require_roles(*_MANAGER_ROLES)),
):
    """Liệt kê người trên Yunatt + trạng thái đã map sang nhân viên ERP (để gán yunatt_code)."""
    if not settings.YUNATT_ENABLED:
        raise HTTPException(503, "Tính năng đồng bộ Yunatt đang tắt (đặt YUNATT_ENABLED=true).")
    try:
        return yunatt_service.list_persons(db, current.company_id)
    except yunatt_service.YunattError as e:
        raise HTTPException(502, str(e))


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
    # So sánh khóa kiểu hằng-thời-gian (chống dò khóa qua timing). Lưu ý: đây vẫn là
    # khóa CHUNG toàn hệ thống — cần tách khóa theo công ty/thiết bị (xem audit) để
    # chặn việc dùng khóa chấm công hộ người ở công ty khác.
    if not hmac.compare_digest(str(x_api_key or ""), settings.ATTENDANCE_API_KEY):
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

    ts = payload.timestamp or vn_now()
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
