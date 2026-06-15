"""
Pydantic schemas — định nghĩa "hợp đồng dữ liệu" giữa client và API.
Quy ước:
  *Create : dữ liệu tạo mới (client gửi lên).
  *Update : dữ liệu cập nhật (mọi field optional).
  *Out    : dữ liệu trả về (đọc từ ORM nhờ from_attributes=True).
"""
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, EmailStr, ConfigDict, Field

from app.models import (
    UserRole, BidStatus, ProjectStatus, ContractStatus,
    InvoiceStatus, PaymentType, PaymentDirection,
    AttendanceSource, EvaluationDirection, PartnerType, SalaryType,
)


# ----------------------------- AUTH -----------------------------
class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class GoogleLoginRequest(BaseModel):
    credential: str   # ID token (JWT) do Google Identity trả về ở frontend


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    company_id: int
    email: EmailStr
    full_name: str
    role: UserRole
    is_active: bool
    phone: str | None = None
    address: str | None = None
    dob: date | None = None
    identity_card: str | None = None
    cv_details: str | None = None
    schedule: str | None = None
    manager_id: int | None = None
    manager_name: str | None = None

class UserUpdate(BaseModel):
    full_name: str | None = None
    role: UserRole | None = None
    phone: str | None = None
    address: str | None = None
    dob: date | None = None
    identity_card: str | None = None
    cv_details: str | None = None
    schedule: str | None = None
    manager_id: int | None = None


class UserCreate(BaseModel):
    """Dữ liệu tạo tài khoản nhân viên mới (company_id lấy từ người tạo)."""
    email: EmailStr
    full_name: str = Field(min_length=1)
    password: str = Field(min_length=6, description="Mật khẩu đăng nhập (tối thiểu 6 ký tự)")
    role: UserRole = UserRole.FIELD_STAFF
    phone: str | None = None
    address: str | None = None
    dob: date | None = None
    identity_card: str | None = None
    cv_details: str | None = None
    schedule: str | None = None
    manager_id: int | None = None


# --------------------------- COMPANY ----------------------------
class CompanyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    code: str
    tax_code: str | None = None
    is_active: bool


# ----------------------------- BID ------------------------------
class BidBase(BaseModel):
    code: str
    name: str
    investor: str | None = None
    package_value: Decimal = Decimal(0)
    status: BidStatus = BidStatus.DRAFT
    submit_date: date | None = None
    result_date: date | None = None
    note: str | None = None


class BidCreate(BidBase):
    pass


class BidUpdate(BaseModel):
    name: str | None = None
    investor: str | None = None
    package_value: Decimal | None = None
    status: BidStatus | None = None
    submit_date: date | None = None
    result_date: date | None = None
    note: str | None = None


