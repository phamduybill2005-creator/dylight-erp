"""
Bộ NHẬN ĐẨY TRỰC TIẾP từ máy chấm công theo giao thức ZKTeco PUSH (ADMS / iclock).

Cách dùng: trên máy chấm công, đặt "Địa chỉ máy chủ / Cloud server" = domain ERP
(vd dosco-erp-api.onrender.com, cổng 443/80) — máy sẽ tự gọi /iclock/cdata, /iclock/getrequest.
Bảo mật: chỉ xử lý số sê-ri (SN) nằm trong settings.IATT_DEVICE_SNS; trống = từ chối hết.

KHÔNG gắn tiền tố /api/v1 (máy gọi đúng đường /iclock/...). Đăng ký ở app gốc.
"""
from datetime import date, datetime

from fastapi import APIRouter, Depends, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import Attendance, AttendanceSource, Company, User
from app.routers.attendance import _resolve_user

router = APIRouter(prefix="/iclock", tags=["Máy chấm công (PUSH)"])


def _sn(request: Request) -> str:
    q = request.query_params
    return (q.get("SN") or q.get("sn") or "").strip()


def _allowed(sn: str) -> bool:
    allow = [s.strip() for s in (settings.IATT_DEVICE_SNS or "").split(",") if s.strip()]
    return bool(sn) and sn in allow


def _company_id(db: Session) -> int | None:
    if settings.IATT_COMPANY_ID:
        return settings.IATT_COMPANY_ID
    c = db.query(Company).order_by(Company.id).first()
    return c.id if c else None


@router.get("/cdata")
def cdata_handshake(request: Request):
    """Máy 'bắt tay' để nhận cấu hình truyền dữ liệu."""
    sn = _sn(request)
    if not _allowed(sn):
        return PlainTextResponse("OK")
    cfg = (
        f"GET OPTION FROM: {sn}\n"
        "ATTLOGStamp=None\nOPERLOGStamp=None\nATTPHOTOStamp=None\n"
        "ErrorDelay=30\nDelay=10\nTransTimes=00:00;14:00\nTransInterval=1\n"
        "TransFlag=1111000000\n"
        f"TimeZone={settings.IATT_TIMEZONE}\n"
        "Realtime=1\nEncrypt=None\n"
    )
    return PlainTextResponse(cfg)


@router.post("/cdata")
async def cdata_upload(request: Request, db: Session = Depends(get_db)):
    """Máy đẩy bản ghi chấm công (table=ATTLOG): mỗi dòng = PIN<TAB>thời gian<TAB>..."""
    sn = _sn(request)
    table = (request.query_params.get("table") or request.query_params.get("tablename") or "").upper()
    if not _allowed(sn):
        return PlainTextResponse("OK")
    if table and table != "ATTLOG":
        return PlainTextResponse("OK")  # OPERLOG / ảnh… -> bỏ qua, vẫn báo OK

    cid = _company_id(db)
    if cid is None:
        return PlainTextResponse("OK")

    body = (await request.body()).decode("utf-8", errors="ignore")
    by_day: dict[tuple[int, date], list[datetime]] = {}
    cache: dict[str, User | None] = {}
    count = 0
    for line in body.splitlines():
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        pin = parts[0].strip()
        ts_raw = parts[1].strip()
        ts = None
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
            try:
                ts = datetime.strptime(ts_raw, fmt)
                break
            except ValueError:
                continue
        if ts is None or not pin:
            continue
        if pin not in cache:
            cache[pin] = _resolve_user(db, cid, pin)
        u = cache[pin]
        if u is None:
            continue
        by_day.setdefault((u.id, ts.date()), []).append(ts)
        count += 1

    for (uid, d), times in by_day.items():
        uniq = sorted(set(times))
        tmin, tmax = uniq[0], uniq[-1]
        rec = (
            db.query(Attendance)
            .filter(Attendance.user_id == uid, Attendance.work_date == d)
            .first()
        )
        if rec is None:
            rec = Attendance(company_id=cid, user_id=uid, work_date=d, source=AttendanceSource.MACHINE, device_id=sn)
            db.add(rec)
        if rec.check_in is None or tmin < rec.check_in:
            rec.check_in = tmin
        if tmax > tmin and (rec.check_out is None or tmax > rec.check_out):
            rec.check_out = tmax
        rec.source = AttendanceSource.MACHINE
        rec.device_id = sn
    db.commit()
    return PlainTextResponse(f"OK: {count}")


@router.get("/getrequest")
@router.post("/getrequest")
def getrequest(request: Request):
    """Máy hỏi lệnh điều khiển — ta không gửi lệnh nào."""
    return PlainTextResponse("OK")


@router.get("/ping")
def ping(request: Request):
    """Cho máy/kỹ thuật kiểm tra kết nối nhanh."""
    sn = _sn(request)
    return PlainTextResponse("OK" if _allowed(sn) else "OK (SN chua duoc cau hinh)")
