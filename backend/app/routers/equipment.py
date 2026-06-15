"""
Router Thiết bị (Equipment) — sổ thiết bị/máy móc + nhật ký điều động (giờ chạy, nhiên liệu).
Quyền: Quản lý trở lên.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_roles
from app.models import Equipment, EquipmentLog, User, UserRole
from app.schemas import (
    EquipmentCreate, EquipmentLogCreate, EquipmentLogOut, EquipmentOut, EquipmentUpdate,
)

router = APIRouter(prefix="/equipment", tags=["Thiết bị"])

_GUARD = require_roles(UserRole.MANAGER, UserRole.ACCOUNTANT, UserRole.DIRECTOR)


@router.get("", response_model=list[EquipmentOut])
def list_equipment(db: Session = Depends(get_db), current: User = Depends(_GUARD)):
    return (
        db.query(Equipment)
        .filter(Equipment.company_id == current.company_id)
        .order_by(Equipment.name)
        .all()
    )


@router.post("", response_model=EquipmentOut, status_code=201)
def create_equipment(payload: EquipmentCreate, db: Session = Depends(get_db), current: User = Depends(_GUARD)):
    e = Equipment(**payload.model_dump(), company_id=current.company_id)
    db.add(e)
    db.commit()
    db.refresh(e)
    return e


@router.patch("/{equipment_id}", response_model=EquipmentOut)
def update_equipment(equipment_id: int, payload: EquipmentUpdate, db: Session = Depends(get_db), current: User = Depends(_GUARD)):
    e = db.get(Equipment, equipment_id)
    if not e or e.company_id != current.company_id:
        raise HTTPException(404, "Không tìm thấy thiết bị.")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(e, k, v)
    db.commit()
    db.refresh(e)
    return e


@router.get("/logs", response_model=list[EquipmentLogOut])
def list_logs(
    equipment_id: int | None = None,
    db: Session = Depends(get_db),
    current: User = Depends(_GUARD),
):
    q = db.query(EquipmentLog).filter(EquipmentLog.company_id == current.company_id)
    if equipment_id:
        q = q.filter(EquipmentLog.equipment_id == equipment_id)
    return q.order_by(EquipmentLog.log_date.desc().nullslast(), EquipmentLog.id.desc()).all()


@router.post("/logs", response_model=EquipmentLogOut, status_code=201)
def create_log(payload: EquipmentLogCreate, db: Session = Depends(get_db), current: User = Depends(_GUARD)):
    e = db.get(Equipment, payload.equipment_id)
    if not e or e.company_id != current.company_id:
        raise HTTPException(400, "Thiết bị không hợp lệ.")
    log = EquipmentLog(**payload.model_dump(), company_id=current.company_id)
    db.add(log)
    db.commit()
    db.refresh(log)
    return log
