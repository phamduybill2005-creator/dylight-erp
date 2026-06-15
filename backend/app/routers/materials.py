"""
Router Vật tư & Kho (Materials) — danh mục vật tư + phiếu nhập/xuất theo công trình.
Cập nhật tồn kho (stock_qty) khi nhập (IN) / xuất (OUT). Quyền: Quản lý trở lên.
"""
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.audit import log_activity
from app.database import get_db
from app.deps import require_roles
from app.models import Material, StockMovement, StockMovementType, User, UserRole
from app.schemas import (
    MaterialCreate, MaterialOut, MaterialUpdate, StockMovementCreate, StockMovementOut,
)

router = APIRouter(prefix="/materials", tags=["Vật tư & Kho"])

_GUARD = require_roles(UserRole.MANAGER, UserRole.ACCOUNTANT, UserRole.DIRECTOR)


@router.get("", response_model=list[MaterialOut])
def list_materials(db: Session = Depends(get_db), current: User = Depends(_GUARD)):
    return (
        db.query(Material)
        .filter(Material.company_id == current.company_id)
        .order_by(Material.name)
        .all()
    )


@router.post("", response_model=MaterialOut, status_code=201)
def create_material(payload: MaterialCreate, db: Session = Depends(get_db), current: User = Depends(_GUARD)):
    m = Material(**payload.model_dump(), company_id=current.company_id)
    db.add(m)
    db.commit()
    db.refresh(m)
    return m


@router.patch("/{material_id}", response_model=MaterialOut)
def update_material(material_id: int, payload: MaterialUpdate, db: Session = Depends(get_db), current: User = Depends(_GUARD)):
    m = db.get(Material, material_id)
    if not m or m.company_id != current.company_id:
        raise HTTPException(404, "Không tìm thấy vật tư.")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(m, k, v)
    db.commit()
    db.refresh(m)
    return m


@router.get("/movements", response_model=list[StockMovementOut])
def list_movements(
    material_id: int | None = None,
    db: Session = Depends(get_db),
    current: User = Depends(_GUARD),
):
    q = db.query(StockMovement).filter(StockMovement.company_id == current.company_id)
    if material_id:
        q = q.filter(StockMovement.material_id == material_id)
    return q.order_by(StockMovement.moved_at.desc().nullslast(), StockMovement.id.desc()).all()


@router.post("/movements", response_model=StockMovementOut, status_code=201)
def create_movement(payload: StockMovementCreate, db: Session = Depends(get_db), current: User = Depends(_GUARD)):
    m = db.get(Material, payload.material_id)
    if not m or m.company_id != current.company_id:
        raise HTTPException(400, "Vật tư không hợp lệ.")
    qty = Decimal(payload.quantity or 0)
    if payload.type == StockMovementType.OUT and qty > Decimal(m.stock_qty or 0):
        raise HTTPException(400, "Không đủ tồn kho để xuất.")
    # Cập nhật tồn kho.
    m.stock_qty = Decimal(m.stock_qty or 0) + (qty if payload.type == StockMovementType.IN else -qty)
    mv = StockMovement(**payload.model_dump(), company_id=current.company_id)
    db.add(mv)
    db.commit()
    db.refresh(mv)
    log_activity(db, current, f"stock.{payload.type.value.lower()}", "material", m.id,
                 f"{m.name}: {qty} {m.unit or ''}")
    return mv
