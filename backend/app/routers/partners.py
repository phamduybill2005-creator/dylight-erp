"""
Router Đối tác (Partners) — danh mục Chủ đầu tư / Nhà cung cấp / Nhà thầu phụ.
NHẠY CẢM: chỉ Giám đốc / Quản trị truy cập (require_roles(DIRECTOR), ADMIN auto-pass).
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_roles
from app.models import Partner, PartnerType, User, UserRole
from app.schemas import PartnerCreate, PartnerOut, PartnerUpdate

router = APIRouter(prefix="/partners", tags=["Đối tác"])

# Chỉ Giám đốc (và ADMIN) — đúng nguyên tắc "chỉ chủ & giám đốc thấy dữ liệu".
_GUARD = require_roles(UserRole.DIRECTOR)


@router.get("", response_model=list[PartnerOut])
def list_partners(
    type: PartnerType | None = None,
    db: Session = Depends(get_db),
    current: User = Depends(_GUARD),
):
    q = db.query(Partner).filter(Partner.company_id == current.company_id)
    if type:
        q = q.filter(Partner.type == type)
    return q.order_by(Partner.type, Partner.name).all()


@router.post("", response_model=PartnerOut, status_code=201)
def create_partner(
    payload: PartnerCreate,
    db: Session = Depends(get_db),
    current: User = Depends(_GUARD),
):
    p = Partner(**payload.model_dump(), company_id=current.company_id)
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


@router.patch("/{partner_id}", response_model=PartnerOut)
def update_partner(
    partner_id: int,
    payload: PartnerUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(_GUARD),
):
    p = db.get(Partner, partner_id)
    if not p or p.company_id != current.company_id:
        raise HTTPException(404, "Không tìm thấy đối tác.")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(p, k, v)
    db.commit()
    db.refresh(p)
    return p


@router.delete("/{partner_id}", status_code=204)
def delete_partner(
    partner_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(_GUARD),
):
    p = db.get(Partner, partner_id)
    if not p or p.company_id != current.company_id:
        raise HTTPException(404, "Không tìm thấy đối tác.")
    db.delete(p)
    db.commit()
