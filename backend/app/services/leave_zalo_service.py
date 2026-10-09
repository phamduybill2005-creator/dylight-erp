"""One GMF text message after a leave submission or decision has committed."""
from urllib.parse import urlsplit

from fastapi import Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import LeaveStatus
from app.schemas import LeaveOut
from app.services.zalo_oa_service import ZaloOAService
from app.services.zalo_oauth_service import ZaloOAuthService


class LeaveZaloService:
    def __init__(self, oauth: ZaloOAuthService):
        self.oauth = oauth
        self.oa = ZaloOAService(oauth)

    def send_request(self, leave: LeaveOut) -> dict:
        return self._send(leave, decided=False)

    def send_decision(self, leave: LeaveOut) -> dict:
        if leave.source not in (None, "LEAVE"):
            return {"status": "skipped", "reason": "not_leave_request"}
        if leave.status not in (LeaveStatus.APPROVED, LeaveStatus.REJECTED):
            return {"status": "skipped", "reason": "not_decided"}
        return self._send(leave, decided=True)

    def _send(self, leave: LeaveOut, *, decided: bool) -> dict:
        config = self.oauth.config
        if not config.ZALO_ENABLED:
            return {"status": "skipped", "reason": "disabled"}
        if leave.company_id != config.ZALO_COMPANY_ID:
            return {"status": "skipped", "reason": "company_not_configured"}
        group_id = config.ZALO_GMF_GROUP_ID.strip()
        if not group_id:
            return {"status": "skipped", "reason": "group_not_configured"}
        try:
            # Validate the configured trusted origin; never use a request Host header.
            self.oauth.repository()
            callback = urlsplit(config.ZALO_OA_CALLBACK_URL)
            link = f"{callback.scheme}://{callback.netloc}/leave?request_id={leave.id}"
            kind = (leave.leave_type or "FULL").upper()
            late = kind.startswith("LATE")
            labels = {"FULL": "Cả ngày", "MORNING": "Buổi sáng", "AFTERNOON": "Buổi chiều",
                      "LATE": "Đi muộn sáng", "LATE_MORNING": "Đi muộn sáng",
                      "LATE_AFTERNOON": "Đi muộn chiều"}
            # Existing API accepts legacy types; do not invent a different form value.
            label = labels.get(kind, leave.leave_type or "Cả ngày")
            heading = "[KẾT QUẢ ĐƠN XIN NGHỈ DOSCO]" if decided else "[ĐƠN XIN NGHỈ DOSCO]"
            status = ("Đã duyệt" if leave.status == LeaveStatus.APPROVED else "Từ chối") if decided else "Chờ duyệt"
            actor = f"\nNgười xử lý: {leave.decided_by_name or 'Quản lý'}" if decided else ""
            link_label = "Xem đơn" if decided else "Xem và xử lý đơn"
            message = (f"{heading}\n\n"
                       f"Người gửi: {leave.user_name or 'Nhân sự'}\n"
                       f"Từ ngày: {leave.from_date:%d/%m/%Y}\nĐến ngày: {leave.to_date:%d/%m/%Y}\n"
                       f"{'Buổi đi muộn' if late else 'Thời gian nghỉ'}: {label}\n"
                       f"Lý do: {leave.reason or ''}\nNghỉ phép: {'Đi muộn' if late else 'Nghỉ'}\n"
                       f"Trạng thái: {status}{actor}\n\n{link_label}: {link}")
            self.oa.send_gmf_message(group_id, message)
        except Exception:
            # ERP data has committed; never return/log provider or DB exception contents.
            try:
                self.oauth.db.rollback()
            except Exception:
                pass
            return {"status": "failed", "reason": "send_failed"}
        return {"status": "sent"}


def get_leave_zalo_service(db: Session = Depends(get_db)) -> LeaveZaloService:
    return LeaveZaloService(ZaloOAuthService(db))
