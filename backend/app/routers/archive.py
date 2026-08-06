"""Router Thùng rác & Khôi phục (Archive / Recycle Bin).

Lưu trữ và khôi phục Dự án & Hạng mục đã xóa:
- Giám đốc / Admin / Quản lý cấp cao: thấy TẤT CẢ dự án / hạng mục đã xóa trong công ty.
- Quản lý cấp trung trở xuống: CHỈ thấy dự án / hạng mục đã xóa thuộc PHÒNG BAN của mình.
"""
from datetime import datetime
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import or_

from app.database import get_db, vn_now
from app.deps import get_current_user
from app.models import Project, ProjectItem, User
from app.routers.projects import _can_view, _can_manage, _is_director, _is_senior_manager, _is_project_in_user_depts, _to_out, ProjectOut

router = APIRouter(prefix="/archive", tags=["Thùng rác & Khôi phục"])


class DeletedProjectOut(BaseModel):
    id: int
    code: str
    name: str
    group_name: str | None = None
    geo_manager: str | None = None
    dosco_manager: str | None = None
    deleted_at: datetime | None = None
    deleted_by_name: str | None = None

    class Config:
        from_attributes = True


class DeletedItemOut(BaseModel):
    id: int
    project_id: int
    project_code: str | None = None
    project_name: str | None = None
    code: str | None = None
    name: str
    department: str | None = None
    unit: str | None = None
    parent_id: int | None = None
    deleted_at: datetime | None = None
    deleted_by_name: str | None = None

    class Config:
        from_attributes = True


@router.get("/deleted-projects", response_model=list[DeletedProjectOut])
def list_deleted_projects(
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Liệt kê dự án đã xóa (Thùng rác dự án). Lọc theo phòng ban nếu là quản lý cấp trung."""
    q = db.query(Project).filter(
        Project.company_id == current.company_id,
        Project.is_deleted == True,
    ).order_by(Project.deleted_at.desc(), Project.id.desc()).all()

    if not (_is_director(current) or _is_senior_manager(db, current)):
        q = [p for p in q if _is_project_in_user_depts(db, p, current)]

    out = []
    for p in q:
        deleted_by_user = db.get(User, p.deleted_by_id) if p.deleted_by_id else None
        out.append(
            DeletedProjectOut(
                id=p.id,
                code=p.code,
                name=p.name,
                group_name=p.group_name,
                geo_manager=p.geo_manager,
                dosco_manager=p.dosco_manager,
                deleted_at=p.deleted_at,
                deleted_by_name=deleted_by_user.full_name if deleted_by_user else None,
            )
        )
    return out


@router.post("/restore-project/{project_id}", response_model=ProjectOut)
def restore_project(
    project_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Khôi phục dự án đã xóa (và khôi phục các hạng mục thuộc dự án đó)."""
    p = db.get(Project, project_id)
    if not p or p.company_id != current.company_id or not p.is_deleted:
        raise HTTPException(404, "Không tìm thấy dự án đã xóa.")

    if not _can_manage(db, p, current) and not (_is_director(current) or _is_senior_manager(db, current)):
        raise HTTPException(403, "Bạn không có quyền khôi phục dự án này.")

    p.is_deleted = False
    p.deleted_at = None
    p.deleted_by_id = None

    # Khôi phục các hạng mục thuộc dự án này
    db.query(ProjectItem).filter(ProjectItem.project_id == p.id).update(
        {"is_deleted": False, "deleted_at": None, "deleted_by_id": None},
        synchronize_session=False,
    )
    db.commit()
    db.refresh(p)
    return _to_out(db, p)


@router.get("/deleted-items", response_model=list[DeletedItemOut])
def list_deleted_items(
    project_id: int | None = None,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Liệt kê các hạng mục đã xóa (Thùng rác hạng mục). Lọc theo phòng ban đối với cấp trung."""
    q = db.query(ProjectItem).filter(
        ProjectItem.company_id == current.company_id,
        ProjectItem.is_deleted == True,
    )
    if project_id is not None:
        q = q.filter(ProjectItem.project_id == project_id)

    items = q.order_by(ProjectItem.deleted_at.desc(), ProjectItem.id.desc()).all()

    # Lọc theo quyền phòng ban
    is_senior = _is_director(current) or _is_senior_manager(db, current)
    out = []
    for item in items:
        proj = db.get(Project, item.project_id)
        if not proj:
            continue
        if not is_senior and not _is_project_in_user_depts(db, proj, current):
            continue

        deleted_by_user = db.get(User, item.deleted_by_id) if item.deleted_by_id else None
        out.append(
            DeletedItemOut(
                id=item.id,
                project_id=item.project_id,
                project_code=proj.code if proj else None,
                project_name=proj.name if proj else None,
                code=item.code,
                name=item.name,
                department=item.department,
                unit=item.unit,
                parent_id=item.parent_id,
                deleted_at=item.deleted_at,
                deleted_by_name=deleted_by_user.full_name if deleted_by_user else None,
            )
        )
    return out


@router.post("/restore-item/{item_id}")
def restore_item(
    item_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Khôi phục hạng mục đã xóa (nếu là hạng mục con thì tự khôi phục cả hạng mục cha nếu cha bị xóa)."""
    item = db.get(ProjectItem, item_id)
    if not item or item.company_id != current.company_id or not item.is_deleted:
        raise HTTPException(404, "Không tìm thấy hạng mục đã xóa.")

    proj = db.get(Project, item.project_id)
    if not proj or not _can_view(db, proj, current):
        raise HTTPException(403, "Bạn không có quyền khôi phục hạng mục này.")

    item.is_deleted = False
    item.deleted_at = None
    item.deleted_by_id = None

    # Nếu dự án bị đánh dấu xóa -> tự khôi phục cả dự án
    if proj.is_deleted:
        proj.is_deleted = False
        proj.deleted_at = None
        proj.deleted_by_id = None

    # Nếu là hạng mục con và hạng mục cha đang bị xóa -> tự khôi phục hạng mục cha
    if item.parent_id is not None:
        parent = db.get(ProjectItem, item.parent_id)
        if parent and parent.is_deleted:
            parent.is_deleted = False
            parent.deleted_at = None
            parent.deleted_by_id = None

    # Nếu là nhóm cha -> khôi phục các đầu việc con trực thuộc
    if item.parent_id is None:
        db.query(ProjectItem).filter(
            ProjectItem.parent_id == item.id,
            ProjectItem.company_id == current.company_id,
        ).update(
            {"is_deleted": False, "deleted_at": None, "deleted_by_id": None},
            synchronize_session=False,
        )

    db.commit()
    return {"message": "Khôi phục hạng mục thành công."}
