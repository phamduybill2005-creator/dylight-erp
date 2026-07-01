"""Router Thanh toán / Quyết toán (Payments) — gắn theo hợp đồng."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, require_roles
from app.models import Contract, Payment, User, UserRole
from app.schemas import PaymentCreate, PaymentOut

router = APIRouter(prefix="/payments", tags=["Thanh toán"])


@router.get("", response_model=list[PaymentOut])
def list_payments(
    contract_id: int | None = None,
    db: Session = Depends(get_db),
    # Chỉ Quản lý/Kế toán/Giám đốc được xem số tiền thanh toán (nhân viên không thấy tiền).
    current: User = Depends(require_roles(UserRole.MANAGER, UserRole.ACCOUNTANT, UserRole.DIRECTOR)),
):
    q = db.query(Payment).filter(Payment.company_id == current.company_id)
    if contract_id:
        q = q.filter(Payment.contract_id == contract_id)
    return q.order_by(Payment.payment_date.desc().nullslast()).all()


@router.post("", response_model=PaymentOut, status_code=201)
def create_payment(
    payload: PaymentCreate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    contract = db.get(Contract, payload.contract_id)
    if not contract or contract.company_id != current.company_id:
        raise HTTPException(400, "Hợp đồng không hợp lệ.")
    payment = Payment(**payload.model_dump(), company_id=current.company_id)
    db.add(payment)
    db.commit()
    db.refresh(payment)
    return payment
