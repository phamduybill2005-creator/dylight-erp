"""Tiện ích ghi nhật ký hoạt động (audit log) — ai làm gì, lúc nào.

Cột `action` lưu MÃ ổn định (vd "project.delete") để sau này lọc / thống kê được;
trang Nhật ký hiển thị NHÃN TIẾNG VIỆT tra từ ACTION_LABELS. Thêm hành động mới
thì thêm nhãn ở đây — mã chưa có nhãn vẫn hiện nguyên mã, không lỗi.

Nguyên tắc chọn việc để ghi: XÓA dữ liệu, ĐỔI QUYỀN truy cập, hoặc SỬA SỐ LIỆU
CỦA NGƯỜI KHÁC. Cố ý KHÔNG ghi việc tự khai giờ của chính mình — hàng chục lượt
mỗi ngày sẽ đẩy các dòng quan trọng ra khỏi trang nhật ký (chỉ hiện 200 dòng).
"""
from datetime import date
from decimal import Decimal

from sqlalchemy.orm import Session

from app.events import publish
from app.models import ActivityLog, User

ACTION_LABELS: dict[str, str] = {
    # Hóa đơn, hồ sơ thiết kế, đơn nghỉ (đã ghi từ trước)
    "invoice.upload": "Tải hóa đơn (AI bóc tách)",
    "invoice.verify": "Duyệt hóa đơn",
    "design.create": "Tạo hồ sơ thiết kế",
    "design.draft": "Hồ sơ thiết kế → Nháp",
    "design.submitted": "Hồ sơ thiết kế → Đã trình CĐT",
    "design.reviewing": "Hồ sơ thiết kế → Đang thẩm tra",
    "design.approved": "Hồ sơ thiết kế → Đã phê duyệt",
    "design.revise": "Hồ sơ thiết kế → Yêu cầu sửa",
    "leave.approved": "Duyệt đơn nghỉ",
    "leave.rejected": "Từ chối đơn nghỉ",
    "leave.delete": "Xóa đơn nghỉ",
    "leave.student_schedule": "Đăng ký lịch sinh viên",
    # Tài khoản
    "user.create": "Tạo tài khoản",
    "user.delete": "Xóa tài khoản",
    "user.role_change": "Đổi vai trò",
    "user.lock": "Khóa tài khoản",
    "user.unlock": "Mở khóa tài khoản",
    "user.approve": "Duyệt tài khoản",
    "user.reset_password": "Đặt lại mật khẩu",
    "user.change_password": "Tự đổi mật khẩu",
    # Dự án & hạng mục
    "project.delete": "Xóa dự án (vào thùng rác)",
    "project_item.delete": "Xóa hạng mục (vào thùng rác)",
    "project_item.remove_worker": "Gỡ người khỏi đầu việc",
    # Thùng rác
    "archive.restore_project": "Khôi phục dự án",
    "archive.restore_item": "Khôi phục hạng mục",
    "archive.purge_project": "Xóa vĩnh viễn dự án",
    "archive.purge_item": "Xóa vĩnh viễn hạng mục",
    # Số liệu của người khác
    "timesheet.edit_other": "Sửa giờ công hộ người khác",
    "timesheet.delete_other": "Xóa giờ công của người khác",
    "timesheet.clear_other": "Xóa sạch giờ công của người khác",
    "attendance.late_override": "Sửa mác đi muộn",
}

ENTITY_LABELS: dict[str, str] = {
    "invoice": "Hóa đơn",
    "design_document": "Hồ sơ thiết kế",
    "leave_request": "Đơn nghỉ",
    "user": "Tài khoản",
    "project": "Dự án",
    "project_item": "Hạng mục",
    "timesheet": "Giờ công",
    "attendance": "Chấm công",
}

ROLE_LABELS: dict[str, str] = {
    "ADMIN": "Quản trị hệ thống",
    "DIRECTOR": "Giám đốc",
    "MANAGER": "Quản lý cấp cao",
    "MANAGER_MID": "Quản lý cấp trung",
    "FIELD_STAFF": "Nhân viên",
}


def role_vi(role) -> str:
    """Tên vai trò tiếng Việt (nhận cả enum lẫn chuỗi)."""
    key = getattr(role, "value", role)
    return ROLE_LABELS.get(key, str(key))


def date_vi(d: date | None) -> str:
    return d.strftime("%d/%m/%Y") if d else "—"


def hours_vi(h: Decimal | float | int | None) -> str:
    """8 -> "8h", 4.50 -> "4.5h", None/0 -> "0h"."""
    return f"{float(h or 0):g}h"


def log_activity(
    db: Session,
    user: User,
    action: str,
    entity_type: str | None = None,
    entity_id: int | None = None,
    detail: str | None = None,
) -> None:
    """Ghi 1 dòng audit. Tự nuốt lỗi để không làm hỏng nghiệp vụ chính.

    Tự commit -> LUÔN gọi SAU khi nghiệp vụ chính đã commit xong, để lỗi ghi log
    (nếu có) không kéo theo rollback dữ liệu thật.
    """
    try:
        db.add(ActivityLog(
            company_id=user.company_id, user_id=user.id, action=action,
            entity_type=entity_type, entity_id=entity_id, detail=detail,
        ))
        db.commit()
        publish(user.company_id, "audit")
    except Exception:
        db.rollback()
