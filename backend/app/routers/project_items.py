"""Router Hạng mục dự toán (Project Items / BOQ).

Bảng khối lượng chi tiết theo dự án, mô hình 2 cấp: nhóm cha (parent_id = NULL)
chứa các đầu việc con. Cho phép thêm/sửa/xoá từng ô kiểu Excel.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db, vn_now
from app.deps import get_current_user, can_see_money
from app.models import ProjectItem, Project, User, ProjectItemRating, project_members
from app.routers.projects import _can_view, _can_manage
from app.schemas import ProjectItemCreate, ProjectItemUpdate, ProjectItemOut, ProjectItemRatingOut, ProjectItemRatingUpsert

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
    """Người được giao (nếu có) phải cùng công ty. Nếu chưa phải thành viên dự án thì
    TỰ THÊM vào — giao việc ở tab Hạng mục là phải thấy họ ở tab Phân công (trước đây
    gán xong mà Phân công vẫn trống). None = bỏ giao."""
    if assignee_id is None:
        return
    u = db.get(User, assignee_id)
    if not u or u.company_id != project.company_id:
        raise HTTPException(400, "Người được giao không hợp lệ.")
    already = (
        db.query(project_members)
        .filter(
            project_members.c.project_id == project.id,
            project_members.c.user_id == u.id,
        )
        .first()
    )
    if not already:
        db.execute(project_members.insert().values(project_id=project.id, user_id=u.id))
        db.flush()


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
    _assert_project(db, current, project_id)   # XEM: mọi người cùng công ty đều xem được BOQ
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
    # Đánh dấu HOÀN THÀNH (done_date): CHỈ người ĐƯỢC GIAO đầu việc mới tích được.
    if "done_date" in data and item.assignee_id != current.id:
        raise HTTPException(403, "Chỉ người được giao đầu việc mới đánh dấu hoàn thành.")

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


@router.get("/ratings/all", response_model=list[ProjectItemRatingOut])
def list_project_item_ratings(
    project_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Liệt kê toàn bộ đánh giá/tích của nhân sự trên từng đầu việc trong dự án."""
    _assert_project(db, current, project_id)   # XEM: mọi người cùng công ty đều xem được
    return (
        db.query(ProjectItemRating)
        .join(ProjectItem)
        .filter(
            ProjectItem.project_id == project_id,
            ProjectItemRating.company_id == current.company_id,
        )
        .all()
    )


