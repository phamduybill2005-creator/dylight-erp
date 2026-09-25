"""Tạo thông báo nội bộ TỪ CÁC NGHIỆP VỤ khác (nghỉ phép, ...).

Router /notifications lo việc người dùng tự soạn gửi cho nhau. Module này dành
cho thông báo do HỆ THỐNG bắn ra khi có việc xảy ra, nên KHÔNG kiểm tra quyền
gửi — chỗ gọi tự quyết định ai nhận.

LUÔN gọi SAU khi nghiệp vụ chính đã commit: hàm tự commit và tự nuốt lỗi, để
thông báo hỏng không kéo theo mất dữ liệu thật (giống app/audit.log_activity).
"""
from sqlalchemy.orm import Session

from app.deps import is_top_leadership
from app.models import Notification, User


def leadership_of(db: Session, company_id: int, exclude_user_id: int | None = None) -> list[User]:
    """Quản trị hệ thống / Giám đốc / Quản lý cấp cao đang hoạt động của công ty.

    Dùng chung deps.is_top_leadership với quyền sửa giờ và xóa vĩnh viễn, để
    "cấp cao" ở mọi nơi trong hệ thống luôn là cùng một nhóm người.
    """
    users = (
        db.query(User)
        .filter(User.company_id == company_id, User.is_active == True)  # noqa: E712
        .order_by(User.id)
        .all()
    )
    return [u for u in users if is_top_leadership(u) and u.id != exclude_user_id]


def notify(
    db: Session,
    company_id: int,
    recipients: list[User] | list[int],
    title: str,
    body: str | None = None,
    sender_id: int | None = None,
) -> int:
    """Gửi 1 thông báo tới nhiều người (mỗi người 1 bản ghi riêng để theo dõi đã đọc).

    Trả về số người đã gửi; 0 nếu không có ai nhận hoặc gặp lỗi.
    """
    ids = [r if isinstance(r, int) else r.id for r in recipients]
    ids = [i for i in dict.fromkeys(ids) if i]   # bỏ trùng, giữ thứ tự
    if not ids:
        return 0
    try:
        for uid in ids:
            db.add(Notification(
                company_id=company_id, sender_id=sender_id, recipient_id=uid,
                title=title, body=body,
            ))
        db.commit()
        return len(ids)
    except Exception:  # noqa: BLE001
        db.rollback()
        return 0
