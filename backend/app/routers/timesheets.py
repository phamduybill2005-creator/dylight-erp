"""
Router Timesheet — GIỜ LÀM THỰC TẾ mỗi người khai cho từng dự án theo NGÀY.

- Nhân viên: chỉ khai & xem GIỜ CỦA MÌNH.
- Quản lý/Kế toán/Giám đốc: xem giờ MỌI NGƯỜI (để tổng hợp Dự án × Ngày, kiểm soát
  dự án từng ngày) và có thể khai hộ (user_id trong payload).

1 dòng = (người, dự án, ngày) -> số giờ. Ghi đè khi khai lại; khai 0 giờ = xóa ô.
"""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, is_staff_tier
from app.models import Project, ProjectItem, Timesheet, User
from app.schemas import TimesheetOut, TimesheetUpsert

router = APIRouter(prefix="/timesheets", tags=["Nhân công theo ngày"])


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
    Nhân viên chỉ thấy giờ của mình; Quản lý+ thấy mọi người (hoặc lọc 1 người)."""
    q = db.query(Timesheet).filter(Timesheet.company_id == current.company_id)
    if is_staff_tier(current):
        q = q.filter(Timesheet.user_id == current.id)   # nhân viên: chỉ của mình
    elif user_id is not None:
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
    """Khai/sửa giờ 1 ô (người, dự án, ngày). hours = 0 -> xóa ô.
    Quản lý+ có thể khai hộ người khác (payload.user_id)."""
    target_uid = current.id
    if payload.user_id is not None and payload.user_id != current.id:
        if is_staff_tier(current):
            raise HTTPException(403, "Bạn chỉ được khai giờ của chính mình.")
        target = db.get(User, payload.user_id)
        if not target or target.company_id != current.company_id:
            raise HTTPException(404, "Không tìm thấy nhân sự.")
        target_uid = payload.user_id

    proj = db.get(Project, payload.project_id)
    if not proj or proj.company_id != current.company_id:
        raise HTTPException(404, "Không tìm thấy dự án.")

    # Đầu việc (hạng mục) — nếu có, phải thuộc đúng dự án này.
    item_id = payload.project_item_id
    if item_id is not None:
        item = db.get(ProjectItem, item_id)
        if not item or item.project_id != payload.project_id:
            raise HTTPException(404, "Không tìm thấy đầu việc trong dự án.")

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
    if rec.user_id != current.id and is_staff_tier(current):
        raise HTTPException(403, "Bạn chỉ được xóa giờ của chính mình.")
    db.delete(rec)
    db.commit()
    return Response(status_code=204)
