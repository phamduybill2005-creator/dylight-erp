"""One optional GMF send after a manual ERP announcement has committed."""
from fastapi import Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.zalo_oa_service import ZaloOAService
from app.services.zalo_oauth_service import ZaloOAuthService


class NotificationZaloService:
    def __init__(self, oauth: ZaloOAuthService):
        self.oauth = oauth
        self.oa = ZaloOAService(oauth)

    def send_announcement(self, *, company_id: int, target: str, department: str | None,
                          title: str, body: str | None, sender_name: str) -> dict:
        if target == "USER":
            # No verified ERP user <-> OA UID mapping: never fall back to a shared group.
            return {"status": "skipped", "reason": "private_unavailable"}
        config = self.oauth.config
        if not config.ZALO_ENABLED:
            return {"status": "skipped", "reason": "disabled"}
        if company_id != config.ZALO_COMPANY_ID:
            return {"status": "skipped", "reason": "company_not_configured"}
        group_id = config.ZALO_GMF_GROUP_ID.strip()
        if not group_id:
            return {"status": "skipped", "reason": "group_not_configured"}
        labels = {"EVERYONE": "Tất cả mọi người", "MANAGERS": "Các quản lý",
                  "STAFF": "Toàn bộ nhân viên"}
        if target == "DEPARTMENT":
            label = " ".join((department or "").split())
            if not label:
                return {"status": "failed", "reason": "send_failed"}
            if not label.casefold().startswith("phòng "):
                label = f"Phòng {label}"
        else:
            label = labels.get(target)
            if label is None:
                return {"status": "failed", "reason": "send_failed"}
        message = (f"[THÔNG BÁO DOSCO]\n\nNgười nhận: {label}\nTiêu đề: {title}"
                   f"\nNội dung: {body or ''}\nNgười gửi: {sender_name}")
        try:
            # This service is invoked once per announcement, outside ERP recipient fan-out.
            # OAuth handles token refresh; neither it nor GMF retries the external request.
            self.oa.send_gmf_message(group_id, message)
        except Exception:
            # ERP rows are already committed. Database/provider exceptions can contain
            # sensitive parameters: do not forward or log their contents.
            try:
                self.oauth.db.rollback()
            except Exception:
                pass  # Session dependency still closes an unusable connection.
            return {"status": "failed", "reason": "send_failed"}
        return {"status": "sent"}


def get_notification_zalo_service(db: Session = Depends(get_db)) -> NotificationZaloService:
    return NotificationZaloService(ZaloOAuthService(db))
