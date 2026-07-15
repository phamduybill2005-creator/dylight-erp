"""Router Hạng mục dự toán (Project Items / BOQ).

Bảng khối lượng chi tiết theo dự án, mô hình 2 cấp: nhóm cha (parent_id = NULL)
chứa các đầu việc con. Cho phép thêm/sửa/xoá từng ô kiểu Excel.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, can_see_money
from app.models import ProjectItem, Project, User
from app.routers.projects import _can_view, _can_manage
from app.schemas import ProjectItemCreate, ProjectItemUpdate, ProjectItemOut

router = APIRouter(prefix="/project-items", tags=["Hạng mục dự toán"])


def _assert_project(db: Session, current: User, project_id: int) -> Project:
    project = db.get(Project, project_id)
    if not project or project.company_id != current.company_id:
        raise HTTPException(400, "Dự án không hợp lệ.")
    return project


def _assert_member(db: Session, current: User, project_id: int) -> Project:
    """Cùng công ty + là THÀNH VIÊN/chủ trì/giám đốc của dự án mới được đụng BOQ.
    404 (không phải 403) để không lộ dự án của người khác."""
    project = _assert_project(db, current, project_id)
    if not _can_view(db, project, current):
        raise HTTPException(404, "Không tìm thấy dự án.")
    return project


def _strip_money_if_needed(data: dict, current: User) -> dict:
    """Không được thấy tiền -> không được GHI đơn giá/khối lượng (chỉ Giám đốc đặt tiền)."""
    if not can_see_money(current):
        data.pop("unit_price", None)
        data.pop("quantity", None)
    return data


def _out(item: ProjectItem, current: User) -> ProjectItemOut:
    """Chuyển sang schema, ẩn Khối lượng/Đơn giá/Thành tiền nếu người xem không được thấy tiền.
    Mask trên bản Pydantic (model_copy) — TUYỆT ĐỐI không set None lên ORM."""
    out = ProjectItemOut.model_validate(item)
    if not can_see_money(current):
        out = out.model_copy(update={"quantity": None, "unit_price": None, "amount": None})
    return out


def _validate_assignee(db: Session, project: Project, assignee_id: int | None) -> None:
    """Người được giao (nếu có) phải cùng công ty VÀ là thành viên/chủ trì dự án
    (giao cho người ngoài dự án thì họ không vào xem/khai giờ được). None = bỏ giao."""
    if assignee_id is None:
        return
    u = db.get(User, assignee_id)
    if not u or u.company_id != project.company_id:
        raise HTTPException(400, "Người được giao không hợp lệ.")
    if not _can_view(db, project, u):
        raise HTTPException(400, "Người được giao phải là thành viên của dự án.")


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
    _assert_member(db, current, project_id)   # chỉ thành viên dự án mới xem được BOQ
    rows = (
        db.query(ProjectItem)
        .filter(
            ProjectItem.company_id == current.company_id,
            ProjectItem.project_id == project_id,
        )
        .order_by(ProjectItem.order_index.asc(), ProjectItem.id.asc())
        .all()
    )
    # CHỈ GIÁM ĐỐC thấy tiền: giữ tên/ĐVT hạng mục nhưng ẩn Khối lượng/Đơn giá/Thành tiền
    # với mọi người khác (quản lý cấp cao/cấp trung + nhân viên).
    return [_out(r, current) for r in rows]


@router.post("", response_model=ProjectItemOut, status_code=201)
def create_item(
    payload: ProjectItemCreate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Thêm một nhóm cha (parent_id=null) hoặc một đầu việc con (parent_id=<nhóm>)."""
    project = _assert_member(db, current, payload.project_id)   # chặn IDOR: chỉ thành viên dự án
    _validate_parent(db, current, payload.project_id, payload.parent_id)
    # Giao việc (đặt người phụ trách) chỉ dành cho chủ trì/giám đốc.
    if payload.assignee_id is not None and not _can_manage(db, project, current):
        raise HTTPException(403, "Chỉ chủ trì/giám đốc được giao việc cho người khác.")
    _validate_assignee(db, project, payload.assignee_id)

    data = _strip_money_if_needed(payload.model_dump(), current)  # non-director không đặt được tiền
    item = ProjectItem(**data, company_id=current.company_id)
    db.add(item)
    db.commit()
    db.refresh(item)
    return _out(item, current)


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
    project = _assert_member(db, current, item.project_id)   # chặn IDOR: chỉ thành viên dự án

    data = _strip_money_if_needed(payload.model_dump(exclude_unset=True), current)
    # Nếu client đổi parent_id thì phải kiểm tra như khi tạo (cùng công ty/dự án, 2 cấp).
    if "parent_id" in data:
        _validate_parent(db, current, item.project_id, data["parent_id"], self_id=item.id)
    # GIAO / đổi người phụ trách: chỉ chủ trì/giám đốc (khớp với UI ẩn ô chọn với nhân viên).
    if "assignee_id" in data:
        if not _can_manage(db, project, current):
            raise HTTPException(403, "Chỉ chủ trì/giám đốc được giao việc cho người khác.")
        _validate_assignee(db, project, data["assignee_id"])

    for k, v in data.items():
        setattr(item, k, v)

    db.commit()
    db.refresh(item)

    # Đổi % -> chụp điểm tiến độ HÔM NAY (dựng đường tiến độ theo ngày).
    # Lỗi phụ không được làm hỏng thao tác lưu chính.
    if "progress" in data:
        try:
            from app.services.progress_snapshot import snapshot_project
            snapshot_project(db, item.project_id, current.company_id)
        except Exception:  # noqa: BLE001
            db.rollback()

    return _out(item, current)


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
    _assert_member(db, current, item.project_id)   # chặn IDOR: chỉ thành viên dự án

    if item.parent_id is None:
        db.query(ProjectItem).filter(
            ProjectItem.parent_id == item.id,
            ProjectItem.company_id == current.company_id,
        ).delete(synchronize_session=False)
    db.delete(item)
    db.commit()
    return None