class BidOut(BidBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    company_id: int
    created_at: datetime


# --------------------------- PROJECT ----------------------------
class ProjectBase(BaseModel):
    code: str
    name: str
    location: str | None = None
    manager_name: str | None = None
    status: ProjectStatus = ProjectStatus.PLANNING
    start_date: date | None = None
    end_date: date | None = None
    bid_id: int | None = None


class ProjectCreate(ProjectBase):
    pass


class ProjectUpdate(BaseModel):
    name: str | None = None
    location: str | None = None
    manager_name: str | None = None
    status: ProjectStatus | None = None
    start_date: date | None = None
    end_date: date | None = None
    member_ids: list[int] | None = None


class ProjectOut(ProjectBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    company_id: int
    created_at: datetime
    members: list[UserOut] = []


# --------------------------- CONTRACT ---------------------------
class ContractBase(BaseModel):
    project_id: int
    code: str
    name: str
    partner: str | None = None
    value_no_vat: Decimal = Decimal(0)
    vat_percent: Decimal = Decimal(10)
    status: ContractStatus = ContractStatus.DRAFT
    sign_date: date | None = None


class ContractCreate(ContractBase):
    pass


class ContractUpdate(BaseModel):
    name: str | None = None
    partner: str | None = None
    value_no_vat: Decimal | None = None
    vat_percent: Decimal | None = None
    status: ContractStatus | None = None
    sign_date: date | None = None


class ContractOut(ContractBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    company_id: int
    created_at: datetime


# --------------------------- INVOICE ----------------------------
class OcrResult(BaseModel):
    """Cấu trúc dữ liệu AI bóc tách từ ảnh hóa đơn."""
    supplier_name: str | None = None
    supplier_tax_code: str | None = None
    invoice_number: str | None = None
    invoice_date: date | None = None
    amount_no_vat: Decimal = Decimal(0)
    vat_amount: Decimal = Decimal(0)
    total_amount: Decimal = Decimal(0)
    category: str | None = None
    confidence: Decimal | None = None


class InvoiceUpdate(BaseModel):
    """Kế toán chỉnh sửa/duyệt dữ liệu sau khi AI bóc tách."""
    supplier_name: str | None = None
    supplier_tax_code: str | None = None
    invoice_number: str | None = None
    invoice_date: date | None = None
    amount_no_vat: Decimal | None = None
    vat_amount: Decimal | None = None
    total_amount: Decimal | None = None
    category: str | None = None
    project_id: int | None = None
    contract_id: int | None = None
    status: InvoiceStatus | None = None


class InvoiceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    company_id: int
    project_id: int | None = None
    contract_id: int | None = None
    image_url: str | None = None
    original_filename: str | None = None
    supplier_name: str | None = None
    supplier_tax_code: str | None = None
    invoice_number: str | None = None
    invoice_date: date | None = None
    amount_no_vat: Decimal
    vat_amount: Decimal
    total_amount: Decimal
    category: str | None = None
    ocr_confidence: Decimal | None = None
    status: InvoiceStatus
    created_at: datetime


# --------------------------- PAYMENT ----------------------------
class PaymentBase(BaseModel):
    contract_id: int
    code: str | None = None
    payment_type: PaymentType = PaymentType.PROGRESS
    direction: PaymentDirection = PaymentDirection.IN
    amount: Decimal = Decimal(0)
    payment_date: date | None = None
    note: str | None = None


class PaymentCreate(PaymentBase):
    pass


class PaymentOut(PaymentBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    company_id: int
    created_at: datetime


# --------------------------- PROGRESS ---------------------------
class ProgressBase(BaseModel):
    project_id: int
    title: str
    percent_complete: Decimal = Decimal(0)
    planned_date: date | None = None
    actual_date: date | None = None
    note: str | None = None


class ProgressCreate(ProgressBase):
    pass


class ProgressOut(ProgressBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    company_id: int
    created_at: datetime


# ------------------------- PROJECT ITEM -------------------------
class ProjectItemBase(BaseModel):
    parent_id: int | None = None
    order_index: int = 0
    code: str | None = None
    name: str = ""          # cho phép tạo dòng trống rồi gõ tên sau (như Excel)
    unit: str | None = None
    quantity: Decimal = Decimal(0)
    unit_price: Decimal = Decimal(0)
    note: str | None = None


class ProjectItemCreate(ProjectItemBase):
    project_id: int


class ProjectItemUpdate(BaseModel):
    """Mọi field optional — chỉ cập nhật ô được sửa (PATCH từng ô như Excel)."""
    parent_id: int | None = None
    order_index: int | None = None
    code: str | None = None
    name: str | None = None
    unit: str | None = None
    quantity: Decimal | None = None
    unit_price: Decimal | None = None
    note: str | None = None


class ProjectItemOut(ProjectItemBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    company_id: int
    project_id: int
    amount: Decimal       # thành tiền = khối lượng × đơn giá (tính sẵn từ model)
    created_at: datetime


# -------------------------- DASHBOARD ---------------------------
class KpiSummary(BaseModel):
    """Số liệu tổng quan hiển thị trên đầu Dashboard."""
    active_contracts: int = Field(0, description="Hợp đồng đang quản lý")
    total_contract_value: Decimal = Field(0, description="Tổng giá trị HĐ (chưa VAT)")
    total_invoice_cost: Decimal = Field(0, description="Tổng chi phí hóa đơn đã duyệt")
    total_collected: Decimal = Field(0, description="Tổng tiền đã thu")
    estimated_profit: Decimal = Field(0, description="Lãi/lỗ ước tính")
    pending_invoices: int = Field(0, description="Hóa đơn chờ xử lý")


class ProjectProfit(BaseModel):
    """Báo cáo lãi/lỗ theo từng dự án."""
    project_id: int
    project_name: str
    contract_value: Decimal
    cost: Decimal
    profit: Decimal
    margin_percent: Decimal


# ------------------------- ATTENDANCE (CHẤM CÔNG) -------------------------
class AttendanceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    company_id: int
    user_id: int
    work_date: date
    check_in: datetime | None = None
    check_out: datetime | None = None
    source: AttendanceSource
    device_id: str | None = None
    note: str | None = None
    worked_minutes: int = 0
    is_late: bool = False
    created_at: datetime
    user_name: str | None = None     # tên người chấm công (điền ở router cho màn quản lý)


class MachinePunch(BaseModel):
    """Dữ liệu 1 lần quẹt từ máy chấm công gọi vào /attendance/punch."""
    employee_ref: str = Field(description="Định danh nhân viên: email / số CCCD / user_id")
    direction: PaymentDirection = Field(description="IN = vào, OUT = ra")  # tái dùng IN/OUT
    timestamp: datetime | None = None  # mốc quẹt; None = lúc nhận request
    device_id: str | None = None


class AttendanceSummary(BaseModel):
    """Tổng hợp chấm công theo người trong 1 kỳ (cho màn quản lý)."""
    user_id: int
    full_name: str
    present_days: int = 0
    late_days: int = 0
    total_hours: float = 0.0


# ------------------------- EVALUATION (ĐÁNH GIÁ) -------------------------
class EvaluationCreate(BaseModel):
    period: str = Field(pattern=r"^\d{4}-\d{2}$", description="Kỳ đánh giá 'YYYY-MM'")
    evaluatee_id: int
    rating: int = Field(ge=1, le=5)
    comment: str | None = None


class EvaluationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    company_id: int
    period: str
    evaluator_id: int
    evaluatee_id: int
    direction: EvaluationDirection
    rating: int
    comment: str | None = None
    created_at: datetime
    evaluator_name: str | None = None
    evaluatee_name: str | None = None


# ------------------------- PARTNER (ĐỐI TÁC) -------------------------
class PartnerBase(BaseModel):
    type: PartnerType = PartnerType.SUPPLIER
    name: str = Field(min_length=1)
    tax_code: str | None = None
    contact_person: str | None = None
    phone: str | None = None
    email: str | None = None
    address: str | None = None
    note: str | None = None
    is_active: bool = True


class PartnerCreate(PartnerBase):
    pass


class PartnerUpdate(BaseModel):
    type: PartnerType | None = None
    name: str | None = None
    tax_code: str | None = None
    contact_person: str | None = None
    phone: str | None = None
    email: str | None = None
    address: str | None = None
    note: str | None = None
    is_active: bool | None = None


class PartnerOut(PartnerBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    company_id: int
    created_at: datetime


# ------------------------- PAYROLL (BẢNG LƯƠNG) -------------------------
class SalaryConfig(BaseModel):
    """Cấu hình lương của 1 nhân viên (chỉ Giám đốc xem/sửa)."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    full_name: str
    base_salary: Decimal = Decimal(0)
    salary_type: SalaryType = SalaryType.MONTHLY
    allowance: Decimal = Decimal(0)
    num_dependents: int = 0


class SalaryConfigUpdate(BaseModel):
    base_salary: Decimal | None = None
    salary_type: SalaryType | None = None
    allowance: Decimal | None = None
    num_dependents: int | None = None


class PayrollOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    company_id: int
    user_id: int
    period: str
    working_days: Decimal
    base_amount: Decimal
    allowance: Decimal
    gross: Decimal
    insurance: Decimal
    personal_income_tax: Decimal
    net: Decimal
    note: str | None = None
    created_at: datetime
    user_name: str | None = None
