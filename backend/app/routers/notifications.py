"""
Router Thông báo nội bộ — Giám đốc/Quản lý gửi cho cấp dưới hoặc toàn thể.
Mỗi người nhận = 1 bản ghi (fan-out) để theo dõi đã đọc/chưa đọc riêng.
Phạm vi gửi: USER (1 người) | MANAGERS (quản lý+kế toán) | STAFF (nhân viên) | EVERYONE.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import Notification, User, UserRole
from app.schemas import NotificationCreate, NotificationOut

router = APIRouter(prefix="/notifications", tags=["Thông báo"])

_DIRECTORS = (UserRole.ADMIN, UserRole.DIRECTOR)
_MANAGERS_UP = (UserRole.ADMIN, UserRole.DIRECTOR, UserRole.MANAGER, UserRole.ACCOUNTANT)


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
    return (
        db.query(Notification)
        .filter(Notification.recipient_id == current.id)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(limit)
        .all()
    )


@router.get("/me/unread-count")
def unread_count(db: Session = Depends(get_db), current: User = Depends(get_current_user)):
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
