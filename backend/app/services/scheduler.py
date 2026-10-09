"""
Lịch chạy nền: đồng bộ Yunatt và nhắc đánh giá Zalo khi được cấu hình bật.

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

import logging

from app.config import settings

_scheduler = None
_logger = logging.getLogger(__name__)


def _run_daily_sync() -> None:
    """Job: mở session riêng, xác định công ty rồi đồng bộ Yunatt."""
    from app.database import SessionLocal
    from app.services import yunatt_service

    db = SessionLocal()
    company_id = None
    try:
        company_id = yunatt_service.resolve_company_id(db)
        if not company_id:
            print("[yunatt-sync] khong tim thay cong ty -> bo qua.")
            return
        res = yunatt_service.run_sync(db, company_id, trigger="auto")
        print(
            f"[yunatt-sync] OK months={res['months']} rows={res['rows']} "
            f"matched={res['matched']} days={res['days_updated']} "
            f"unmatched={len(res['unmatched'])}"
        )
    except Exception as e:  # noqa: BLE001
        print(f"[yunatt-sync] LOI khi dong bo: {e}")
        if company_id:
            db.rollback()
            yunatt_service.record_failure(db, company_id, str(e), trigger="auto")
    finally:
        db.close()


def _run_eval_reminder() -> None:
    """Own a short-lived session; never expose exception/credential contents."""
    from app.database import SessionLocal
    from app.services.evaluation_zalo_service import EvaluationZaloService
    from app.services.zalo_oauth_service import ZaloOAuthService

    db = None
    try:
        db = SessionLocal()
        result = EvaluationZaloService(ZaloOAuthService(db, settings)).run_due()
        if result["status"] == "sent":
            _logger.info("[zalo-eval-reminder] sent")
        elif result["status"] == "failed" or result.get("reason") == "schema_not_ready":
            _logger.warning("[zalo-eval-reminder] unavailable; check schema/configuration/connection")
    except Exception:
        if db is not None:
            try:
                db.rollback()
            except Exception:
                pass
        _logger.warning("[zalo-eval-reminder] worker failed")
    finally:
        if db is not None:
            try:
                db.close()
            except Exception:
                _logger.warning("[zalo-eval-reminder] session cleanup failed")


def start_scheduler() -> None:
    """Register enabled jobs once; Zalo reminders are independent of Yunatt."""
    global _scheduler
    zalo_enabled = settings.ZALO_ENABLED and settings.ZALO_EVAL_REMINDER_ENABLED
    if _scheduler is not None or not (settings.YUNATT_ENABLED or zalo_enabled):
        return
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
    except ImportError:  # noqa: BLE001
        _logger.warning("[scheduler] APScheduler unavailable")
        return
    try:
        sched = BackgroundScheduler(timezone=settings.YUNATT_TIMEZONE if settings.YUNATT_ENABLED else "Asia/Ho_Chi_Minh")
        if settings.YUNATT_ENABLED:
            sched.add_job(
                _run_daily_sync,
                "cron",
                hour=settings.YUNATT_SYNC_HOUR,
                minute=settings.YUNATT_SYNC_MINUTE,
                id="yunatt_daily_sync",
                replace_existing=True,
                misfire_grace_time=3600,  # chạy bù trong 1h nếu lỡ giờ
                coalesce=True,
            )
        if zalo_enabled:
            sched.add_job(_run_eval_reminder, "cron", day=27, hour="8-23", minute="*/5", second=0,
                timezone="Asia/Ho_Chi_Minh", id="zalo_eval_reminder", replace_existing=True,
                misfire_grace_time=300, coalesce=True, max_instances=1)
            # Check the due window after restart without blocking ERP startup.
            sched.add_job(_run_eval_reminder, "date", id="zalo_eval_startup", replace_existing=True,
                misfire_grace_time=60, coalesce=True, max_instances=1)
        sched.start()
        _scheduler = sched
        if settings.YUNATT_ENABLED:
            print(
                f"[yunatt-sync] da bat lich chay {settings.YUNATT_SYNC_HOUR:02d}:"
                f"{settings.YUNATT_SYNC_MINUTE:02d} ({settings.YUNATT_TIMEZONE})."
            )
        if zalo_enabled:
            _logger.info("[zalo-eval-reminder] enabled: day 27, from 08:00 Vietnam time")
    except Exception:  # noqa: BLE001
        _logger.warning("[scheduler] could not start enabled jobs")
