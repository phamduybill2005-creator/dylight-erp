"""
Router Đồng nghiệp — danh bạ nội bộ cho MỌI người dùng:
- Đặt BIỆT DANH riêng tư cho từng đồng nghiệp (chỉ người đặt nhìn thấy).
- Quản lý/Giám đốc: kéo tài khoản có sẵn vào TEAM của mình (đặt manager_id = mình).
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, require_roles
from app.models import Nickname, User, UserRole
from app.schemas import ColleagueOut, NicknameSet

router = APIRouter(prefix="/colleagues", tags=["Đồng nghiệp"])


def _to_colleague(db: Session, current: User, u: User) -> ColleagueOut:
    nn = (
        db.query(Nickname)
        .filter(Nickname.owner_id == current.id, Nickname.target_id == u.id)
        .first()
    )
    mgr = db.get(User, u.manager_id) if u.manager_id else None
    return ColleagueOut(
        id=u.id, full_name=u.full_name, role=u.role, department=u.department,
        manager_id=u.manager_id, manager_name=mgr.full_name if mgr else None,
        my_nickname=nn.nickname if nn else None, in_my_team=(u.manager_id == current.id),
    )


@router.get("", response_model=list[ColleagueOut])
def list_colleagues(db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    """Danh bạ đồng nghiệp (trừ chính mình) kèm biệt danh riêng của mình + cờ thuộc team mình."""
    users = (
        db.query(User)
        .filter(
            User.company_id == current.company_id,
            User.is_active == True,  # noqa: E712
            User.is_approved == True,  # noqa: E712
            User.id != current.id,
        )
        .order_by(User.full_name)
        .all()
    )
    my_nn = {
        n.target_id: n.nickname
        for n in db.query(Nickname).filter(Nickname.owner_id == current.id).all()
    }
    umap = {u.id: u for u in db.query(User).filter(User.company_id == current.company_id).all()}
    out = []
    for u in users:
        mgr = umap.get(u.manager_id) if u.manager_id else None
        out.append(ColleagueOut(
            id=u.id, full_name=u.full_name, role=u.role, department=u.department,
            manager_id=u.manager_id, manager_name=mgr.full_name if mgr else None,
            my_nickname=my_nn.get(u.id), in_my_team=(u.manager_id == current.id),
        ))
    return out


@router.put("/{user_id}/nickname", response_model=ColleagueOut)
def set_nickname(
    user_id: int,
    payload: NicknameSet,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Đặt / sửa / xoá biệt danh RIÊNG của mình cho một người (chỉ mình thấy)."""
    target = db.get(User, user_id)
    if not target or target.company_id != current.company_id or target.id == current.id:
        raise HTTPException(400, "Người dùng không hợp lệ.")
    nn = (
        db.query(Nickname)
        .filter(Nickname.owner_id == current.id, Nickname.target_id == user_id)
        .first()
    )
    name = (payload.nickname or "").strip()
    if not name:
        if nn:
            db.delete(nn)
    elif nn:
        nn.nickname = name
    else:
        db.add(Nickname(company_id=current.company_id, owner_id=current.id, target_id=user_id, nickname=name))
    db.commit()
    db.refresh(target)
    return _to_colleague(db, current, target)


@router.post("/{user_id}/team", response_model=ColleagueOut)
def add_to_team(
    user_id: int,
    db: Session = Depends(get_db),
    # Quản lý & Giám đốc (ADMIN luôn được) mới gom được team.
    current: User = Depends(require_roles(UserRole.DIRECTOR, UserRole.MANAGER)),
):
    """Thêm một tài khoản vào team mình (đặt mình làm quản lý trực tiếp của họ)."""
    target = db.get(User, user_id)
    if not target or target.company_id != current.company_id or target.id == current.id:
        raise HTTPException(400, "Người dùng không hợp lệ.")
    if target.role in (UserRole.ADMIN, UserRole.DIRECTOR):
        raise HTTPException(400, "Không thể đưa cấp Giám đốc/Quản trị vào team.")
    target.manager_id = current.id
    db.commit()
    db.refresh(target)
    return _to_colleague(db, current, target)


@router.delete("/{user_id}/team", response_model=ColleagueOut)
def remove_from_team(
    user_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(require_roles(UserRole.DIRECTOR, UserRole.MANAGER)),
):
    """Bỏ một người khỏi team mình (chỉ bỏ nếu họ đang do mình quản lý)."""
    target = db.get(User, user_id)
    if not target or target.company_id != current.company_id:
        raise HTTPException(404, "Không tìm thấy người dùng.")
    if target.manager_id == current.id:
        target.manager_id = None
        db.commit()
        db.refresh(target)
    return _to_colleague(db, current, target)
