"""
==========================================================================
 ĐỒNG BỘ CHẤM CÔNG TỪ CỔNG YUNATT (global.yunatt.com) VỀ ERP
==========================================================================
Máy chấm công khuôn mặt DOSCO đẩy lượt quẹt lên Yunatt cloud. Yunatt KHÔNG cấp
tài liệu API công khai, nên backend dùng trình duyệt ẩn (Playwright) đăng nhập
như người dùng thật rồi gọi đúng endpoint NỘI BỘ mà giao diện web đang dùng:

    POST /cardRecord/queryForMonth
        body: order=asc&offset=0&limit=1000&monthDataId=<ID>&search=
        -> {"total": N, "rows": [
              {"staffName": "D.V.QUANG", "staffNumber": "01",
               "day-2026-06-07": "07:44<br>12:23<br>19:02", ...}, ...]}

Map tháng "YYYY-MM" -> monthDataId đọc từ <select id="fq-monthDataId"> trên
trang /cardRecord/monthIndex.

Dòng dữ liệu: lấy lượt quẹt -> gom theo (nhân viên, ngày): sớm nhất = giờ VÀO,
muộn nhất = giờ RA -> ghi vào bảng Attendance (source=MACHINE). Nhờ vậy dữ liệu
tự hiện ở tổng hợp của sếp (/attendance/summary) và cá nhân (/attendance/me).

LƯU Ý KỸ THUẬT: Playwright dùng API ĐỒNG BỘ (sync) nên CHỈ được gọi từ luồng
KHÔNG có vòng lặp asyncio đang chạy — tức endpoint FastAPI khai báo `def`
(chạy ở threadpool) hoặc job của BackgroundScheduler. KHÔNG gọi trong `async def`.
"""
from __future__ import annotations

import json
import re
from datetime import date, datetime

from sqlalchemy.orm import Session

from app.config import settings


class YunattError(RuntimeError):
    """Lỗi đồng bộ Yunatt: thiếu cấu hình, đăng nhập hỏng, Playwright chưa cài…"""


_DAY_KEY_RE = re.compile(r"^day-(\d{4})-(\d{2})-(\d{2})$")
_TIME_RE = re.compile(r"^(\d{1,2}):(\d{2})(?::(\d{2}))?$")


# --------------------------------------------------------------------------
# Tiện ích tháng / công ty
# --------------------------------------------------------------------------
def current_month() -> str:
    return datetime.now().strftime("%Y-%m")


def default_months() -> list[str]:
    """Tháng hiện tại + tháng liền trước (bắt cả các mốc quẹt cuối tháng cũ)."""
    now = datetime.now()
    cur = now.strftime("%Y-%m")
    py = now.year if now.month > 1 else now.year - 1
    pm = now.month - 1 or 12
    prev = f"{py:04d}-{pm:02d}"
    return [prev, cur]


def resolve_company_id(db: Session) -> int | None:
    """Công ty ERP nhận dữ liệu Yunatt (config; 0 = công ty đầu tiên)."""
    from app.models import Company
    if settings.YUNATT_COMPANY_ID:
        return settings.YUNATT_COMPANY_ID
    c = db.query(Company).order_by(Company.id.asc()).first()
    return c.id if c else None


# --------------------------------------------------------------------------
# Bóc tách JSON của Yunatt
# --------------------------------------------------------------------------
def _parse_rows(rows, only_month: str | None = None):
    """rows JSON Yunatt -> (persons, punches).

    persons: list {staff_number, staff_name}
    punches: list {staff_number, staff_name, timestamp(datetime)}
    """
    persons: dict[str, str | None] = {}
    punches: list[dict] = []
    for row in rows or []:
        sn = str(row.get("staffNumber") or "").strip()
        if not sn:
            continue
        name = (str(row.get("staffName") or "").strip()) or None
        persons.setdefault(sn, name)
        for key, val in row.items():
            m = _DAY_KEY_RE.match(key)
            if not m or not val:
                continue
            yy, mm, dd = int(m.group(1)), int(m.group(2)), int(m.group(3))
            if only_month and f"{yy:04d}-{mm:02d}" != only_month:
                continue
            for part in str(val).split("<br>"):
                t = _TIME_RE.match(part.strip())
                if not t:
                    continue
                h, mi, se = int(t.group(1)), int(t.group(2)), int(t.group(3) or 0)
                if h > 23 or mi > 59 or se > 59:
                    continue
                try:
                    ts = datetime(yy, mm, dd, h, mi, se)
                except ValueError:
                    continue
                punches.append({"staff_number": sn, "staff_name": name, "timestamp": ts})
    persons_list = [{"staff_number": k, "staff_name": v} for k, v in persons.items()]
    return persons_list, punches


