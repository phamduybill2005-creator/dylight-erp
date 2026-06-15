"""Router Quản lý Tiến độ (Progress) — nhật ký mốc thi công theo dự án."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import Progress, Project, User
from app.schemas import ProgressCreate, ProgressOut

router = APIRouter(prefix="/progress", tags=["Tiến độ"])


@router.get("", response_model=list[ProgressOut])
def list_progress(
    project_id: int | None = None,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    q = db.query(Progress).filter(Progress.company_id == current.company_id)
    if project_id:
        q = q.filter(Progress.project_id == project_id)
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
    item = Progress(**payload.model_dump(), company_id=current.company_id)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item
