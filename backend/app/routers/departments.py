"""
Router Phòng ban (Departments) — DANH MỤC phòng ban của công ty.

- GET  : mọi người dùng đã đăng nhập (frontend cần để đổ danh sách chọn phòng).
- POST / PATCH : chỉ Admin & Giám đốc (require_roles(DIRECTOR) -> ADMIN auto-pass).

Việc gán người/hạng mục vào phòng vẫn lưu dạng CHUỖI ở users.department (nhiều
phòng ngăn bởi dấu phẩy) và project_items.department. Khi ĐỔI TÊN một phòng,
ta cascade cập nhật các chuỗi tham chiếu đó (kể cả progress_snapshots) để dữ
liệu không bị "mồ côi" tên cũ.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, require_roles
from app.models import Department, ProjectItem, User, UserRole
from app.schemas import DepartmentCreate, DepartmentOut, DepartmentUpdate

router = APIRouter(prefix="/departments", tags=["Phòng ban"])

# Chỉ Admin (auto-pass) + Giám đốc được TẠO/ĐỔI TÊN phòng ban.
_GUARD = require_roles(UserRole.DIRECTOR)


def _norm(s: str | None) -> str:
    """Chuẩn hóa để so trùng tên (bỏ khoảng trắng thừa, không phân biệt hoa/thường)."""
    return " ".join((s or "").split()).casefold()


@router.get("", response_model=list[DepartmentOut])
def list_departments(
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Danh sách phòng ban của công ty hiện tại (dùng chung Nhân sự + Hạng mục)."""
    return (
        db.query(Department)
        .filter(Department.company_id == current.company_id)
        .order_by(Department.order_index, Department.name)
        .all()
    )


@router.post("", response_model=DepartmentOut, status_code=201)
def create_department(
    payload: DepartmentCreate,
    db: Session = Depends(get_db),
    current: User = Depends(_GUARD),
):
    """Thêm phòng ban mới (kể cả phòng chưa có ai). Chống trùng tên trong công ty."""
    name = " ".join(payload.name.split())
    if not name:
        raise HTTPException(400, "Tên phòng ban không được để trống.")

    existing = (
        db.query(Department)
        .filter(Department.company_id == current.company_id)
        .all()
    )
    if any(_norm(d.name) == _norm(name) for d in existing):
        raise HTTPException(409, f'Phòng ban "{name}" đã tồn tại.')

    next_order = max((d.order_index for d in existing), default=-1) + 1
    dep = Department(company_id=current.company_id, name=name, order_index=next_order)
    db.add(dep)
    db.commit()
    db.refresh(dep)
    return dep


@router.patch("/{dept_id}", response_model=DepartmentOut)
def rename_department(
    dept_id: int,
    payload: DepartmentUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(_GUARD),
):
    """Đổi tên phòng ban + cascade cập nhật mọi nơi tham chiếu tên cũ."""
    dep = db.get(Department, dept_id)
    if not dep or dep.company_id != current.company_id:
        raise HTTPException(404, "Không tìm thấy phòng ban.")

    new_name = " ".join(payload.name.split())
    if not new_name:
        raise HTTPException(400, "Tên phòng ban không được để trống.")

    old_name = dep.name
    if _norm(new_name) == _norm(old_name):
        # Chỉ khác hoa/thường/khoảng trắng -> cập nhật nhãn, không cần cascade.
        dep.name = new_name
        db.commit()
        db.refresh(dep)
        return dep

    # Trùng với phòng khác trong công ty?
    clash = (
        db.query(Department)
        .filter(Department.company_id == current.company_id, Department.id != dept_id)
        .all()
    )
    if any(_norm(d.name) == _norm(new_name) for d in clash):
        raise HTTPException(409, f'Phòng ban "{new_name}" đã tồn tại.')

    dep.name = new_name
    _cascade_rename(db, current.company_id, old_name, new_name)
    db.commit()
    db.refresh(dep)
    return dep


def _cascade_rename(db: Session, company_id: int, old: str, new: str) -> None:
    """Thay tên phòng cũ -> mới ở mọi chỗ lưu dạng chuỗi (không mất phòng khác)."""
    # 1) users.department: chuỗi nhiều phòng ngăn bởi dấu phẩy -> thay ĐÚNG token.
    users = (
        db.query(User)
        .filter(
            User.company_id == company_id,
            User.department.isnot(None),
            User.department != "",
        )
        .all()
    )
    for u in users:
        toks = [t.strip() for t in (u.department or "").split(",") if t.strip()]
        if old not in toks:
            continue
        out: list[str] = []
        seen: set[str] = set()
        for t in toks:
            nt = new if t == old else t
            if nt not in seen:
                seen.add(nt)
                out.append(nt)
        u.department = ", ".join(out)

    # 2) project_items.department: 1 giá trị/nhóm -> thay khớp tuyệt đối.
    db.query(ProjectItem).filter(
        ProjectItem.company_id == company_id,
        ProjectItem.department == old,
    ).update({ProjectItem.department: new}, synchronize_session=False)

    # 3) progress_snapshots.department: đổi tên, tránh vi phạm UNIQUE
    #    (project_id, snap_date, department) — chỉ đổi dòng không gây trùng.
    db.execute(
        text(
            "UPDATE progress_snapshots SET department = :new "
            "WHERE company_id = :cid AND department = :old "
            "AND NOT EXISTS (SELECT 1 FROM progress_snapshots s2 "
            "WHERE s2.project_id = progress_snapshots.project_id "
            "AND s2.snap_date = progress_snapshots.snap_date "
            "AND s2.department = :new)"
        ),
        {"new": new, "old": old, "cid": company_id},
    )
