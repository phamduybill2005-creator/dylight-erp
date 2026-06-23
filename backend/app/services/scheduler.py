"""
Lịch chạy nền: TỰ ĐỘNG đồng bộ chấm công từ Yunatt mỗi ngày 1 lần (mặc định 20:00).

Dùng APScheduler BackgroundScheduler — job chạy trong LUỒNG RIÊNG (không có vòng
lặp asyncio) nên Playwright sync trong yunatt_service hoạt động bình thường.

Lưu ý vận hành:
- Cần backend chạy 24/7 (vd erp.dosco.vn). Nếu host "ngủ" khi nhàn rỗi
  (gói free) thì job có thể không nổ đúng giờ.
- Nếu chạy nhiều worker/instance, mỗi tiến trình sẽ có 1 scheduler -> có thể
  đồng bộ trùng. Việc ghi Attendance là idempotent (gộp theo người–ngày) nên
  không sai dữ liệu, nhưng nên chạy 1 worker cho tiến trình có scheduler.
"""
from __future__ import annotations

from app.config import settings

_scheduler = None


def _run_daily_sync() -> None:
    """Job: mở session riêng, xác định công ty rồi đồng bộ Yunatt."""
    from app.database import SessionLocal
    from app.services import yunatt_service

    db = SessionLocal()
    try:
        company_id = yunatt_service.resolve_company_id(db)
        if not company_id:
            print("[yunatt-sync] khong tim thay cong ty -> bo qua.")
            return
        res = yunatt_service.run_sync(db, company_id)
        print(
            f"[yunatt-sync] OK months={res['months']} rows={res['rows']} "
            f"matched={res['matched']} days={res['days_updated']} "
            f"unmatched={len(res['unmatched'])}"
        )
    except Exception as e:  # noqa: BLE001
        print(f"[yunatt-sync] LOI khi dong bo: {e}")
    finally:
        db.close()


def start_scheduler() -> None:
    """Bật lịch nếu YUNATT_ENABLED. An toàn khi gọi nhiều lần (chỉ tạo 1 lần)."""
    global _scheduler
    if not settings.YUNATT_ENABLED or _scheduler is not None:
        return
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
    except ImportError as e:  # noqa: BLE001
        print(f"[yunatt-sync] thieu apscheduler -> tat lich tu dong: {e}")
        return
    try:
        sched = BackgroundScheduler(timezone=settings.YUNATT_TIMEZONE)
        sched.add_job(
            _run_daily_sync,
            "cron",
            hour=settings.YUNATT_SYNC_HOUR,
            minute=settings.YUNATT_SYNC_MINUTE,
            id="yunatt_daily_sync",
            replace_existing=True,
            misfire_grace_time=3600,  # chạy bù trong 1h nếu lỡ giờ
            coalesce=True,            # gộp nhiều lần lỡ thành 1
        )
        sched.start()
        _scheduler = sched
        print(
            f"[yunatt-sync] da bat lich chay {settings.YUNATT_SYNC_HOUR:02d}:"
            f"{settings.YUNATT_SYNC_MINUTE:02d} ({settings.YUNATT_TIMEZONE})."
        )
    except Exception as e:  # noqa: BLE001
        print(f"[yunatt-sync] khong khoi dong duoc lich: {e}")
