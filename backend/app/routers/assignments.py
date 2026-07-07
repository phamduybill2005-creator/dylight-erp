"""
Router Giao việc — Giám đốc giao dự án cho Quản lý, Quản lý giao phần việc cho Nhân viên.
Khi tạo phân công sẽ TỰ gửi 1 thông báo cho người được giao.
Giám đốc/Quản trị thấy TOÀN BỘ phân công của công ty (mục nhân sự); quản lý thấy việc mình
giao hoặc được giao; nhân viên thấy việc được giao cho mình.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db, vn_now
from app.deps import get_current_user
from app.models import Assignment, Notification, Project, User, UserRole
from app.routers.projects import _can_view   # dùng chung quy tắc "được xem dự án"
from app.schemas import AssignmentCreate, AssignmentUpdate, AssignmentOut

router = APIRouter(prefix="/assignments", tags=["Giao việc"])

_DIRECTORS = (UserRole.ADMIN, UserRole.DIRECTOR)
_ASSIGNERS = (UserRole.ADMIN, UserRole.DIRECTOR, UserRole.MANAGER)


@router.get("", response_model=list[AssignmentOut])
def list_assignments(
    assignee_id: int | None = None,
    project_id: int | None = None,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    q = db.query(Assignment).filter(Assignment.company_id == current.company_id)

    if project_id is not None:
        # Xem theo DỰ ÁN: ai được xem dự án (Giám đốc/chủ trì/thành viên) thì thấy
        # việc của MỌI người trong dự án -> bỏ lọc theo vai trò (đã gác quyền bằng _can_view).
        proj = db.get(Project, project_id)
        if not proj or proj.company_id != current.company_id:
            raise HTTPException(404, "Không tìm thấy dự án.")
        if not _can_view(db, proj, current):
            raise HTTPException(403, "Bạn không có quyền xem dự án này.")
        q = q.filter(Assignment.project_id == project_id)
    else:
        # Không lọc dự án: giữ phạm vi theo vai trò như cũ.
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
    current: User = Depends(get_current_user),
):
    assignee = db.get(User, payload.assignee_id)
    if not assignee or assignee.company_id != current.company_id:
        raise HTTPException(400, "Người nhận việc không hợp lệ.")
    # Quyền giao việc: Giám đốc/Quản trị/Quản lý; HOẶC người CHỦ TRÌ của dự án được gắn
    # (chỉ huy trưởng tự điều phối đội mình — khớp nút "Giao việc" hiện cho lead ở FE).
    is_lead = False
    if payload.project_id is not None:
        proj = db.get(Project, payload.project_id)
        if not proj or proj.company_id != current.company_id:
            raise HTTPException(400, "Dự án không hợp lệ.")
        is_lead = proj.lead_id == current.id
    if current.role not in _ASSIGNERS and not is_lead:
        raise HTTPException(403, "Bạn không có quyền giao việc.")

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
    # Người giao, người nhận (cập nhật tiến độ), Giám đốc/Quản trị, HOẶC người chủ trì
    # dự án của phân công (để lead đổi trạng thái việc trong dự án mình) mới sửa được.
    allowed = current.role in _DIRECTORS or current.id in (a.assigner_id, a.assignee_id)
    if not allowed and a.project_id is not None:
        proj = db.get(Project, a.project_id)
        if proj and proj.company_id == current.company_id and proj.lead_id == current.id:
            allowed = True
    if not allowed:
        raise HTTPException(403, "Bạn không có quyền sửa phân công này.")

    data = payload.model_dump(exclude_unset=True)
    old_status = a.status
    new_status = data.get("status", old_status)

    for k, v in data.items():
        setattr(a, k, v)

    # TỰ đóng dấu thời gian theo trạng thái (chỉ khi status THAY ĐỔI) -> đo "làm bao lâu".
    if new_status != old_status:
        if new_status == "IN_PROGRESS" and a.started_at is None:
            a.started_at = vn_now()
        elif new_status == "DONE":
            if a.started_at is None:
                a.started_at = vn_now()   # giao xong làm luôn, chưa bấm "đang làm"
            a.done_at = vn_now()
        elif old_status == "DONE" and new_status != "DONE":
            a.done_at = None              # mở lại việc -> xoá mốc hoàn thành (giữ mốc bắt đầu)

    db.commit()
    db.refresh(a)
    return a
