"""Monthly opening and one combined morning follow-up per company/day on days 2–5."""
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

from sqlalchemy import inspect

from app.database import vn_now
from app.services.evaluation_calendar import EVAL_DEADLINE_DAY, EVAL_REMINDER_DAY, EVAL_REMINDER_HOUR, evaluation_reminder
from app.services.evaluation_completion import pending_evaluators
from app.services.zalo_oa_service import ZaloOAService
from app.services.zalo_oauth_service import ZaloOAuthService
from app.services.zalo_reminder_repository import ZaloReminderRepository
from app.zalo_reminder_models import ZaloEvaluationDailyReminder, ZaloEvaluationReminder

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
        followup = EVAL_REMINDER_DAY < now.day <= EVAL_DEADLINE_DAY and now.hour == EVAL_REMINDER_HOUR
        opening = now.day == EVAL_REMINDER_DAY and now.hour >= EVAL_REMINDER_HOUR
        if not (opening or followup):
            return {"status": "skipped", "reason": "not_due"}
        group_id = config.ZALO_GMF_GROUP_ID.strip()
        if not group_id or config.ZALO_COMPANY_ID <= 0:
            return {"status": "skipped", "reason": "not_configured"}
        company_id = config.ZALO_COMPANY_ID
        period = now.strftime("%Y-%m-%d" if followup else "%Y-%m")
        model = ZaloEvaluationDailyReminder if followup else ZaloEvaluationReminder
        repository = ZaloReminderRepository(self.oauth.db, model) if followup else self.repository
        claimed = False
        try:
            # Validates secrets/callback origin without making provider requests.
            oauth_repository = self.oauth.repository()
            inspector = inspect(self.oauth.db.get_bind())
            table = model.__tablename__
            if (not inspector.has_table(table)
                    or inspector.get_pk_constraint(table)["constrained_columns"] != ["company_id", "period"]):
                return {"status": "skipped", "reason": "schema_not_ready"}
            credential = oauth_repository.get_credentials(company_id)
            if (credential is None or credential.oa_id != config.ZALO_OA_ID
                    or credential.app_id != config.ZALO_APP_ID or credential.status != "active"):
                return {"status": "skipped", "reason": "credential_unavailable"}
            reviewed_month, title, body = evaluation_reminder(now)
            pending = pending_evaluators(self.oauth.db, company_id, reviewed_month) if followup else None
            if not repository.claim(company_id, period, config.ZALO_OA_ID, group_id):
                return {"status": "skipped", "reason": "already_claimed"}
            claimed = True
            if followup and not pending:
                repository.finish(company_id, period, "complete")
                return {"status": "skipped", "reason": "all_complete"}
            callback = urlsplit(config.ZALO_OA_CALLBACK_URL)
            link = f"{callback.scheme}://{callback.netloc}/peer-review?month={reviewed_month}"
            if followup:
                title = f"Chưa hoàn thành đánh giá tháng {reviewed_month[5:]}/{reviewed_month[:4]}"
                names = "\n".join(f"{index}. {' '.join(person.full_name.split())}" for index, person in enumerate(pending, 1))
                body = (f"Danh sách nhân sự chưa chấm đủ các phiếu Chất lượng công việc và Tập thể:\n{names}\n"
                        f"Vui lòng hoàn thành trước hết ngày 05/{now:%m/%Y}.")
            message = ("[THÔNG BÁO DOSCO]\n\nNgười nhận: Tất cả mọi người\n"
                f"Tiêu đề: {title}\nNội dung: {body}\n"
                f"Người gửi: Hệ thống\n\nMở đánh giá: {link}")
            self.oa.send_gmf_message(group_id, message)
            repository.finish(company_id, period, "sent")
            return {"status": "sent"}
        except Exception:
            # Never log provider errors, bound SQL parameters or credential values.
            try:
                self.oauth.db.rollback()
                if claimed:
                    repository.finish(company_id, period, "failed")
            except Exception:
                try:
                    self.oauth.db.rollback()
                except Exception:
                    pass
            return {"status": "failed", "reason": "reminder_failed"}
