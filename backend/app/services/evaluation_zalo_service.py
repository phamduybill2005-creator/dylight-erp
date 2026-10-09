"""One best-effort GMF evaluation reminder per company/month on day 27."""
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

from sqlalchemy import inspect

from app.database import vn_now
from app.services.zalo_oa_service import ZaloOAService
from app.services.zalo_oauth_service import ZaloOAuthService
from app.services.zalo_reminder_repository import ZaloReminderRepository
from app.zalo_reminder_models import ZaloEvaluationReminder

VIETNAM_TIMEZONE = timezone(timedelta(hours=7))


class EvaluationZaloService:
    def __init__(self, oauth: ZaloOAuthService):
        self.oauth = oauth
        self.oa = ZaloOAService(oauth)
        self.repository = ZaloReminderRepository(oauth.db)

    def run_due(self, now: datetime | None = None) -> dict:
        config = self.oauth.config
        if not config.ZALO_ENABLED or not config.ZALO_EVAL_REMINDER_ENABLED:
            return {"status": "skipped", "reason": "disabled"}
        now = now if now is not None else vn_now()
        if now.tzinfo is not None:
            now = now.astimezone(VIETNAM_TIMEZONE).replace(tzinfo=None)
        if now.day != 27 or now.hour < 8:
            return {"status": "skipped", "reason": "not_due"}
        group_id = config.ZALO_GMF_GROUP_ID.strip()
        if not group_id or config.ZALO_COMPANY_ID <= 0:
            return {"status": "skipped", "reason": "not_configured"}
        company_id, period = config.ZALO_COMPANY_ID, now.strftime("%Y-%m")
        claimed = False
        try:
            # Validates secrets/callback origin without making provider requests.
            oauth_repository = self.oauth.repository()
            inspector = inspect(self.oauth.db.get_bind())
            table = ZaloEvaluationReminder.__tablename__
            if (not inspector.has_table(table)
                    or inspector.get_pk_constraint(table)["constrained_columns"] != ["company_id", "period"]):
                return {"status": "skipped", "reason": "schema_not_ready"}
            credential = oauth_repository.get_credentials(company_id)
            if (credential is None or credential.oa_id != config.ZALO_OA_ID
                    or credential.app_id != config.ZALO_APP_ID or credential.status != "active"):
                return {"status": "skipped", "reason": "credential_unavailable"}
            if not self.repository.claim(company_id, period, config.ZALO_OA_ID, group_id):
                return {"status": "skipped", "reason": "already_claimed"}
            claimed = True
            callback = urlsplit(config.ZALO_OA_CALLBACK_URL)
            link = f"{callback.scheme}://{callback.netloc}/evaluations"
            message = ("[THÔNG BÁO DOSCO]\n\nNgười nhận: Tất cả mọi người\n"
                f"Tiêu đề: Đến hạn đánh giá tháng {now:%m/%Y}\n"
                "Nội dung: Theo quy định, ngày 27 hằng tháng mọi người vào mục Đánh giá "
                f"để chấm đánh giá tháng {now:%m/%Y}.\nNgười gửi: Hệ thống\n\nMở đánh giá: {link}")
            self.oa.send_gmf_message(group_id, message)
            self.repository.finish(company_id, period, "sent")
            return {"status": "sent"}
        except Exception:
            # Never log provider errors, bound SQL parameters or credential values.
            try:
                self.oauth.db.rollback()
                if claimed:
                    self.repository.finish(company_id, period, "failed")
            except Exception:
                try:
                    self.oauth.db.rollback()
                except Exception:
                    pass
            return {"status": "failed", "reason": "reminder_failed"}
