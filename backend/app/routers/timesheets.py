"""
Router Timesheet — GIỜ LÀM THỰC TẾ mỗi người khai cho từng dự án theo NGÀY.

QUYỀN SỬA SỐ GIỜ (chốt với chủ doanh nghiệp):
- Giám đốc / Quản trị hệ thống / Quản lý CẤP CAO  -> sửa giờ của MỌI NGƯỜI trên
  MỌI đầu việc của dự án họ xem được (kể cả khai hộ).
- Quản lý CẤP TRUNG trở xuống (gồm nhân viên)     -> CHỈ khai/sửa giờ CỦA CHÍNH
  MÌNH, và CHỈ trên ĐẦU VIỆC ĐƯỢC GIAO cho mình (phụ trách chính hoặc nằm trong
  danh sách người cùng làm). Không đụng được vào đầu việc của người khác.

1 dòng = (người, dự án, đầu việc, ngày) -> số giờ. Ghi đè khi khai lại; 0 giờ = xóa ô.
"""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db, vn_now
from app.deps import get_current_user, is_top_leadership
from app.models import Project, ProjectItem, Timesheet, User
from app.routers.projects import _can_view
from app.schemas import TimesheetOut, TimesheetUpsert

router = APIRouter(prefix="/timesheets", tags=["Nhân công theo ngày"])


def can_edit_all_hours(user: User) -> bool:
    """True nếu người này được sửa giờ của MỌI NGƯỜI trên MỌI đầu việc.

    Đúng 3 vai trò: Quản trị hệ thống, Giám đốc, Quản lý cấp cao — xem
    deps.is_top_leadership để biết vì sao xét thẳng theo vai trò chứ không suy
    từ sơ đồ tổ chức. MANAGER_MID (cấp trung) và FIELD_STAFF thì không.

    Dùng chung cho router này và cờ can_edit_all_hours trả ở /auth/me, để giao
    diện khóa ô nhập giờ đúng y như backend chặn.
    """
    return is_top_leadership(user)


def _owns_item(user: User, item: ProjectItem) -> bool:
    """Đầu việc này CÓ PHẢI của người dùng không.

    Của mình khi: là người phụ trách chính, HOẶC nằm trong danh sách người cùng
    làm. Đầu việc CHƯA giao cho ai (không phụ trách chính và chưa có người cùng
    làm) thì còn trống — không phải đầu việc của người khác — nên thành viên dự
    án vẫn khai giờ của chính mình vào đó được.
    """
    if item.assignee_id == user.id:
        return True
    worker_ids = {w.id for w in (item.workers or [])}
    if user.id in worker_ids:
        return True
    return item.assignee_id is None and not worker_ids


def _assert_can_edit_hours(
    current: User, target_uid: int, item: ProjectItem | None
) -> None:
    """Chặn 3 việc với quản lý cấp trung trở xuống: khai hộ người khác, khai giờ
    không gắn đầu việc, và khai vào đầu việc của người khác."""
    if can_edit_all_hours(current):
        return
    if target_uid != current.id:
        raise HTTPException(
            403,
            "Bạn chỉ được khai/sửa giờ của chính mình. Sửa giờ cho người khác là "
            "quyền của Giám đốc, Quản trị hệ thống và Quản lý cấp cao.",
        )
    if item is None:
        raise HTTPException(403, "Phải chọn đầu việc trước khi khai giờ.")
    if not _owns_item(current, item):
        raise HTTPException(
            403,
            "Bạn không được giao đầu việc này nên không khai/sửa giờ ở đây được. "
            "Chỉ khai giờ ở những đầu việc của mình.",
        )


