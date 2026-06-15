"""Router Quản lý Dự án (Projects) — CRUD, lọc theo công ty."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import Project, User
from app.schemas import ProjectCreate, ProjectOut, ProjectUpdate

router = APIRouter(prefix="/projects", tags=["Dự án"])


@router.get("", response_model=list[ProjectOut])
def list_projects(db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    return (
        db.query(Project)
        .filter(Project.company_id == current.company_id)
        .order_by(Project.created_at.desc())
        .all()
    )


@router.post("", response_model=ProjectOut, status_code=201)
def create_project(
    payload: ProjectCreate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    project = Project(**payload.model_dump(), company_id=current.company_id)
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: int, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    p = db.get(Project, project_id)
    if not p or p.company_id != current.company_id:
        raise HTTPException(404, "Không tìm thấy dự án.")
    return p


@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(
    project_id: int,
    payload: ProjectUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    p = db.get(Project, project_id)
    if not p or p.company_id != current.company_id:
        raise HTTPException(404, "Không tìm thấy dự án.")
    
    data = payload.model_dump(exclude_unset=True)
    if "member_ids" in data:
        member_ids = data.pop("member_ids")
        if member_ids is not None:
            # Query users and verify they belong to same company
            users = db.query(User).filter(User.id.in_(member_ids), User.company_id == current.company_id).all()
            p.members = users
            
    for k, v in data.items():
        setattr(p, k, v)
        
    db.commit()
    db.refresh(p)
    return p
