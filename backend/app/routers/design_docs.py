"""
Router Hồ sơ thiết kế (Design Documents) — đặc thù công ty thiết kế cầu đường.
Quản lý bản vẽ/hồ sơ theo giai đoạn thiết kế + phiên bản + trạng thái duyệt.
- Xem: mọi người đăng nhập (kỹ sư cần tra bản vẽ).
- Tạo/sửa/xóa: Quản lý trở lên.
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.audit import log_activity
from app.database import get_db
from app.deps import get_current_user, require_roles
from app.models import DesignDocument, DesignPhase, DesignDocStatus, Project, User, UserRole
from app.schemas import DesignDocCreate, DesignDocOut, DesignDocUpdate

router = APIRouter(prefix="/design-docs", tags=["Hồ sơ thiết kế"])

_EDIT = require_roles(UserRole.MANAGER, UserRole.ACCOUNTANT, UserRole.DIRECTOR)


@router.get("", response_model=list[DesignDocOut])
def list_docs(
    project_id: int | None = None,
    phase: DesignPhase | None = None,
    status: DesignDocStatus | None = None,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    q = db.query(DesignDocument).filter(DesignDocument.company_id == current.company_id)
    if project_id:
        q = q.filter(DesignDocument.project_id == project_id)
    if phase:
        q = q.filter(DesignDocument.phase == phase)
    if status:
        q = q.filter(DesignDocument.status == status)
    return q.order_by(DesignDocument.project_id, DesignDocument.phase, DesignDocument.id.desc()).all()


@router.post("", response_model=DesignDocOut, status_code=201)
def create_doc(payload: DesignDocCreate, db: Session = Depends(get_db), current: User = Depends(_EDIT)):
    proj = db.get(Project, payload.project_id)
    if not proj or proj.company_id != current.company_id:
        raise HTTPException(400, "Dự án không hợp lệ.")
    doc = DesignDocument(**payload.model_dump(), company_id=current.company_id, created_by_id=current.id)
    db.add(doc)
    db.commit()
    db.refresh(doc)
    log_activity(db, current, "design.create", "design_document", doc.id, f"{doc.name} ({doc.version or ''})")
    return doc


@router.patch("/{doc_id}", response_model=DesignDocOut)
def update_doc(doc_id: int, payload: DesignDocUpdate, db: Session = Depends(get_db), current: User = Depends(_EDIT)):
    doc = db.get(DesignDocument, doc_id)
    if not doc or doc.company_id != current.company_id:
        raise HTTPException(404, "Không tìm thấy hồ sơ thiết kế.")
    old_status = doc.status
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(doc, k, v)
    db.commit()
    db.refresh(doc)
    if payload.status and payload.status != old_status:
        log_activity(db, current, f"design.{payload.status.value.lower()}", "design_document", doc.id, doc.name)
    return doc


@router.delete("/{doc_id}", status_code=204)
def delete_doc(doc_id: int, db: Session = Depends(get_db), current: User = Depends(_EDIT)):
    doc = db.get(DesignDocument, doc_id)
    if not doc or doc.company_id != current.company_id:
        raise HTTPException(404, "Không tìm thấy hồ sơ thiết kế.")
    db.delete(doc)
    db.commit()
