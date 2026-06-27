"""
Router Bảng lương (Payroll) — tính lương theo kỳ từ chấm công.
NHẠY CẢM: chỉ Giám đốc / Quản trị (require_roles(DIRECTOR)). Lương KHÔNG lộ ra
endpoint nhân sự chung (/auth/users) nên Quản lý không thấy được.

Công thức (đơn giản hóa, theo quy định VN):
  - Ngày công lấy từ bảng chấm công (có giờ vào) trong kỳ.
  - Lương tháng: base * min(ngày_công, 26)/26 ; Lương công nhật: đơn giá * ngày_công.
  - Tổng thu nhập (gross) = lương theo công + phụ cấp.
  - BHXH+BHYT+BHTN nhân viên đóng = 10.5% lương cơ bản (chỉ áp dụng lương tháng).
  - Giảm trừ: bản thân 11.000.000đ + 4.400.000đ/người phụ thuộc.
  - Thuế TNCN: biểu lũy tiến từng phần theo tháng.
  - Thực nhận (net) = gross - bảo hiểm - thuế TNCN.
"""
from calendar import monthrange
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, require_roles
from app.models import Attendance, Company, Payroll, SalaryType, User, UserRole
from app.schemas import (
    PayrollOut, SalaryConfig, SalaryConfigUpdate, PayrollSharing, MyPayrollResponse,
)

router = APIRouter(prefix="/payroll", tags=["Bảng lương"])

_GUARD = require_roles(UserRole.DIRECTOR)

STANDARD_DAYS = Decimal(26)             # số ngày công chuẩn/tháng
INSURANCE_RATE = Decimal("0.105")       # BHXH 8% + BHYT 1.5% + BHTN 1%
SELF_DEDUCTION = Decimal(11_000_000)    # giảm trừ bản thân
DEPENDENT_DEDUCTION = Decimal(4_400_000)  # giảm trừ mỗi người phụ thuộc

# Biểu thuế TNCN lũy tiến từng phần theo THÁNG: (ngưỡng trên, thuế suất, trừ nhanh)
PIT_BRACKETS = [
    (Decimal(5_000_000), Decimal("0.05"), Decimal(0)),
    (Decimal(10_000_000), Decimal("0.10"), Decimal(250_000)),
    (Decimal(18_000_000), Decimal("0.15"), Decimal(750_000)),
    (Decimal(32_000_000), Decimal("0.20"), Decimal(1_650_000)),
    (Decimal(52_000_000), Decimal("0.25"), Decimal(3_250_000)),
    (Decimal(80_000_000), Decimal("0.30"), Decimal(5_850_000)),
    (None, Decimal("0.35"), Decimal(9_850_000)),
]


def _pit(taxable: Decimal) -> Decimal:
    """Thuế TNCN theo biểu lũy tiến từng phần (phương pháp rút gọn)."""
    if taxable <= 0:
        return Decimal(0)
    for ceil, rate, sub in PIT_BRACKETS:
        if ceil is None or taxable <= ceil:
            return (taxable * rate - sub).quantize(Decimal("1"))
    return Decimal(0)


def _month_range(period: str) -> tuple[date, date]:
    y, m = int(period[:4]), int(period[5:7])
    return date(y, m, 1), date(y, m, monthrange(y, m)[1])


@router.get("/staff", response_model=list[SalaryConfig])
def list_salary_config(db: Session = Depends(get_db), current: User = Depends(_GUARD)):
    """Danh sách nhân viên + cấu hình lương (chỉ Giám đốc)."""
    return (
        db.query(User)
        .filter(User.company_id == current.company_id, User.is_active == True)  # noqa: E712
        .order_by(User.full_name)
        .all()
    )


@router.patch("/staff/{user_id}", response_model=SalaryConfig)
def set_salary_config(
    user_id: int,
    payload: SalaryConfigUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(_GUARD),
):
    u = db.get(User, user_id)
    if not u or u.company_id != current.company_id:
        raise HTTPException(404, "Không tìm thấy nhân viên.")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(u, k, v)
    db.commit()
    db.refresh(u)
    return u


