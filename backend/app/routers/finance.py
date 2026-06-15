"""
Router Tài chính (Finance) — tổng quan dòng tiền + công nợ phải thu.
NHẠY CẢM: chỉ Giám đốc / Quản trị.
"""
from decimal import Decimal

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_roles
from app.models import (
    Contract, Invoice, InvoiceStatus, Payment, PaymentDirection, Project, User, UserRole,
)
from app.schemas import DebtRow, FinanceSummary

router = APIRouter(prefix="/finance", tags=["Tài chính"])

_GUARD = require_roles(UserRole.DIRECTOR)


def _d(v) -> Decimal:
    return v if v is not None else Decimal(0)


@router.get("/summary", response_model=FinanceSummary)
def finance_summary(db: Session = Depends(get_db), current: User = Depends(_GUARD)):
    cid = current.company_id
    total_in = _d(db.query(func.coalesce(func.sum(Payment.amount), 0))
                  .filter(Payment.company_id == cid, Payment.direction == PaymentDirection.IN).scalar())
    total_out = _d(db.query(func.coalesce(func.sum(Payment.amount), 0))
                   .filter(Payment.company_id == cid, Payment.direction == PaymentDirection.OUT).scalar())
    total_cost = _d(db.query(func.coalesce(func.sum(Invoice.total_amount), 0))
                    .filter(Invoice.company_id == cid, Invoice.status == InvoiceStatus.VERIFIED).scalar())
    # Tổng giá trị HĐ gồm VAT (tính từng HĐ vì vat_percent có thể khác nhau).
    contracts = db.query(Contract).filter(Contract.company_id == cid).all()
    total_contract = sum((c.value_with_vat for c in contracts), Decimal(0))
    return FinanceSummary(
        total_in=total_in, total_out=total_out, balance=total_in - total_out,
        total_contract_value=total_contract, total_cost=total_cost,
    )


@router.get("/debts", response_model=list[DebtRow])
def receivable_debts(db: Session = Depends(get_db), current: User = Depends(_GUARD)):
    """Công nợ phải thu theo hợp đồng = giá trị HĐ (gồm VAT) − đã thu."""
    cid = current.company_id
    rows: list[DebtRow] = []
    contracts = db.query(Contract).filter(Contract.company_id == cid).all()
    for c in contracts:
        value = c.value_with_vat
        collected = _d(db.query(func.coalesce(func.sum(Payment.amount), 0))
                       .filter(Payment.contract_id == c.id, Payment.direction == PaymentDirection.IN).scalar())
        remaining = value - collected
        pct = (collected / value * 100) if value > 0 else Decimal(0)
        proj = db.get(Project, c.project_id) if c.project_id else None
        rows.append(DebtRow(
            contract_id=c.id, contract_code=c.code,
            project_name=proj.name if proj else None, partner=c.partner,
            contract_value=value, collected=collected, remaining=remaining,
            collect_percent=pct.quantize(Decimal("0.1")),
        ))
    rows.sort(key=lambda r: r.remaining, reverse=True)
    return rows
