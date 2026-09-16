"""Router Thùng rác & Khôi phục (Archive / Recycle Bin).

Lưu trữ và khôi phục Dự án & Hạng mục đã xóa:
- Giám đốc / Admin / Quản lý cấp cao: thấy TẤT CẢ dự án / hạng mục đã xóa trong công ty.
- Quản lý cấp trung trở xuống: CHỈ thấy dự án / hạng mục đã xóa thuộc PHÒNG BAN của mình.

Thùng rác KHÔNG tự dọn theo thời gian (không có job xoá định kỳ) — dữ liệu nằm
đây tới khi có người bấm xoá vĩnh viễn. Xoá vĩnh viễn là KHÔNG LÙI ĐƯỢC nên chỉ
Quản trị hệ thống / Giám đốc / Quản lý cấp cao làm được (deps.is_top_leadership).
"""
from datetime import datetime
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import or_

from app.database import get_db, vn_now
from app.deps import get_current_user, is_top_leadership
from app.models import (
    Assignment, Contract, Conversation, DesignDocument, EquipmentLog, Evaluation,
    Invoice, Progress, ProgressSnapshot, Project, ProjectEvaluation, ProjectItem,
    ProjectItemRating, Timesheet, User, project_item_workers, project_members,
)
from app.routers.projects import _can_view, _can_manage, _is_director, _is_senior_manager, _is_project_in_user_depts, _to_out, ProjectOut

router = APIRouter(prefix="/archive", tags=["Thùng rác & Khôi phục"])


def _assert_can_purge(current: User) -> None:
    """Xoá vĩnh viễn = mất hẳn, không khôi phục được -> chỉ 3 cấp lãnh đạo."""
    if not is_top_leadership(current):
        raise HTTPException(
            403,
            "Chỉ Giám đốc, Quản trị hệ thống và Quản lý cấp cao mới xóa vĩnh "
            "viễn được. Bạn vẫn khôi phục dữ liệu trong thùng rác bình thường.",
        )


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


@router.delete("/purge-item/{item_id}")
def purge_item(
    item_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """XÓA VĨNH VIỄN một hạng mục trong thùng rác. Không khôi phục lại được."""
    _assert_can_purge(current)
    item = db.get(ProjectItem, item_id)
    if not item or item.company_id != current.company_id or not item.is_deleted:
        raise HTTPException(404, "Không tìm thấy hạng mục đã xóa.")

    # Nhóm cha thì cuốn theo các đầu việc con (kể cả con chưa đánh dấu xóa —
    # để cha một nơi con một nẻo thì bảng hạng mục sẽ hỏng cây 2 cấp).
    ids = [item.id]
    if item.parent_id is None:
        ids += [
            r[0] for r in db.query(ProjectItem.id).filter(
                ProjectItem.parent_id == item.id,
                ProjectItem.company_id == current.company_id,
            ).all()
        ]

    # Xóa tay từng bảng phụ thay vì trông vào ON DELETE CASCADE: SQLite không
    # bật ràng buộc khóa ngoại mặc định, làm tay thì chạy giống nhau ở mọi CSDL.
    db.query(Timesheet).filter(Timesheet.project_item_id.in_(ids)).delete(synchronize_session=False)
    db.query(ProjectItemRating).filter(
        ProjectItemRating.project_item_id.in_(ids)
    ).delete(synchronize_session=False)
    db.execute(project_item_workers.delete().where(
        project_item_workers.c.project_item_id.in_(ids)
    ))
    db.query(ProjectItem).filter(ProjectItem.id.in_(ids)).delete(synchronize_session=False)
    db.commit()
    return {"deleted_items": len(ids)}


# Bảng còn tham chiếu tới dự án mà KHÔNG khai ON DELETE -> xóa dự án sẽ vi phạm
# khóa ngoại. Chặn trước và nói rõ cái gì đang vướng, thay vì để nổ lỗi 500 hoặc
# âm thầm cuốn mất sổ sách tài chính. (nhãn hiển thị, model, cột dự án)
_PURGE_BLOCKERS = [
    ("hợp đồng", Contract, "project_id"),
    ("hóa đơn", Invoice, "project_id"),
    ("nhật ký tiến độ", Progress, "project_id"),
    ("hồ sơ thiết kế", DesignDocument, "project_id"),
    ("phân công công việc", Assignment, "project_id"),
    ("nhật ký thiết bị", EquipmentLog, "project_id"),
    ("phòng chat dự án", Conversation, "project_id"),
]


@router.delete("/purge-project/{project_id}")
def purge_project(
    project_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """XÓA VĨNH VIỄN một dự án trong thùng rác. Không khôi phục lại được.

    Từ chối nếu dự án còn hợp đồng / hóa đơn / nhật ký... để không mất sổ sách.
    """
    _assert_can_purge(current)
    p = db.get(Project, project_id)
    if not p or p.company_id != current.company_id or not p.is_deleted:
        raise HTTPException(404, "Không tìm thấy dự án đã xóa.")

    vuong = []
    for label, model, col in _PURGE_BLOCKERS:
        n = db.query(model).filter(getattr(model, col) == p.id).count()
        if n:
            vuong.append(f"{n} {label}")
    if vuong:
        raise HTTPException(
            409,
            f'Không xóa vĩnh viễn được dự án "{p.code} – {p.name}": vẫn còn '
            + ", ".join(vuong)
            + ". Hãy xóa những dữ liệu này trước, hoặc cứ để dự án trong thùng "
            "rác — thùng rác không tự xóa nên không mất gì.",
        )

    # Dữ liệu chỉ thuộc về dự án thì đi theo dự án. Xóa tay cho chắc (xem ghi
    # chú ở purge_item về ràng buộc khóa ngoại trên SQLite).
    item_ids = [r[0] for r in db.query(ProjectItem.id).filter(ProjectItem.project_id == p.id).all()]
    if item_ids:
        db.query(ProjectItemRating).filter(
            ProjectItemRating.project_item_id.in_(item_ids)
        ).delete(synchronize_session=False)
        db.execute(project_item_workers.delete().where(
            project_item_workers.c.project_item_id.in_(item_ids)
        ))
    db.query(Timesheet).filter(Timesheet.project_id == p.id).delete(synchronize_session=False)
    db.query(ProjectItem).filter(ProjectItem.project_id == p.id).delete(synchronize_session=False)
    db.query(ProgressSnapshot).filter(ProgressSnapshot.project_id == p.id).delete(synchronize_session=False)
    db.query(ProjectEvaluation).filter(ProjectEvaluation.project_id == p.id).delete(synchronize_session=False)
    db.execute(project_members.delete().where(project_members.c.project_id == p.id))
    # Đánh giá nhân sự KHÔNG xóa theo — đó là hồ sơ của con người, chỉ gỡ liên
    # kết tới dự án (đúng như ondelete="SET NULL" khai trong models.py).
    db.query(Evaluation).filter(Evaluation.project_id == p.id).update(
        {"project_id": None}, synchronize_session=False
    )

    code, name = p.code, p.name
    # Xóa bằng câu lệnh thẳng, KHÔNG dùng db.delete(p): ORM sẽ tự đi xóa lại các
    # dòng thành viên dự án (quan hệ members) vốn đã xóa tay ở trên -> lệch số
    # dòng -> StaleDataError. Mọi bảng liên quan đã dọn xong nên đi thẳng là đủ.
    db.query(Project).filter(Project.id == p.id).delete(synchronize_session=False)
    db.commit()
    return {"deleted_project": f"{code} – {name}", "deleted_items": len(item_ids)}