@router.post("/generate", response_model=list[PayrollOut])
def generate_payroll(
    period: str = Query(pattern=r"^\d{4}-\d{2}$"),
    db: Session = Depends(get_db),
    current: User = Depends(_GUARD),
):
    """Tính (lại) bảng lương cho toàn công ty trong kỳ period='YYYY-MM'."""
    cid = current.company_id
    start, end = _month_range(period)

    # Xóa bảng lương cũ của kỳ để tính lại sạch.
    db.query(Payroll).filter(Payroll.company_id == cid, Payroll.period == period).delete()

    users = db.query(User).filter(User.company_id == cid, User.is_active == True).all()  # noqa: E712
    results: list[Payroll] = []
    for u in users:
        base = Decimal(u.base_salary or 0)
        allowance = Decimal(u.allowance or 0)
        if base <= 0 and allowance <= 0:
            continue  # bỏ qua người chưa cấu hình lương

        # Đếm theo SỐ NGÀY (distinct work_date) có chấm vào — không đếm số bản ghi,
        # để bản ghi trùng (nếu có) không làm phồng ngày công -> trả thừa lương.
        working_days = (
            db.query(func.count(func.distinct(Attendance.work_date)))
            .filter(
                Attendance.user_id == u.id,
                Attendance.work_date >= start,
                Attendance.work_date <= end,
                Attendance.check_in.isnot(None),
            )
            .scalar()
        ) or 0
        wd = Decimal(working_days)

        if u.salary_type == SalaryType.DAILY:
            base_amount = base * wd
            insurance = Decimal(0)  # công nhật thường không tham gia BHXH bắt buộc
        else:
            factor = min(wd, STANDARD_DAYS) / STANDARD_DAYS if STANDARD_DAYS else Decimal(0)
            base_amount = (base * factor).quantize(Decimal("1"))
            insurance = (base * INSURANCE_RATE).quantize(Decimal("1"))

        gross = base_amount + allowance
        deduction = SELF_DEDUCTION + DEPENDENT_DEDUCTION * Decimal(u.num_dependents or 0)
        taxable = gross - insurance - deduction
        pit = _pit(taxable)
        net = gross - insurance - pit

        rec = Payroll(
            company_id=cid, user_id=u.id, period=period, working_days=wd,
            base_amount=base_amount, allowance=allowance, gross=gross,
            insurance=insurance, personal_income_tax=pit, net=net,
        )
        db.add(rec)
        results.append(rec)

    db.commit()
    for r in results:
        db.refresh(r)
    return results


@router.get("", response_model=list[PayrollOut])
def list_payroll(
    period: str | None = None,
    db: Session = Depends(get_db),
    current: User = Depends(_GUARD),
):
    q = db.query(Payroll).filter(Payroll.company_id == current.company_id)
    if period:
        q = q.filter(Payroll.period == period)
    return q.order_by(Payroll.period.desc()).all()


@router.get("/sharing", response_model=PayrollSharing)
def get_sharing(db: Session = Depends(get_db), current: User = Depends(_GUARD)):
    """Trạng thái chia sẻ phiếu lương của công ty (chỉ Giám đốc)."""
    company = db.get(Company, current.company_id)
    return PayrollSharing(shared=bool(company and company.payroll_shared))


@router.patch("/sharing", response_model=PayrollSharing)
def set_sharing(payload: PayrollSharing, db: Session = Depends(get_db), current: User = Depends(_GUARD)):
    """Giám đốc bật/tắt chia sẻ phiếu lương cho nhân viên (mỗi người xem lương của mình)."""
    company = db.get(Company, current.company_id)
    if not company:
        raise HTTPException(404, "Không tìm thấy công ty.")
    company.payroll_shared = payload.shared
    db.commit()
    return PayrollSharing(shared=company.payroll_shared)


@router.get("/me", response_model=MyPayrollResponse)
def my_payroll(
    period: str | None = None,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """
    Phiếu lương CỦA CHÍNH MÌNH — mọi nhân viên xem được KHI Giám đốc đã bật chia sẻ.
    Chưa bật -> shared=False, items rỗng (không lộ lương).
    """
    company = db.get(Company, current.company_id)
    shared = bool(company and company.payroll_shared)
    items: list[Payroll] = []
    if shared:
        q = db.query(Payroll).filter(
            Payroll.company_id == current.company_id, Payroll.user_id == current.id
        )
        if period:
            q = q.filter(Payroll.period == period)
        items = q.order_by(Payroll.period.desc()).all()
    return MyPayrollResponse(shared=shared, items=items)
