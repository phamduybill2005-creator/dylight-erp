"""
Router Giao việc — Giám đốc giao dự án cho Quản lý, Quản lý giao phần việc cho Nhân viên.
Khi tạo phân công sẽ TỰ gửi 1 thông báo cho người được giao.
Giám đốc/Quản trị thấy TOÀN BỘ phân công của công ty (mục nhân sự); quản lý thấy việc mình
giao hoặc được giao; nhân viên thấy việc được giao cho mình.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, require_roles
from app.models import Assignment, Notification, Project, User, UserRole
from app.schemas import AssignmentCreate, AssignmentUpdate, AssignmentOut

router = APIRouter(prefix="/assignments", tags=["Giao việc"])

_DIRECTORS = (UserRole.ADMIN, UserRole.DIRECTOR)


@router.get("", response_model=list[AssignmentOut])
def list_assignments(
    assignee_id: int | None = None,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    q = db.query(Assignment).filter(Assignment.company_id == current.company_id)
    if current.role in _DIRECTORS:
        pass  # Giám đốc/Quản trị: thấy toàn bộ
    elif current.role in (UserRole.MANAGER, UserRole.ACCOUNTANT):
        q = q.filter((Assignment.assigner_id == current.id) | (Assignment.assignee_id == current.id))
    else:
        q = q.filter(Assignment.assignee_id == current.id)
    if assignee_id:
        q = q.filter(Assignment.assignee_id == assignee_id)
    return q.order_by(Assignment.created_at.desc()).all()


@router.post("", response_model=AssignmentOut, status_code=201)
def create_assignment(
    payload: AssignmentCreate,
    db: Session = Depends(get_db),
    # Giám đốc & Quản lý (ADMIN luôn được) mới được giao việc.
    current: User = Depends(require_roles(UserRole.DIRECTOR, UserRole.MANAGER)),
):
    assignee = db.get(User, payload.assignee_id)
    if not assignee or assignee.company_id != current.company_id:
        raise HTTPException(400, "Người nhận việc không hợp lệ.")
    if payload.project_id is not None:
        proj = db.get(Project, payload.project_id)
        if not proj or proj.company_id != current.company_id:
            raise HTTPException(400, "Dự án không hợp lệ.")

    a = Assignment(
        company_id=current.company_id, assigner_id=current.id, assignee_id=payload.assignee_id,
        project_id=payload.project_id, title=payload.title, description=payload.description,
    )
    db.add(a)
    # Tự gửi thông báo cho người được giao việc.
    db.add(Notification(
        company_id=current.company_id, sender_id=current.id, recipient_id=assignee.id,
        title=f"Bạn được giao việc: {payload.title}", body=payload.description,
    ))
    db.commit()
    db.refresh(a)
    return a


@router.patch("/{assignment_id}", response_model=AssignmentOut)
def update_assignment(
    assignment_id: int,
    payload: AssignmentUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    a = db.get(Assignment, assignment_id)
    if not a or a.company_id != current.company_id:
        raise HTTPException(404, "Không tìm thấy phân công.")
    # Người giao, người nhận (cập nhật tiến độ) hoặc Giám đốc/Quản trị mới sửa được.
    if current.role not in _DIRECTORS and current.id not in (a.assigner_id, a.assignee_id):
        raise HTTPException(403, "Bạn không có quyền sửa phân công này.")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(a, k, v)
    db.commit()
    db.refresh(a)
    return a