# --------------------------------------------------------------------------
# Playwright: đăng nhập + kéo dữ liệu các tháng
# --------------------------------------------------------------------------
def fetch_months(months: list[str]):
    """Đăng nhập Yunatt, kéo lượt quẹt các tháng (YYYY-MM). Trả (persons, punches).

    CHỈ gọi từ luồng không có asyncio loop (FastAPI sync def / job scheduler).
    """
    if not settings.YUNATT_EMAIL or not settings.YUNATT_PASSWORD:
        raise YunattError("Chưa cấu hình YUNATT_EMAIL / YUNATT_PASSWORD.")
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as e:  # noqa: BLE001
        raise YunattError(
            "Chưa cài Playwright. Chạy: pip install playwright && playwright install chromium"
        ) from e

    base = settings.YUNATT_BASE_URL.rstrip("/")
    all_persons: dict[str, str | None] = {}
    all_punches: list[dict] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=settings.YUNATT_HEADLESS,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        try:
            page = browser.new_context().new_page()
            page.set_default_timeout(45000)

            # 1) Đăng nhập (điền form thật, để JS của Yunatt tự xử lý nếu có mã hoá)
            page.goto(base + "/", wait_until="domcontentloaded")
            page.locator('input[type="text"], input[type="email"]').first.fill(settings.YUNATT_EMAIL)
            page.locator('input[type="password"]').first.fill(settings.YUNATT_PASSWORD)
            try:
                page.get_by_role("button", name=re.compile("login", re.I)).first.click(timeout=5000)
            except Exception:  # noqa: BLE001
                page.locator('input[type="password"]').first.press("Enter")
            try:
                page.wait_for_load_state("networkidle", timeout=30000)
            except Exception:  # noqa: BLE001
                pass

            # 2) Trang Punch Record -> đọc map tháng -> monthDataId
            page.goto(base + "/cardRecord/monthIndex", wait_until="domcontentloaded")
            try:
                page.wait_for_selector("#fq-monthDataId option", timeout=15000)
            except Exception as e:  # noqa: BLE001
                raise YunattError(
                    "Không vào được trang chấm công Yunatt — sai tài khoản/mật khẩu "
                    "hoặc giao diện Yunatt đã thay đổi."
                ) from e
            opts = page.eval_on_selector_all(
                "#fq-monthDataId option",
                "els => els.map(o => [o.value, (o.textContent || '').trim()])",
            )
            month_map = {text: val for val, text in opts if val}

            # 3) Kéo từng tháng qua đúng endpoint nội bộ
            for month in months:
                mid = month_map.get(month)
                if not mid:
                    continue
                body = f"order=asc&offset=0&limit=1000&monthDataId={mid}&search="
                text = page.evaluate(
                    """async (body) => {
                        const r = await fetch('/cardRecord/queryForMonth', {
                            method: 'POST',
                            headers: {
                                'X-Requested-With': 'XMLHttpRequest',
                                'Content-Type': 'application/x-www-form-urlencoded'
                            },
                            body
                        });
                        return await r.text();
                    }""",
                    body,
                )
                try:
                    data = json.loads(text)
                except (ValueError, TypeError):
                    continue
                persons, punches = _parse_rows(data.get("rows"), only_month=month)
                for pr in persons:
                    all_persons.setdefault(pr["staff_number"], pr["staff_name"])
                all_punches.extend(punches)
        finally:
            browser.close()

    persons_list = [{"staff_number": k, "staff_name": v} for k, v in all_persons.items()]
    return persons_list, all_punches


# --------------------------------------------------------------------------
# Ghép người Yunatt -> nhân viên ERP
# --------------------------------------------------------------------------
def _norm_name(s: str | None) -> str:
    return re.sub(r"\s+", " ", (s or "").strip()).lower()


def _norm_code(s: str | None) -> str:
    s = (s or "").strip()
    if not s:
        return ""
    return s.lstrip("0") or "0"   # "01" và "1" coi như một


def _build_matcher(db: Session, company_id: int):
    """(by_code, by_name): tra cứu nhanh nhân viên ERP trong công ty."""
    from app.models import User
    users = db.query(User).filter(User.company_id == company_id).all()
    by_code: dict[str, "User"] = {}
    by_name: dict[str, "User"] = {}
    for u in users:
        if u.yunatt_code:
            by_code[_norm_code(u.yunatt_code)] = u
        nm = _norm_name(u.full_name)
        if nm:
            by_name.setdefault(nm, u)
    return by_code, by_name


