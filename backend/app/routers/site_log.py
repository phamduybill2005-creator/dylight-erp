"""
Router Nhật ký thi công (Daily Log) — ghi nhật ký công trình hàng ngày (NĐ 06/2021).
Quyền: Quản lý trở lên (tạo & xem).
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_roles
from app.models import DailyLog, Project, User, UserRole
from app.schemas import DailyLogCreate, DailyLogOut

router = APIRouter(prefix="/site-log", tags=["Nhật ký thi công"])

_GUARD = require_roles(UserRole.MANAGER, UserRole.ACCOUNTANT, UserRole.DIRECTOR)


@router.get("", response_model=list[DailyLogOut])
def list_logs(
    project_id: int | None = None,
    db: Session = Depends(get_db),
    current: User = Depends(_GUARD),
):
    q = db.query(DailyLog).filter(DailyLog.company_id == current.company_id)
    if project_id:
        q = q.filter(DailyLog.project_id == project_id)
    return q.order_by(DailyLog.log_date.desc()).all()


@router.post("", response_model=DailyLogOut, status_code=201)
def create_log(payload: DailyLogCreate, db: Session = Depends(get_db), current: User = Depends(_GUARD)):
    proj = db.get(Project, payload.project_id)
    if not proj or proj.company_id != current.company_id:
        raise HTTPException(400, "Dự án không hợp lệ.")
    rec = DailyLog(**payload.model_dump(), company_id=current.company_id, created_by_id=current.id)
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return rec