@router.post("/ratings", response_model=ProjectItemRatingOut)
def upsert_project_item_rating(
    payload: ProjectItemRatingUpsert,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Lưu hoặc cập nhật đánh giá của một nhân sự trên một đầu việc (chỉ quản lý được chấm)."""
    item = db.get(ProjectItem, payload.project_item_id)
    if not item or item.company_id != current.company_id:
        raise HTTPException(404, "Không tìm thấy đầu việc.")
    
    project = db.get(Project, item.project_id)
    # Phải là NGƯỜI TRONG DỰ ÁN mới thao tác (người ngoài chỉ được XEM, không tích).
    if not project or not _can_view(db, project, current):
        raise HTTPException(404, "Không tìm thấy đầu việc trong dự án của bạn.")
    # "Đã xong" của TỪNG NGƯỜI: CHÍNH người đó tự tích (hoặc quản lý/chủ trì thao tác hộ).
    if not (_can_manage(db, project, current) or current.id == payload.user_id):
        raise HTTPException(403, "Chỉ người đó (hoặc quản lý) mới đánh dấu được.")

    rating_rec = (
        db.query(ProjectItemRating)
        .filter(
            ProjectItemRating.project_item_id == payload.project_item_id,
            ProjectItemRating.user_id == payload.user_id,
            ProjectItemRating.company_id == current.company_id,
        )
        .first()
    )
    if not rating_rec:
        rating_rec = ProjectItemRating(
            company_id=current.company_id,
            project_item_id=payload.project_item_id,
            user_id=payload.user_id,
            rating=payload.rating,
        )
        db.add(rating_rec)
    else:
        rating_rec.rating = payload.rating

    db.commit()
    db.refresh(rating_rec)

    # LIÊN KẾT tab Tiến độ <-> Hạng mục: khi NGƯỜI ĐƯỢC GIAO tích "xong" phần của mình
    # -> đặt done_date cho đầu việc, để thanh "N/M" + trạng thái (Đúng hạn/Trễ) ở tab Hạng
    # mục tự chạy theo. Đầu việc CHƯA giao -> "xong" khi có ÍT NHẤT 1 người tích. Chỉ đối
    # chiếu khi cú tích này thuộc người được giao (hoặc đầu việc chưa giao) để không đè nhau.
    responsible_id = item.assignee_id
    if responsible_id is None or payload.user_id == responsible_id:
        if responsible_id is not None:
            done = bool(payload.rating and payload.rating > 0)
        else:
            done = db.query(ProjectItemRating).filter(
                ProjectItemRating.project_item_id == item.id,
                ProjectItemRating.rating > 0,
            ).first() is not None
        changed = False
        if done and item.done_date is None:
            item.done_date = vn_now().date()
            item.progress = 100
            changed = True
        elif not done and item.done_date is not None:
            item.done_date = None
            item.progress = 0
            changed = True
        if changed:
            db.commit()
            try:
                from app.services.progress_snapshot import snapshot_project
                snapshot_project(db, item.project_id, current.company_id)
            except Exception:  # noqa: BLE001
                db.rollback()

    return rating_rec


@router.post("/copy-template")
def copy_from_template(
    target_project_id: int,
    template_project_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Sao chép toàn bộ nhóm hạng mục và đầu việc con từ dự án mẫu sang dự án đích."""
    target_project = db.get(Project, target_project_id)
    if not target_project or target_project.company_id != current.company_id:
        raise HTTPException(400, "Dự án đích không hợp lệ.")
    
    if not _can_manage(db, target_project, current) and not _is_manager_tier(db, current):
        raise HTTPException(403, "Bạn không có quyền chỉnh sửa dự án này.")
        
    template_project = db.get(Project, template_project_id)
    if not template_project or template_project.company_id != current.company_id:
        raise HTTPException(400, "Dự án mẫu không hợp lệ.")
        
    template_items = db.query(ProjectItem).filter(ProjectItem.project_id == template_project_id).all()
    
    parents = [item for item in template_items if item.parent_id is None]
    children = [item for item in template_items if item.parent_id is not None]
    
    parent_map = {}
    
    for p in parents:
        new_p = ProjectItem(
            company_id=current.company_id,
            project_id=target_project_id,
            parent_id=None,
            order_index=p.order_index,
            code=p.code,
            name=p.name,
            unit=p.unit,
            quantity=p.quantity,
            unit_price=p.unit_price,
            progress=0,
            rating=0,
            department=p.department,
            note=p.note,
            due_date=None,
            done_date=None,
        )
        db.add(new_p)
        db.flush()
        parent_map[p.id] = new_p.id
        
    for c in children:
        new_parent_id = parent_map.get(c.parent_id)
        if new_parent_id:
            assignee_id = None
            if c.assignee_id:
                assignee_user = db.get(User, c.assignee_id)
                if assignee_user and _can_view(db, target_project, assignee_user):
                    assignee_id = c.assignee_id
                    
            new_c = ProjectItem(
                company_id=current.company_id,
                project_id=target_project_id,
                parent_id=new_parent_id,
                order_index=c.order_index,
                code=c.code,
                name=c.name,
                unit=c.unit,
                quantity=c.quantity,
                unit_price=c.unit_price,
                progress=0,
                rating=0,
                department=c.department,
                assignee_id=assignee_id,
                note=c.note,
                due_date=None,
                done_date=None,
            )
            db.add(new_c)
            
    db.commit()
    return {"message": "Sao chép hạng mục thành công."}