def _resolve(matcher, staff_number: str, staff_name: str | None):
    """Ưu tiên map theo yunatt_code; dự phòng theo tên đầy đủ trùng khít."""
    by_code, by_name = matcher
    u = by_code.get(_norm_code(staff_number))
    if u:
        return u
    if staff_name:
        return by_name.get(_norm_name(staff_name))
    return None


# --------------------------------------------------------------------------
# API cho router / scheduler dùng
# --------------------------------------------------------------------------
def record_failure(db: Session, company_id: int, message: str, trigger: str = "manual") -> None:
    """Ghi 1 dòng nhật ký đồng bộ THẤT BẠI (để Ban Giám đốc thấy lỗi job ngầm)."""
    from app.models import YunattSyncLog
    try:
        db.add(YunattSyncLog(
            company_id=company_id, ok=False, trigger=trigger,
            message=(message or "")[:1000],
        ))
        db.commit()
    except Exception:  # noqa: BLE001
        db.rollback()


def latest_status(db: Session, company_id: int):
    """Dòng nhật ký đồng bộ GẦN NHẤT của công ty (None nếu chưa từng chạy)."""
    from app.models import YunattSyncLog
    return (
        db.query(YunattSyncLog)
        .filter(YunattSyncLog.company_id == company_id)
        .order_by(YunattSyncLog.ran_at.desc(), YunattSyncLog.id.desc())
        .first()
    )


def run_sync(db: Session, company_id: int, months: list[str] | None = None,
             trigger: str = "manual") -> dict:
    """Kéo dữ liệu Yunatt -> ghi vào bảng Attendance. Trả về kết quả tổng hợp."""
    from app.models import Attendance, AttendanceSource

    months = months or default_months()
    _persons, punches = fetch_months(months)
    matcher = _build_matcher(db, company_id)

    by_day: dict[tuple[int, date], list[datetime]] = {}
    matched = 0
    unmatched: dict[str, str | None] = {}
    for pch in punches:
        u = _resolve(matcher, pch["staff_number"], pch["staff_name"])
        if u is None:
            unmatched.setdefault(pch["staff_number"], pch["staff_name"])
            continue
        matched += 1
        by_day.setdefault((u.id, pch["timestamp"].date()), []).append(pch["timestamp"])

    days = 0
    days_no_checkout = 0
    for (uid, d), times in by_day.items():
        uniq = sorted(set(times))   # bỏ mốc trùng hệt
        tmin, tmax = uniq[0], uniq[-1]
        rec = (
            db.query(Attendance)
            .filter(Attendance.user_id == uid, Attendance.work_date == d)
            .first()
        )
        if rec is None:
            rec = Attendance(
                company_id=company_id, user_id=uid, work_date=d,
                source=AttendanceSource.MACHINE, device_id="yunatt",
            )
            db.add(rec)
        if rec.check_in is None or tmin < rec.check_in:
            rec.check_in = tmin
        if tmax > tmin and (rec.check_out is None or tmax > rec.check_out):
            rec.check_out = tmax
        rec.source = AttendanceSource.MACHINE
        rec.device_id = rec.device_id or "yunatt"
        days += 1
        if rec.check_out is None or rec.check_out <= rec.check_in:
            days_no_checkout += 1

    # Ghi nhật ký lần đồng bộ thành công (để Ban Giám đốc theo dõi job ngầm 20:00).
    from app.models import YunattSyncLog
    db.add(YunattSyncLog(
        company_id=company_id, ok=True, trigger=trigger,
        months=", ".join(months), rows=len(punches), matched=matched,
        days_updated=days, days_no_checkout=days_no_checkout,
        unmatched_count=len(unmatched),
    ))
    db.commit()
    return {
        "months": months,
        "rows": len(punches),
        "matched": matched,
        "days_updated": days,
        "days_no_checkout": days_no_checkout,
        "unmatched": [
            {"staff_number": k, "staff_name": v} for k, v in sorted(unmatched.items())
        ],
    }


def list_persons(db: Session, company_id: int, months: list[str] | None = None) -> list[dict]:
    """Danh sách người trên Yunatt + trạng thái đã map sang nhân viên ERP (cho UI map)."""
    months = months or [current_month()]
    persons, _ = fetch_months(months)
    matcher = _build_matcher(db, company_id)
    out = []
    for pr in persons:
        u = _resolve(matcher, pr["staff_number"], pr["staff_name"])
        out.append({
            "staff_number": pr["staff_number"],
            "staff_name": pr["staff_name"],
            "user_id": u.id if u else None,
            "user_name": u.full_name if u else None,
        })
    out.sort(key=lambda x: x["staff_number"])
    return out
