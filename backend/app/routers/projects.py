"""
Router Quản lý Dự án (Projects) — CRUD, lọc theo công ty + theo THÀNH VIÊN.

Nguyên tắc quyền:
- Director/Admin: xem & quản trị MỌI dự án của công ty.
- Người khác (Quản lý/Kế toán/Nhân viên): CHỈ thấy dự án mà mình là thành viên
  hoặc là người chủ trì (lead). Cô lập theo company_id luôn được giữ.
- Quản lý thành viên / đặt người chủ trì: Director/Admin hoặc chính người chủ trì
  hiện tại của dự án (để chỉ huy trưởng tự điều phối đội của mình).
"""
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import (
    Assignment, ChatMessage, Contract, Conversation, ConversationMember, DesignDocument,
    Invoice, MessageReaction, Payment, Progress, Project, ProjectItem, User, UserRole,
    project_members,
)
from app.schemas import (
    ProjectCreate, ProjectLeadSet, ProjectMemberChange, ProjectOut, ProjectUpdate,
)

router = APIRouter(prefix="/projects", tags=["Dự án"])


def _is_director(user: User) -> bool:
    """Director/Admin — thấy & quản trị mọi dự án."""
    return user.role in (UserRole.DIRECTOR, UserRole.ADMIN)


def _can_view(db: Session, project: Project, user: User) -> bool:
    """Được xem nếu là Director/Admin, người chủ trì, hoặc thành viên."""
    if _is_director(user):
        return True
    if project.lead_id == user.id:
        return True
    member = (
        db.query(project_members)
        .filter(
            project_members.c.project_id == project.id,
            project_members.c.user_id == user.id,
        )
        .first()
    )
    return member is not None


def _can_manage(db: Session, project: Project, user: User) -> bool:
    """Quản trị (thành viên/chủ trì): Director/Admin hoặc chính người chủ trì."""
    return _is_director(user) or project.lead_id == user.id


def _progress_percent(db: Session, project_id: int) -> Decimal:
    """% tiến độ THỰC = trung bình % của các mốc Progress (0 nếu chưa có mốc)."""
    avg = (
        db.query(func.avg(Progress.percent_complete))
        .filter(Progress.project_id == project_id)
        .scalar()
    )
    return Decimal(avg).quantize(Decimal("0.1")) if avg is not None else Decimal(0)


def _to_out(db: Session, project: Project) -> ProjectOut:
    """Map ORM -> ProjectOut kèm % tiến độ thực (bơm thủ công)."""
    out = ProjectOut.model_validate(project)
    out.progress_percent = _progress_percent(db, project.id)
    return out


