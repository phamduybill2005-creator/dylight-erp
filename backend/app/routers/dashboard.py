"""
Router Dashboard — tổng hợp số liệu cho Giám đốc theo dõi.
Tính KPI và báo cáo lãi/lỗ trực tiếp bằng truy vấn tổng hợp (SQL aggregate)
để hiệu năng tốt khi dữ liệu lớn, thay vì tải toàn bộ bản ghi về Python.
"""
from decimal import Decimal

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_roles
from app.models import (
    Contract, ContractStatus, Invoice, InvoiceStatus, Payment,
    PaymentDirection, Project, User, UserRole,
)
from app.schemas import KpiSummary, ProjectProfit

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])

# Số liệu tài chính (doanh thu / lãi-lỗ) chỉ dành cho Giám đốc (ADMIN tự được phép).
# Tầng Quản lý (MANAGER/ACCOUNTANT) bị chặn tại đây — khớp yêu cầu ẩn doanh thu.
_FINANCE_GUARD = require_roles(UserRole.DIRECTOR)


def _d(v) -> Decimal:
    return v if v is not None else Decimal(0)


@router.get("/summary", response_model=KpiSummary)
def kpi_summary(db: Session = Depends(get_db), current: User = Depends(_FINANCE_GUARD)):
    """Bộ số liệu KPI tổng quan hiển thị trên đầu trang Dashboard."""
    cid = current.company_id

    active_contracts = (
        db.query(func.count(Contract.id))
        .filter(Contract.company_id == cid, Contract.status == ContractStatus.ACTIVE)
        .scalar() or 0
    )
    total_contract_value = _d(
        db.query(func.coalesce(func.sum(Contract.value_no_vat), 0))
        .filter(Contract.company_id == cid)
        .scalar()
    )
    total_invoice_cost = _d(
        db.query(func.coalesce(func.sum(Invoice.total_amount), 0))
        .filter(Invoice.company_id == cid, Invoice.status == InvoiceStatus.VERIFIED)
        .scalar()
    )
    total_collected = _d(
        db.query(func.coalesce(func.sum(Payment.amount), 0))
        .filter(Payment.company_id == cid, Payment.direction == PaymentDirection.IN)
        .scalar()
    )
    pending_invoices = (
        db.query(func.count(Invoice.id))
        .filter(
            Invoice.company_id == cid,
            Invoice.status.in_([InvoiceStatus.PENDING, InvoiceStatus.EXTRACTED, InvoiceStatus.PROCESSING]),
        )
        .scalar() or 0
    )

    return KpiSummary(
        active_contracts=active_contracts,
        total_contract_value=total_contract_value,
        total_invoice_cost=total_invoice_cost,
        total_collected=total_collected,
        estimated_profit=total_contract_value - total_invoice_cost,
        pending_invoices=pending_invoices,
    )


@router.get("/profit", response_model=list[ProjectProfit])
def profit_by_project(db: Session = Depends(get_db), current: User = Depends(_FINANCE_GUARD)):
    """
    Báo cáo lãi/lỗ theo dự án:
      Lãi = Tổng giá trị HĐ (chưa VAT) − Tổng chi phí hóa đơn đã duyệt.
    """
    cid = current.company_id
    projects = db.query(Project).filter(Project.company_id == cid).all()

    results: list[ProjectProfit] = []
    for p in projects:
        contract_value = _d(
            db.query(func.coalesce(func.sum(Contract.value_no_vat), 0))
            .filter(Contract.project_id == p.id)
            .scalar()
        )
        cost = _d(
            db.query(func.coalesce(func.sum(Invoice.total_amount), 0))
            .filter(Invoice.project_id == p.id, Invoice.status == InvoiceStatus.VERIFIED)
            .scalar()
        )
        profit = contract_value - cost
        margin = (profit / contract_value * 100) if contract_value > 0 else Decimal(0)
        results.append(ProjectProfit(
            project_id=p.id,
            project_name=p.name,
            contract_value=contract_value,
            cost=cost,
            profit=profit,
            margin_percent=margin.quantize(Decimal("0.1")),
        ))
    # Sắp xếp dự án lỗ nặng / biên thấp lên đầu để Giám đốc chú ý.
    results.sort(key=lambda r: r.margin_percent)
    return results
