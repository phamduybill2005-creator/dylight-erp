"""
Router Thông báo nội bộ — Giám đốc/Quản lý gửi cho cấp dưới hoặc toàn thể.
Mỗi người nhận = 1 bản ghi (fan-out) để theo dõi đã đọc/chưa đọc riêng.
Phạm vi gửi: USER (1 người) | MANAGERS (quản lý+kế toán) | STAFF (nhân viên) | EVERYONE.
Kèm nhắc ĐÁNH GIÁ HẰNG THÁNG: từ 8:00 ngày 27 mọi người nhận 1 thông báo từ "Hệ thống".
"""
import threading
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db, vn_now
from app.deps import get_current_user
from app.models import Notification, User, UserRole
from app.schemas import NotificationCreate, NotificationOut

router = APIRouter(prefix="/notifications", tags=["Thông báo"])

_DIRECTORS = (UserRole.ADMIN, UserRole.DIRECTOR)
_MANAGERS_UP = (UserRole.ADMIN, UserRole.DIRECTOR, UserRole.MANAGER, UserRole.ACCOUNTANT)

# ---- Nhắc ĐÁNH GIÁ HẰNG THÁNG (quy định: ngày 27 hằng tháng mọi người vào mục Đánh giá) ----
# Tạo "lười" khi người đó mở app (chuông gọi /me + /me/unread-count ~20 giây/lần) thay vì
# chạy lịch nền: không phụ thuộc scheduler (chỉ bật khi YUNATT_ENABLED), backend khởi động
# lại cũng không mất. Mỗi người 1 thông báo/tháng — nhận diện bằng tiêu đề có tháng.
EVAL_REMINDER_DAY = 27
EVAL_REMINDER_HOUR = 8          # từ 8:00 sáng ngày 27 (tránh bật popup lúc nửa đêm)
_eval_reminder_lock = threading.Lock()          # chuông gọi 2 API CÙNG LÚC -> chống tạo trùng
_eval_reminded: set[tuple[int, str]] = set()    # (user_id, "YYYY-MM") đã chắc chắn có thông báo


def _ensure_eval_reminder(db: Session, user: User) -> None:
    now = vn_now()
    if now < datetime(now.year, now.month, EVAL_REMINDER_DAY, EVAL_REMINDER_HOUR):
        return
    key = (user.id, now.strftime("%Y-%m"))
    if key in _eval_reminded:
        return
    title = f"Đến hạn đánh giá tháng {now:%m/%Y}"
    with _eval_reminder_lock:
        exists = (
            db.query(Notification.id)
            .filter(Notification.recipient_id == user.id, Notification.title == title)
            .first()
        )
        if not exists:
            db.add(Notification(
                company_id=user.company_id, sender_id=None, recipient_id=user.id, title=title,
                body=(f"Theo quy định, ngày {EVAL_REMINDER_DAY} hằng tháng mọi người vào mục "
                      f"Đánh giá để chấm đánh giá tháng {now:%m/%Y}."),
            ))
            db.commit()
        _eval_reminded.add(key)


def _resolve_recipients(db: Session, sender: User, target: str, target_user_id: int | None):
    base = db.query(User).filter(
        User.company_id == sender.company_id, User.is_active == True  # noqa: E712
    )
    if target == "USER":
        if not target_user_id:
            raise HTTPException(400, "Chưa chọn người nhận.")
        u = db.get(User, target_user_id)
        if not u or u.company_id != sender.company_id:
            raise HTTPException(400, "Người nhận không hợp lệ.")
        return [u]
    if target == "MANAGERS":
        return base.filter(User.role.in_([UserRole.MANAGER, UserRole.ACCOUNTANT])).all()
    if target == "STAFF":
        return base.filter(User.role == UserRole.FIELD_STAFF).all()
    if target == "EVERYONE":
        return base.all()
    raise HTTPException(400, "Phạm vi gửi không hợp lệ.")


@router.post("", status_code=201)
def send_notification(
    payload: NotificationCreate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    target = (payload.target or "USER").upper()
    if target in ("EVERYONE", "MANAGERS") and current.role not in _DIRECTORS:
        raise HTTPException(403, "Chỉ Giám đốc/Quản trị được gửi cho nhóm này.")
    if target == "STAFF" and current.role not in _MANAGERS_UP:
        raise HTTPException(403, "Bạn không có quyền gửi cho toàn bộ nhân viên.")
    # Nhân viên (FIELD_STAFF) chỉ được gửi thông báo cho QUẢN LÝ TRỰC TIẾP của mình
    # (tránh spam người khác; muốn nhắn đồng nghiệp đã có Chat).
    if target == "USER" and current.role == UserRole.FIELD_STAFF:
        if not current.manager_id or payload.target_user_id != current.manager_id:
            raise HTTPException(403, "Nhân viên chỉ gửi thông báo cho quản lý trực tiếp; hãy dùng Chat để nhắn người khác.")

    recipients = [u for u in _resolve_recipients(db, current, target, payload.target_user_id)
                  if u.id != current.id]
    if not recipients:
        raise HTTPException(400, "Không có người nhận phù hợp.")
    for u in recipients:
        db.add(Notification(
            company_id=current.company_id, sender_id=current.id, recipient_id=u.id,
            title=payload.title, body=payload.body,
        ))
    db.commit()
    return {"sent": len(recipients)}


@router.get("/me", response_model=list[NotificationOut])
def my_notifications(limit: int = 50, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    _ensure_eval_reminder(db, current)
    return (
        db.query(Notification)
        .filter(Notification.recipient_id == current.id)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(limit)
        .all()
    )


@router.get("/me/unread-count")
def unread_count(db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    _ensure_eval_reminder(db, current)
    n = (
        db.query(Notification)
        .filter(Notification.recipient_id == current.id, Notification.is_read == False)  # noqa: E712
        .count()
    )
    return {"count": n}


@router.post("/{notif_id}/read", status_code=204)
def mark_read(notif_id: int, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    n = db.get(Notification, notif_id)
    if not n or n.recipient_id != current.id:
        raise HTTPException(404, "Không tìm thấy thông báo.")
    n.is_read = True
    db.commit()


@router.post("/me/read-all", status_code=204)
def mark_all_read(db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    (
        db.query(Notification)
        .filter(Notification.recipient_id == current.id, Notification.is_read == False)  # noqa: E712
        .update({"is_read": True})
    )
    db.commit()