@router.get("", response_model=list[TimesheetOut])
def list_timesheets(
    from_date: date | None = None,
    to_date: date | None = None,
    user_id: int | None = None,
    project_id: int | None = None,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Danh sách giờ làm (lọc theo khoảng ngày / người / dự án).
    Trang Tiến độ giờ là chế độ chỉ đọc, mọi tài khoản đều thấy tổng hợp
    giờ từ phần Tiến độ của dự án."""
    q = db.query(Timesheet).filter(Timesheet.company_id == current.company_id)
    if user_id is not None:
        q = q.filter(Timesheet.user_id == user_id)
    if from_date:
        q = q.filter(Timesheet.work_date >= from_date)
    if to_date:
        q = q.filter(Timesheet.work_date <= to_date)
    if project_id:
        q = q.filter(Timesheet.project_id == project_id)
    return q.order_by(Timesheet.work_date, Timesheet.project_id).all()


@router.post("")
def upsert_timesheet(
    payload: TimesheetUpsert,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Khai/sửa giờ 1 ô (người, đầu việc, ngày). hours = 0 -> xóa ô.
    Chỉ Giám đốc / Quản trị hệ thống / Quản lý cấp cao khai hộ người khác được."""
    # Không cho khai giờ cho NGÀY TƯƠNG LAI (chỉ hôm nay & các ngày đã qua).
    if payload.work_date > vn_now().date():
        raise HTTPException(400, "Không thể khai giờ cho ngày trong tương lai.")
    proj = db.get(Project, payload.project_id)
    if not proj or proj.company_id != current.company_id:
        raise HTTPException(404, "Không tìm thấy dự án.")
    # Chỉ thành viên/chủ trì/giám đốc của dự án mới khai/điều chỉnh được giờ
    if not _can_view(db, proj, current):
        raise HTTPException(404, "Không tìm thấy dự án.")

    target_uid = current.id
    if payload.user_id is not None and payload.user_id != current.id:
        target = db.get(User, payload.user_id)
        if not target or target.company_id != current.company_id:
            raise HTTPException(404, "Không tìm thấy nhân sự.")
        target_uid = payload.user_id

    # Đầu việc (hạng mục) — nếu có, phải thuộc đúng dự án này.
    item_id = payload.project_item_id
    item: ProjectItem | None = None
    if item_id is not None:
        item = db.get(ProjectItem, item_id)
        if not item or item.project_id != payload.project_id:
            raise HTTPException(404, "Không tìm thấy đầu việc trong dự án.")

    # CHẶN theo cấp bậc + đầu việc được giao (xem docstring đầu file).
    _assert_can_edit_hours(current, target_uid, item)

    # Khóa 1 ô = (người, dự án, đầu việc, ngày). project_item_id NULL cần lọc riêng.
    q = (
        db.query(Timesheet)
        .filter(
            Timesheet.user_id == target_uid,
            Timesheet.project_id == payload.project_id,
            Timesheet.work_date == payload.work_date,
        )
    )
    q = q.filter(Timesheet.project_item_id == item_id) if item_id is not None \
        else q.filter(Timesheet.project_item_id.is_(None))
    rec = q.first()

    if payload.hours <= 0:
        if rec:
            db.delete(rec)
            db.commit()
        return {"deleted": True}

    if rec is None:
        rec = Timesheet(
            company_id=current.company_id, user_id=target_uid,
            project_id=payload.project_id, project_item_id=item_id,
            work_date=payload.work_date,
        )
        db.add(rec)
    rec.hours = payload.hours
    rec.note = payload.note
    db.commit()
    db.refresh(rec)
    return TimesheetOut.model_validate(rec).model_dump(mode="json")


@router.delete("/{ts_id}", status_code=204)
def delete_timesheet(
    ts_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    rec = db.get(Timesheet, ts_id)
    if not rec or rec.company_id != current.company_id:
        raise HTTPException(404, "Không tìm thấy dòng giờ làm.")
    proj = db.get(Project, rec.project_id)
    if not proj or not _can_view(db, proj, current):
        raise HTTPException(403, "Không có quyền xóa giờ trên dự án này.")
    # Cấp trung trở xuống: chỉ xóa được giờ CỦA MÌNH. Dòng giờ cũ chưa gắn đầu
    # việc (giờ lạc) vẫn tự dọn được phần của mình; giờ đã gắn đầu việc thì đầu
    # việc đó phải là của mình.
    if not can_edit_all_hours(current):
        if rec.user_id != current.id:
            raise HTTPException(403, "Bạn chỉ được xóa giờ của chính mình.")
        if rec.project_item_id is not None:
            item = db.get(ProjectItem, rec.project_item_id)
            if item is not None and not _owns_item(current, item):
                raise HTTPException(
                    403,
                    "Bạn không được giao đầu việc này nên không xóa giờ ở đây được.",
                )
    db.delete(rec)
    db.commit()
    return Response(status_code=204)


class ClearWorkerPayload(BaseModel):
    project_id: int
    user_id: int
    project_item_id: int | None = None


@router.post("/clear-worker")
def clear_worker_hours(
    payload: ClearWorkerPayload,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Xóa toàn bộ giờ của 1 nhân sự trên 1 đầu việc hoặc trên cả dự án."""
    proj = db.get(Project, payload.project_id)
    if not proj or proj.company_id != current.company_id or not _can_view(db, proj, current):
        raise HTTPException(404, "Không tìm thấy dự án.")

    item: ProjectItem | None = None
    if payload.project_item_id is not None:
        item = db.get(ProjectItem, payload.project_item_id)
        if not item or item.project_id != payload.project_id:
            raise HTTPException(404, "Không tìm thấy đầu việc trong dự án.")

    # Xóa sạch giờ cũng là SỬA SỐ -> cùng luật với khai giờ. Cấp trung trở xuống
    # chỉ xóa được giờ của mình trên đầu việc của mình, và bắt buộc chỉ rõ đầu
    # việc (không cho quét sạch cả dự án).
    _assert_can_edit_hours(current, payload.user_id, item)

    q = db.query(Timesheet).filter(
        Timesheet.company_id == current.company_id,
        Timesheet.project_id == payload.project_id,
        Timesheet.user_id == payload.user_id,
    )
    if payload.project_item_id is not None:
        q = q.filter(Timesheet.project_item_id == payload.project_item_id)
    deleted = q.delete(synchronize_session=False)
    db.commit()
    return {"deleted": deleted}