@router.get("", response_model=list[ProjectOut])
def list_projects(db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    q = db.query(Project).filter(Project.company_id == current.company_id)
    if not _is_director(current):
        # Chỉ dự án mình là thành viên HOẶC là người chủ trì.
        member_pids = (
            db.query(project_members.c.project_id)
            .filter(project_members.c.user_id == current.id)
        )
        q = q.filter(
            (Project.id.in_(member_pids)) | (Project.lead_id == current.id)
        )
    projects = q.order_by(Project.created_at.desc()).all()
    return [_to_out(db, p) for p in projects]


@router.post("", response_model=ProjectOut, status_code=201)
def create_project(
    payload: ProjectCreate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    data = payload.model_dump()
    # Validate mọi người liên quan (chủ trì / GEO担当 / DOSCO担当) đều thuộc cùng công ty.
    for fld, label in (("lead_id", "Người chủ trì"), ("geo_manager_id", "GEO担当"),
                       ("dosco_manager_id", "DOSCO担当")):
        uid = data.get(fld)
        if uid is not None:
            u = db.get(User, uid)
            if not u or u.company_id != current.company_id:
                raise HTTPException(400, f"{label} không hợp lệ.")
    project = Project(**data, company_id=current.company_id)
    db.add(project)
    db.commit()
    db.refresh(project)
    return _to_out(db, project)


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: int, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    p = db.get(Project, project_id)
    if not p or p.company_id != current.company_id or not _can_view(db, p, current):
        raise HTTPException(404, "Không tìm thấy dự án.")
    return _to_out(db, p)


@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(
    project_id: int,
    payload: ProjectUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    p = db.get(Project, project_id)
    if not p or p.company_id != current.company_id or not _can_view(db, p, current):
        raise HTTPException(404, "Không tìm thấy dự án.")

    data = payload.model_dump(exclude_unset=True)

    # member_ids / lead_id / GEO担当 / DOSCO担当 là thao tác QUẢN TRỊ -> đòi quyền _can_manage.
    touches_admin = any(k in data for k in ("member_ids", "lead_id", "geo_manager_id", "dosco_manager_id"))
    if touches_admin and not _can_manage(db, p, current):
        raise HTTPException(403, "Bạn không có quyền quản lý thành viên/người phụ trách dự án này.")

    # Validate GEO担当 / DOSCO担当 (nếu có) thuộc cùng công ty; None = gỡ.
    for fld, label in (("geo_manager_id", "GEO担当"), ("dosco_manager_id", "DOSCO担当")):
        if fld in data and data[fld] is not None:
            u = db.get(User, data[fld])
            if not u or u.company_id != current.company_id:
                raise HTTPException(400, f"{label} không hợp lệ.")

    if "member_ids" in data:
        member_ids = data.pop("member_ids")
        if member_ids is not None:
            uniq = set(member_ids)
            users = (
                db.query(User)
                .filter(User.id.in_(uniq), User.company_id == current.company_id)
                .all()
            )
            if len(users) != len(uniq):
                raise HTTPException(400, "Có thành viên không hợp lệ.")
            p.members = users

    if "lead_id" in data:
        lead_id = data.pop("lead_id")
        if lead_id is not None:
            lead = db.get(User, lead_id)
            if not lead or lead.company_id != current.company_id:
                raise HTTPException(400, "Người chủ trì không hợp lệ.")
        p.lead_id = lead_id

    for k, v in data.items():
        setattr(p, k, v)

    db.commit()
    db.refresh(p)
    return _to_out(db, p)


@router.delete("/{project_id}", status_code=204)
def delete_project(
    project_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Xoá dự án + TOÀN BỘ dữ liệu con (hợp đồng, hóa đơn, thanh toán, hạng mục,
    tiến độ, giao việc, hồ sơ TK, nhóm chat của dự án). CHỈ Giám đốc/Quản trị."""
    p = db.get(Project, project_id)
    if not p or p.company_id != current.company_id:
        raise HTTPException(404, "Không tìm thấy dự án.")
    if not _is_director(current):
        raise HTTPException(403, "Chỉ Giám đốc/Quản trị mới được xoá dự án.")

    d = lambda q: q.delete(synchronize_session=False)  # noqa: E731

    # 1) Nhóm chat gắn dự án -> xoá cảm xúc/tin/thành viên rồi tới phòng (không dựa DB cascade).
    conv_ids = [r[0] for r in db.query(Conversation.id).filter(Conversation.project_id == project_id).all()]
    if conv_ids:
        msg_ids = [r[0] for r in db.query(ChatMessage.id).filter(ChatMessage.conversation_id.in_(conv_ids)).all()]
        if msg_ids:
            d(db.query(MessageReaction).filter(MessageReaction.message_id.in_(msg_ids)))
            d(db.query(ChatMessage).filter(ChatMessage.id.in_(msg_ids)))
        d(db.query(ConversationMember).filter(ConversationMember.conversation_id.in_(conv_ids)))
        d(db.query(Conversation).filter(Conversation.id.in_(conv_ids)))

    # 2) Thanh toán (theo hợp đồng của dự án) -> hợp đồng -> hóa đơn.
    contract_ids = [r[0] for r in db.query(Contract.id).filter(Contract.project_id == project_id).all()]
    if contract_ids:
        d(db.query(Payment).filter(Payment.contract_id.in_(contract_ids)))
    d(db.query(Contract).filter(Contract.project_id == project_id))
    d(db.query(Invoice).filter(Invoice.project_id == project_id))

    # 3) Hạng mục (tự tham chiếu: xoá con trước, rồi cha), tiến độ, giao việc, hồ sơ TK.
    d(db.query(ProjectItem).filter(ProjectItem.project_id == project_id, ProjectItem.parent_id.isnot(None)))
    d(db.query(ProjectItem).filter(ProjectItem.project_id == project_id))
    d(db.query(Progress).filter(Progress.project_id == project_id))
    d(db.query(Assignment).filter(Assignment.project_id == project_id))
    d(db.query(DesignDocument).filter(DesignDocument.project_id == project_id))

    # 4) Bảng thành viên (M2M) + chính dự án.
    db.execute(project_members.delete().where(project_members.c.project_id == project_id))
    db.delete(p)
    db.commit()
    return None


@router.post("/{project_id}/members", response_model=ProjectOut)
def add_member(
    project_id: int,
    payload: ProjectMemberChange,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Thêm 1 thành viên vào dự án (Director/Admin hoặc người chủ trì)."""
    p = db.get(Project, project_id)
    if not p or p.company_id != current.company_id:
        raise HTTPException(404, "Không tìm thấy dự án.")
    if not _can_manage(db, p, current):
        raise HTTPException(403, "Bạn không có quyền quản lý thành viên dự án này.")
    user = db.get(User, payload.user_id)
    if not user or user.company_id != current.company_id:
        raise HTTPException(400, "Thành viên không hợp lệ.")
    if user not in p.members:
        p.members.append(user)
        db.commit()
        db.refresh(p)
    return _to_out(db, p)


@router.delete("/{project_id}/members/{user_id}", response_model=ProjectOut)
def remove_member(
    project_id: int,
    user_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Bớt 1 thành viên khỏi dự án (Director/Admin hoặc người chủ trì)."""
    p = db.get(Project, project_id)
    if not p or p.company_id != current.company_id:
        raise HTTPException(404, "Không tìm thấy dự án.")
    if not _can_manage(db, p, current):
        raise HTTPException(403, "Bạn không có quyền quản lý thành viên dự án này.")
    user = db.get(User, user_id)
    if user and user in p.members:
        p.members.remove(user)
        db.commit()
        db.refresh(p)
    return _to_out(db, p)


@router.put("/{project_id}/lead", response_model=ProjectOut)
def set_lead(
    project_id: int,
    payload: ProjectLeadSet,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Đặt/gỡ người chủ trì dự án (Director/Admin hoặc người chủ trì hiện tại)."""
    p = db.get(Project, project_id)
    if not p or p.company_id != current.company_id:
        raise HTTPException(404, "Không tìm thấy dự án.")
    if not _can_manage(db, p, current):
        raise HTTPException(403, "Bạn không có quyền đặt người chủ trì dự án này.")
    if payload.lead_id is not None:
        lead = db.get(User, payload.lead_id)
        if not lead or lead.company_id != current.company_id:
            raise HTTPException(400, "Người chủ trì không hợp lệ.")
    p.lead_id = payload.lead_id
    db.commit()
    db.refresh(p)
    return _to_out(db, p)
