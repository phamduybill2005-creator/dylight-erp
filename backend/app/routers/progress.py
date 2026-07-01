"""
Router Quản lý Tiến độ (Progress) — nhật ký mốc thi công theo dự án.

Quyền ghi (tạo/sửa/xóa mốc): Director/Admin, người chủ trì dự án, hoặc thành viên
của dự án. Người ngoài dự án không được đụng vào mốc tiến độ. Cô lập theo company_id.
"""
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import Progress, Project, User, UserRole, project_members
from app.schemas import ProgressCreate, ProgressOut, ProgressUpdate

router = APIRouter(prefix="/progress", tags=["Tiến độ"])


def _can_edit_project(db: Session, project: Project, user: User) -> bool:
    """Director/Admin, người chủ trì, hoặc thành viên dự án -> được sửa mốc."""
    if user.role in (UserRole.DIRECTOR, UserRole.ADMIN):
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


@router.get("", response_model=list[ProgressOut])
def list_progress(
    project_id: int | None = None,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    q = db.query(Progress).filter(Progress.company_id == current.company_id)
    if project_id:
        q = q.filter(Progress.project_id == project_id)
    # Cách ly quyền XEM: người không phải Director/Admin chỉ thấy mốc của dự án
    # mình là thành viên hoặc chủ trì (khớp danh sách dự án ở /projects).
    if current.role not in (UserRole.DIRECTOR, UserRole.ADMIN):
        member_pids = (
            db.query(project_members.c.project_id)
            .filter(project_members.c.user_id == current.id)
        )
        lead_pids = db.query(Project.id).filter(Project.lead_id == current.id)
        q = q.filter(
            (Progress.project_id.in_(member_pids)) | (Progress.project_id.in_(lead_pids))
        )
    return q.order_by(Progress.planned_date.asc().nullslast()).all()


@router.post("", response_model=ProgressOut, status_code=201)
def create_progress(
    payload: ProgressCreate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    project = db.get(Project, payload.project_id)
    if not project or project.company_id != current.company_id:
        raise HTTPException(400, "Dự án không hợp lệ.")
    if not _can_edit_project(db, project, current):
        raise HTTPException(403, "Bạn không có quyền cập nhật tiến độ dự án này.")
    item = Progress(**payload.model_dump(), company_id=current.company_id)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.patch("/{progress_id}", response_model=ProgressOut)
def update_progress(
    progress_id: int,
    payload: ProgressUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    item = db.get(Progress, progress_id)
    if not item or item.company_id != current.company_id:
        raise HTTPException(404, "Không tìm thấy mốc tiến độ.")
    project = db.get(Project, item.project_id)
    if not project or not _can_edit_project(db, project, current):
        raise HTTPException(403, "Bạn không có quyền cập nhật tiến độ dự án này.")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(item, k, v)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{progress_id}", status_code=204)
def delete_progress(
    progress_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    item = db.get(Progress, progress_id)
    if not item or item.company_id != current.company_id:
        raise HTTPException(404, "Không tìm thấy mốc tiến độ.")
    project = db.get(Project, item.project_id)
    if not project or not _can_edit_project(db, project, current):
        raise HTTPException(403, "Bạn không có quyền xóa mốc tiến độ dự án này.")
    db.delete(item)
    db.commit()
    return Response(status_code=204)
