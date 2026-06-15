"""Router Hạng mục dự toán (Project Items / BOQ).

Bảng khối lượng chi tiết theo dự án, mô hình 2 cấp: nhóm cha (parent_id = NULL)
chứa các đầu việc con. Cho phép thêm/sửa/xoá từng ô kiểu Excel.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import ProjectItem, Project, User
from app.schemas import ProjectItemCreate, ProjectItemUpdate, ProjectItemOut

router = APIRouter(prefix="/project-items", tags=["Hạng mục dự toán"])


def _assert_project(db: Session, current: User, project_id: int) -> Project:
    project = db.get(Project, project_id)
    if not project or project.company_id != current.company_id:
        raise HTTPException(400, "Dự án không hợp lệ.")
    return project


def _validate_parent(
    db: Session, current: User, project_id: int, parent_id: int | None, self_id: int | None = None
) -> None:
    """Nhóm cha phải: cùng công ty, cùng dự án, là nhóm gốc (2 cấp), và không phải chính nó."""
    if parent_id is None:
        return
    if self_id is not None and parent_id == self_id:
        raise HTTPException(400, "Hạng mục không thể là cha của chính nó.")
    parent = db.get(ProjectItem, parent_id)
    if (
        not parent
        or parent.company_id != current.company_id
        or parent.project_id != project_id
    ):
        raise HTTPException(400, "Nhóm hạng mục cha không hợp lệ.")
    if parent.parent_id is not None:
        raise HTTPException(400, "Chỉ hỗ trợ 2 cấp: nhóm cha và đầu việc con.")


@router.get("", response_model=list[ProjectItemOut])
def list_items(
    project_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Liệt kê toàn bộ hạng mục của một dự án (dạng phẳng, đã sắp thứ tự)."""
    _assert_project(db, current, project_id)
    return (
        db.query(ProjectItem)
        .filter(
            ProjectItem.company_id == current.company_id,
            ProjectItem.project_id == project_id,
        )
        .order_by(ProjectItem.order_index.asc(), ProjectItem.id.asc())
        .all()
    )


@router.post("", response_model=ProjectItemOut, status_code=201)
def create_item(
    payload: ProjectItemCreate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Thêm một nhóm cha (parent_id=null) hoặc một đầu việc con (parent_id=<nhóm>)."""
    _assert_project(db, current, payload.project_id)
    _validate_parent(db, current, payload.project_id, payload.parent_id)

    item = ProjectItem(**payload.model_dump(), company_id=current.company_id)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.patch("/{item_id}", response_model=ProjectItemOut)
def update_item(
    item_id: int,
    payload: ProjectItemUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Cập nhật một ô/hạng mục (chỉ field được gửi lên mới đổi)."""
    item = db.get(ProjectItem, item_id)
    if not item or item.company_id != current.company_id:
        raise HTTPException(404, "Không tìm thấy hạng mục.")

    data = payload.model_dump(exclude_unset=True)
    # Nếu client đổi parent_id thì phải kiểm tra như khi tạo (cùng công ty/dự án, 2 cấp).
    if "parent_id" in data:
        _validate_parent(db, current, item.project_id, data["parent_id"], self_id=item.id)

    for k, v in data.items():
        setattr(item, k, v)

    db.commit()
    db.refresh(item)
    return item


@router.delete("/{item_id}", status_code=204)
def delete_item(
    item_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Xoá hạng mục. Nếu là nhóm cha thì xoá luôn các đầu việc con."""
    item = db.get(ProjectItem, item_id)
    if not item or item.company_id != current.company_id:
        raise HTTPException(404, "Không tìm thấy hạng mục.")

    if item.parent_id is None:
        db.query(ProjectItem).filter(
            ProjectItem.parent_id == item.id,
            ProjectItem.company_id == current.company_id,
        ).delete(synchronize_session=False)
    db.delete(item)
    db.commit()
    return None
