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
    LeaveStatus, DesignPhase, DesignDocStatus, ConversationType,
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
    is_approved: bool
    phone: str | None = None
    address: str | None = None
    dob: date | None = None
    identity_card: str | None = None
    cv_details: str | None = None
    schedule: str | None = None
    department: str | None = None
    manager_id: int | None = None
    manager_ids: str | None = None
    manager_name: str | None = None
    yunatt_code: str | None = None   # mã trên máy chấm công Yunatt (để map đồng bộ)
    work_start: str | None = None    # giờ làm cơ sở "HH:MM" (đánh giá đi muộn)
    work_end: str | None = None      # giờ ra cơ sở "HH:MM"
    has_subordinates: bool = False   # người này đang là quản lý trực tiếp của ≥1 người

class UserUpdate(BaseModel):
    full_name: str | None = None
    email: EmailStr | None = None
    role: UserRole | None = None
    is_active: bool | None = None   # khóa/mở quyền truy cập web
    is_approved: bool | None = None # duyệt tài khoản đang chờ (cấp quyền vào hệ thống)
    phone: str | None = None
    address: str | None = None
    dob: date | None = None
    identity_card: str | None = None
    cv_details: str | None = None
    schedule: str | None = None
    department: str | None = None
    manager_id: int | None = None
    manager_ids: str | None = None
    yunatt_code: str | None = None   # mã nhân viên trên máy chấm công Yunatt
    work_start: str | None = None    # giờ làm cơ sở "HH:MM" (đánh giá đi muộn)
    work_end: str | None = None      # giờ ra cơ sở "HH:MM"


class UserDepartmentChange(BaseModel):
    """Kéo 1 người VÀO / RA một phòng ban (thao tác trên cột users.department nhiều-phòng)."""
    department: str


class UserCreate(BaseModel):
    """Dữ liệu tạo tài khoản nhân viên mới (company_id lấy từ người tạo)."""
    email: EmailStr
    full_name: str = Field(min_length=1)
    # Để TRỐNG nếu tài khoản chỉ đăng nhập bằng Google (hệ thống tự sinh mật khẩu ngẫu nhiên).
    password: str | None = Field(default=None, min_length=8, description="Mật khẩu (>=8 ký tự); bỏ trống nếu dùng Google")
    role: UserRole = UserRole.FIELD_STAFF
    phone: str | None = None
    address: str | None = None
    dob: date | None = None
    identity_card: str | None = None
    cv_details: str | None = None
    schedule: str | None = None
    department: str | None = None
    manager_id: int | None = None
    manager_ids: str | None = None


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
    # Có thể bị ẩn (None) khi người xem KHÔNG được thấy tiền (chỉ Giám đốc thấy giá gói thầu).
    package_value: Decimal | None = None


# --------------------------- PROJECT ----------------------------
class ProjectBase(BaseModel):
    code: str                              # 管理番号 (mã quản lý)
    name: str                              # プロジェクト名 (tên dự án)
    group_name: str | None = None          # グループ (nhóm)
    geo_manager: str | None = None         # GEO担当 (tên người phụ trách phía GEO)
    dosco_manager: str | None = None       # DOSCO担当 (tên người phụ trách phía DOSCO)
    location: str | None = None
    manager_name: str | None = None
    lead_id: int | None = None            # người chủ trì (chỉ huy trưởng)
    manual_hours: Decimal | None = None   # MANUAL TIME — số giờ nhập tay
    revenue: Decimal | None = None        # DOANH THU nhập tay (VND)
    status: ProjectStatus = ProjectStatus.PLANNING
    start_date: date | None = None
    end_date: date | None = None
    internal_deadline: date | None = None
    evaluation: str | None = None
    bid_id: int | None = None


class ProjectCreate(ProjectBase):
    pass


class ProjectUpdate(BaseModel):
    name: str | None = None
    code: str | None = None               # 管理番号
    group_name: str | None = None         # グループ
    geo_manager: str | None = None        # GEO担当 (text)
    dosco_manager: str | None = None      # DOSCO担当 (text)
    location: str | None = None
    manager_name: str | None = None
    lead_id: int | None = None            # đặt/gỡ người chủ trì
    manual_hours: Decimal | None = None   # MANUAL TIME — số giờ nhập tay (None = xoá trắng)
    revenue: Decimal | None = None        # DOANH THU nhập tay (None = xoá trắng)
    status: ProjectStatus | None = None
    start_date: date | None = None
    end_date: date | None = None
    internal_deadline: date | None = None
    evaluation: str | None = None
    member_ids: list[int] | None = None


class ProjectMemberChange(BaseModel):
    """Thêm/bớt 1 thành viên khỏi dự án."""
    user_id: int


class ProjectLeadSet(BaseModel):
    """Đặt/gỡ người chủ trì dự án (lead_id=None để gỡ)."""
    lead_id: int | None = None


class ProjectOut(ProjectBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    company_id: int
    created_at: datetime
    members: list[UserOut] = []
    lead_name: str | None = None          # tên người chủ trì (tiện hiển thị)
    lead_department: str | None = None    # phòng ban của người chủ trì
    # % tiến độ THỰC = trung bình % của các mốc Progress (bơm ở router, mặc định 0).
    progress_percent: Decimal = Decimal(0)
    total_hours: float = 0.0              # tổng giờ làm từ timesheets (bơm ở router)
    total_days: float = 0.0               # tổng số ngày làm (total_hours / 8)


# --------------------------- CONTRACT ---------------------------
class ContractBase(BaseModel):
    project_id: int
    code: str
    name: str
    partner: str | None = None
    value_no_vat: Decimal = Field(default=Decimal(0), ge=0)
    vat_percent: Decimal = Field(default=Decimal(10), ge=0, le=100)
    status: ContractStatus = ContractStatus.DRAFT
    sign_date: date | None = None


class ContractCreate(ContractBase):
    pass


class ContractUpdate(BaseModel):
    name: str | None = None
    partner: str | None = None
    value_no_vat: Decimal | None = Field(default=None, ge=0)
    vat_percent: Decimal | None = Field(default=None, ge=0, le=100)
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
    """Kế toán chỉnh sửa số liệu AI bóc tách. KHÔNG cho đổi 'status' ở đây —
    duyệt/từ chối phải qua /verify, /reject (có kiểm soát vai trò) để chống tự duyệt."""
    supplier_name: str | None = None
    supplier_tax_code: str | None = None
    invoice_number: str | None = None
    invoice_date: date | None = None
    amount_no_vat: Decimal | None = Field(default=None, ge=0)
    vat_amount: Decimal | None = Field(default=None, ge=0)
    total_amount: Decimal | None = Field(default=None, ge=0)
    category: str | None = None
    project_id: int | None = None
    contract_id: int | None = None


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
    amount: Decimal = Field(default=Decimal(0), ge=0)
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
    percent_complete: Decimal = Field(default=Decimal(0), ge=0, le=100)
    planned_date: date | None = None
    actual_date: date | None = None
    note: str | None = None
    assignee_id: int | None = None                 # người thực hiện
    quantity: Decimal = Decimal(0)                  # khối lượng
    status: str = "TODO"                            # TODO / DOING / DONE


class ProgressCreate(ProgressBase):
    pass


class ProgressUpdate(BaseModel):
    title: str | None = None
    percent_complete: Decimal | None = Field(default=None, ge=0, le=100)
    planned_date: date | None = None
    actual_date: date | None = None
    note: str | None = None
    assignee_id: int | None = None
    quantity: Decimal | None = None
    status: str | None = None


class ProgressOut(ProgressBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    company_id: int
    created_at: datetime
    assignee_name: str | None = None


# ------------------------- PROJECT ITEM -------------------------
class ProjectItemBase(BaseModel):
    parent_id: int | None = None
    order_index: int = 0
    code: str | None = None
    name: str = ""          # cho phép tạo dòng trống rồi gõ tên sau (như Excel)
    unit: str | None = None
    quantity: Decimal = Decimal(0)
    unit_price: Decimal = Decimal(0)
    progress: Decimal = Decimal(0)   # % hoàn thành đầu việc (0..100) — dùng tính tiến độ dự án
    department: str | None = None    # phòng ban phụ trách (gán ở cấp nhóm cha)
    assignee_id: int | None = None   # người được giao đầu việc (giao việc cho ai)
    rating: int = 0                  # đánh giá hạng mục: 0 = chưa chấm, 1..5 sao
    note: str | None = None
    due_date: date | None = None     # hạn nộp từng hạng mục/đầu việc
    done_date: date | None = None    # ngày đánh dấu hoàn thành (so due_date -> đúng/trễ hạn)


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
    progress: Decimal | None = None
    department: str | None = None
    assignee_id: int | None = None
    rating: int | None = None
    note: str | None = None
    due_date: date | None = None
    done_date: date | None = None


class ProjectItemOut(ProjectItemBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    company_id: int
    project_id: int
    # 3 field TIỀN cho phép None để mask (ẩn) với nhân viên (STAFF). Với Quản lý/
    # Giám đốc vẫn trả số thật. Chỉ nới ở Out — Base/Create/Update giữ nguyên bắt buộc.
    quantity: Decimal | None = None       # khối lượng
    unit_price: Decimal | None = None     # đơn giá
    amount: Decimal | None = None         # thành tiền = khối lượng × đơn giá (tính sẵn từ model)
    assignee_name: str | None = None      # tên người được giao (hiển thị)
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
    is_late_override: bool | None = None
    created_at: datetime
    user_name: str | None = None     # tên người chấm công (điền ở router cho màn quản lý)


class AttendanceUpdate(BaseModel):
    is_late_override: bool | None = None
    note: str | None = None


class MachinePunch(BaseModel):
    """Dữ liệu 1 lần quẹt từ máy chấm công gọi vào /attendance/punch."""
    employee_ref: str = Field(description="Định danh nhân viên: email / số CCCD / user_id")
    direction: PaymentDirection = Field(description="IN = vào, OUT = ra")  # tái dùng IN/OUT
    timestamp: datetime | None = None  # mốc quẹt; None = lúc nhận request
    device_id: str | None = None


class AttendanceImportRow(BaseModel):
    """1 dòng quẹt khi NHẬP TỪ FILE (xuất từ phần mềm máy chấm công)."""
    employee_ref: str            # email / CCCD / user_id / mã NV
    timestamp: datetime          # mốc quẹt (ISO)


class AttendanceImportRequest(BaseModel):
    punches: list[AttendanceImportRow] = Field(default_factory=list)


class AttendanceImportResult(BaseModel):
    rows: int               # số dòng hợp lệ nhận được
    matched: int            # số dòng khớp được nhân viên
    days_updated: int       # số bản ghi chấm công (người–ngày) đã tạo/cập nhật
    days_no_checkout: int = 0  # số ngày chỉ có 1 mốc (không tính được giờ ra)
    unmatched: list[str] = []  # các mã KHÔNG tìm được nhân viên (để báo lại)


# ---------------- ĐỒNG BỘ TỰ ĐỘNG TỪ YUNATT (máy chấm công cloud) ----------------
class YunattUnmatched(BaseModel):
    """1 người trên Yunatt CHƯA ghép được với nhân viên ERP (cần map)."""
    staff_number: str
    staff_name: str | None = None


class YunattSyncResult(BaseModel):
    """Kết quả 1 lần đồng bộ từ Yunatt về ERP."""
    months: list[str] = []        # các tháng đã kéo (YYYY-MM)
    rows: int = 0                 # tổng số lượt quẹt nhận được
    matched: int = 0             # số lượt quẹt ghép được người
    days_updated: int = 0        # số bản ghi (người–ngày) đã tạo/cập nhật
    days_no_checkout: int = 0    # số ngày chỉ có 1 mốc (chưa tính được giờ làm)
    unmatched: list[YunattUnmatched] = []  # người Yunatt chưa map sang ERP


class YunattPerson(BaseModel):
    """1 người trên Yunatt + trạng thái đã map sang nhân viên ERP hay chưa."""
    staff_number: str
    staff_name: str | None = None
    user_id: int | None = None        # nhân viên ERP đã map (nếu có)
    user_name: str | None = None


class YunattSyncStatus(BaseModel):
    """Trạng thái lần đồng bộ Yunatt GẦN NHẤT (để hiển thị cho Ban Giám đốc)."""
    ran_at: datetime
    ok: bool
    trigger: str                  # "auto" (lịch 20:00) / "manual" (bấm tay)
    months: str | None = None
    rows: int = 0
    matched: int = 0
    days_updated: int = 0
    days_no_checkout: int = 0
    unmatched_count: int = 0
    message: str | None = None

    model_config = ConfigDict(from_attributes=True)


class AttendanceSummary(BaseModel):
    """Tổng hợp chấm công theo người trong 1 kỳ (cho màn quản lý)."""
    user_id: int
    full_name: str
    present_days: float = 0.0   # NGÀY CÔNG theo ca: cả ngày = 1, nửa ngày = 0.5
    late_days: int = 0
    total_hours: float = 0.0


# ------------------------- EVALUATION (ĐÁNH GIÁ) -------------------------
class EvaluationCreate(BaseModel):
    # Chấm theo TỪNG NGÀY (eval_date) & TỪNG DỰ ÁN (project_id, tùy chọn).
    # Kỳ tuần (period) do backend tự suy từ eval_date để tổng hợp theo tuần.
    evaluatee_id: int
    eval_date: date = Field(description="Ngày đánh giá 'YYYY-MM-DD'")
    project_id: int | None = Field(default=None, description="Dự án (tùy chọn); bỏ trống = đánh giá chung")
    rating: int = Field(ge=1, le=5)
    comment: str | None = None


class EvaluationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    company_id: int
    period: str
    eval_date: date | None = None
    project_id: int | None = None
    project_name: str | None = None
    evaluator_id: int
    evaluatee_id: int
    direction: EvaluationDirection
    rating: int
    comment: str | None = None
    created_at: datetime
    evaluator_name: str | None = None
    evaluatee_name: str | None = None


class EvaluationSummary(BaseModel):
    """Tổng hợp điểm 1 người NHẬN được trong kỳ — cho Giám đốc xem."""
    user_id: int
    full_name: str
    role: UserRole
    avg_rating: float
    num_ratings: int


class StarOverviewRow(BaseModel):
    """Tổng hợp SỐ SAO 1 người NHẬN được — TÁCH RÕ NGUỒN (mọi thời gian):
      - from_manager_* : sao QUẢN LÝ TRỰC TIẾP chấm cho người này (Evaluation MANAGER_TO_STAFF).
      - from_staff_*   : sao NHÂN VIÊN / cấp dưới chấm cho người này (Evaluation STAFF_TO_MANAGER).
      - project_*      : đánh giá theo dự án (ProjectEvaluation, người NHẬN).
      - item_*         : đánh giá hạng mục công việc (ProjectItem.rating, người ĐƯỢC GIAO).
      - overall_*      : gộp toàn bộ số sao (avg = tổng sao / tổng số phiếu).
    avg = None khi count = 0 (chưa có phiếu nào ở nguồn đó)."""
    user_id: int
    full_name: str
    role: UserRole
    department: str | None = None
    from_manager_avg: float | None = None    # quản lý trực tiếp chấm
    from_manager_count: int = 0
    from_staff_avg: float | None = None       # nhân viên / cấp dưới chấm
    from_staff_count: int = 0
    project_avg: float | None = None
    project_count: int = 0
    item_avg: float | None = None
    item_count: int = 0
    overall_avg: float | None = None
    overall_count: int = 0


# --------- Đánh giá theo DỰ ÁN (chấm chéo 360° giữa các thành viên) ---------
class ProjectEvaluationCreate(BaseModel):
    project_id: int
    evaluatee_id: int
    rating: int = Field(ge=1, le=5)
    comment: str | None = None


class ProjectEvaluationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    project_id: int
    evaluator_id: int
    evaluatee_id: int
    rating: int
    comment: str | None = None
    created_at: datetime
    evaluator_name: str | None = None
    evaluatee_name: str | None = None


class ProjectEvalParticipant(BaseModel):
    """Một người tham gia dự án — đối tượng có thể chấm / được chấm."""
    user_id: int
    full_name: str
    role: UserRole
    department: str | None = None
    is_lead: bool = False


class ProjectEvalSummaryRow(BaseModel):
    """Tổng hợp điểm 1 người NHẬN trong dự án — cho chủ trì/Giám đốc."""
    user_id: int
    full_name: str
    avg_rating: float
    num_ratings: int


class ProjectEvaluationView(BaseModel):
    """Toàn bộ dữ liệu tab 'Đánh giá' của 1 dự án, đã cắt theo quyền người xem.

    - participants: danh sách người tham gia (để dựng form chấm).
    - given: phiếu MÌNH đã chấm (prefill + sửa).
    - received: phiếu VỀ MÌNH — ĐÃ ẩn danh người chấm (chấm chéo cần tế nhị).
    - my_avg/my_count: điểm trung bình mình nhận.
    - summary/all_evaluations: CHỈ chủ trì/Giám đốc — xem tổng hợp & từng phiếu.
    """
    project_id: int
    can_manage: bool
    participants: list[ProjectEvalParticipant]
    given: list[ProjectEvaluationOut]
    received: list[ProjectEvaluationOut]
    my_avg: float | None = None
    my_count: int = 0
    summary: list[ProjectEvalSummaryRow] = []
    all_evaluations: list[ProjectEvaluationOut] = []


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
    base_salary: Decimal | None = Field(default=None, ge=0)
    salary_type: SalaryType | None = None
    allowance: Decimal | None = Field(default=None, ge=0)
    num_dependents: int | None = Field(default=None, ge=0)


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


class PayrollSharing(BaseModel):
    """Trạng thái chia sẻ phiếu lương (Giám đốc bật/tắt cho cả công ty)."""
    shared: bool


class MyPayrollResponse(BaseModel):
    """Phiếu lương của chính người đăng nhập + cờ đã được chia sẻ chưa."""
    shared: bool
    items: list[PayrollOut] = []


# ------------------------- AUTH (đổi mật khẩu) -------------------------
class ChangePassword(BaseModel):
    old_password: str
    new_password: str = Field(min_length=8)


class AdminResetPassword(BaseModel):
    """Quản trị/Giám đốc đặt lại mật khẩu cho nhân viên (không cần mật khẩu cũ)."""
    new_password: str = Field(min_length=8)


# ------------------------- NOTIFICATIONS (thông báo) -------------------------
class NotificationCreate(BaseModel):
    title: str = Field(min_length=1)
    body: str | None = None
    target: str = "USER"            # USER | MANAGERS | STAFF | EVERYONE
    target_user_id: int | None = None


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    sender_id: int | None = None
    sender_name: str | None = None
    title: str
    body: str | None = None
    is_read: bool
    created_at: datetime


# ------------------------- ASSIGNMENTS (giao việc) -------------------------
class AssignmentCreate(BaseModel):
    assignee_id: int
    title: str = Field(min_length=1)
    description: str | None = None
    project_id: int | None = None


class AssignmentUpdate(BaseModel):
    status: str | None = None       # ASSIGNED | IN_PROGRESS | DONE
    title: str | None = None
    description: str | None = None


class AssignmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    company_id: int
    assigner_id: int
    assigner_name: str | None = None
    assignee_id: int
    assignee_name: str | None = None
    project_id: int | None = None
    project_name: str | None = None
    title: str
    description: str | None = None
    status: str
    started_at: datetime | None = None   # do server đóng dấu khi bắt đầu làm
    done_at: datetime | None = None       # do server đóng dấu khi hoàn thành
    created_at: datetime


# ------------------------- COLLEAGUES / NICKNAMES -------------------------
class ColleagueOut(BaseModel):
    id: int
    full_name: str
    email: str | None = None
    phone: str | None = None
    role: UserRole
    department: str | None = None
    manager_id: int | None = None
    manager_ids: str | None = None
    manager_name: str | None = None
    my_nickname: str | None = None    # biệt danh DO MÌNH đặt cho người này (chỉ mình thấy)
    in_my_team: bool = False          # người này đang thuộc team của mình (mình là quản lý)
    has_subordinates: bool = False    # người này đang là quản lý trực tiếp của ≥1 người


class NicknameSet(BaseModel):
    nickname: str | None = None       # để trống = xóa biệt danh


# ------------------------- LEAVE (nghỉ phép) -------------------------
class LeaveCreate(BaseModel):
    from_date: date
    to_date: date
    leave_type: str | None = "FULL"
    reason: str | None = None


class LeaveDecision(BaseModel):
    status: LeaveStatus   # APPROVED / REJECTED


class LeaveOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    company_id: int
    user_id: int
    from_date: date
    to_date: date
    leave_type: str | None = "FULL"
    reason: str | None = None
    status: LeaveStatus
    decided_by_id: int | None = None
    decided_at: datetime | None = None
    created_at: datetime
    user_name: str | None = None
    days: float = 0


# ------------------------- EQUIPMENT (thiết bị) -------------------------
class EquipmentBase(BaseModel):
    code: str | None = None
    name: str = Field(min_length=1)
    status: str = "IDLE"
    note: str | None = None


class EquipmentCreate(EquipmentBase):
    pass


class EquipmentUpdate(BaseModel):
    code: str | None = None
    name: str | None = None
    status: str | None = None
    note: str | None = None


class EquipmentOut(EquipmentBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    company_id: int
    created_at: datetime


class EquipmentLogCreate(BaseModel):
    equipment_id: int
    project_id: int | None = None
    log_date: date | None = None
    hours_used: Decimal = Decimal(0)
    fuel: Decimal = Decimal(0)
    note: str | None = None


class EquipmentLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    company_id: int
    equipment_id: int
    project_id: int | None = None
    log_date: date | None = None
    hours_used: Decimal
    fuel: Decimal
    note: str | None = None
    created_at: datetime
    equipment_name: str | None = None
    project_name: str | None = None


# ------------------------- AUDIT LOG -------------------------
class ActivityLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    company_id: int
    user_id: int | None = None
    action: str
    entity_type: str | None = None
    entity_id: int | None = None
    detail: str | None = None
    created_at: datetime
    user_name: str | None = None


# ------------------------- FINANCE (tài chính) -------------------------
class FinanceSummary(BaseModel):
    """Tổng quan dòng tiền (chỉ Giám đốc)."""
    total_in: Decimal = Decimal(0)            # tổng thu
    total_out: Decimal = Decimal(0)           # tổng chi
    balance: Decimal = Decimal(0)             # số dư
    total_contract_value: Decimal = Decimal(0)  # tổng giá trị HĐ (gồm VAT)
    total_cost: Decimal = Decimal(0)          # tổng chi phí hóa đơn đã duyệt


class DebtRow(BaseModel):
    """Công nợ phải thu theo hợp đồng/chủ đầu tư (chỉ Giám đốc)."""
    contract_id: int
    contract_code: str
    project_name: str | None = None
    partner: str | None = None
    contract_value: Decimal       # giá trị có VAT
    collected: Decimal            # đã thu
    remaining: Decimal            # còn phải thu
    collect_percent: Decimal


# ------------------- DESIGN DOCUMENTS (hồ sơ thiết kế) -------------------
class DesignDocBase(BaseModel):
    project_id: int
    phase: DesignPhase
    code: str | None = None
    name: str = Field(min_length=1)
    discipline: str | None = None
    version: str | None = None
    status: DesignDocStatus = DesignDocStatus.DRAFT
    file_url: str | None = None
    note: str | None = None


class DesignDocCreate(DesignDocBase):
    pass


class DesignDocUpdate(BaseModel):
    phase: DesignPhase | None = None
    code: str | None = None
    name: str | None = None
    discipline: str | None = None
    version: str | None = None
    status: DesignDocStatus | None = None
    file_url: str | None = None
    note: str | None = None


class DesignDocOut(DesignDocBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    company_id: int
    created_at: datetime
    project_name: str | None = None
    created_by_name: str | None = None


# ------------------------- CHAT (nhắn tin nội bộ) -------------------------
class ConversationCreate(BaseModel):
    # DIRECT: truyền member_ids = [1 người kia]. GROUP: >=2 người + title.
    type: str = "DIRECT"                 # DIRECT | GROUP
    member_ids: list[int] = Field(default_factory=list)
    title: str | None = None


class ChatMemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    user_id: int
    user_name: str | None = None


class ConversationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    type: ConversationType
    title: str | None = None            # với DIRECT: FE hiển thị tên người kia
    project_id: int | None = None       # != None => nhóm chat gắn dự án
    members: list[ChatMemberOut] = []
    last_message: str | None = None     # preview text của tin cuối
    last_message_at: datetime | None = None
    unread: int = 0                     # số tin chưa đọc của current user
    created_at: datetime


class MessageCreate(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


class ReactionCreate(BaseModel):
    emoji: str = Field(min_length=1, max_length=16)


class ReactionAgg(BaseModel):
    emoji: str
    count: int
    mine: bool = False


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    conversation_id: int
    sender_id: int
    sender_name: str | None = None
    body: str
    created_at: datetime
    reactions: list[ReactionAgg] = []


class ConversationRename(BaseModel):
    title: str = Field(min_length=1, max_length=255)


class ConversationAddMembers(BaseModel):
    member_ids: list[int] = Field(default_factory=list)


# --------------------------- TIMESHEET --------------------------
class TimesheetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    user_id: int
    project_id: int
    project_item_id: int | None = None      # đầu việc (hạng mục) gắn giờ; None = cấp dự án
    work_date: date
    hours: Decimal
    note: str | None = None
    user_name: str | None = None
    project_name: str | None = None
    project_code: str | None = None


class TimesheetUpsert(BaseModel):
    project_id: int
    project_item_id: int | None = None      # đầu việc gắn giờ; None = giờ cấp dự án
    work_date: date
    hours: Decimal = Field(ge=0, le=24)     # 0 = xóa ô
    note: str | None = None
    user_id: int | None = None              # Quản lý+ có thể khai hộ người khác; None = chính mình


# --------------------------- DEPARTMENT -------------------------
class DepartmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    order_index: int


class DepartmentCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class DepartmentUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


# ---------------------- PROJECT ITEM RATING ---------------------
class ProjectItemRatingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    project_item_id: int
    user_id: int
    rating: int


class ProjectItemRatingUpsert(BaseModel):
    project_item_id: int
    user_id: int
    rating: int = Field(ge=0, le=5)



# ------------------------- ORG CHART (sơ đồ tổ chức) -------------------------
class OrgChartNode(BaseModel):
    """Một ô nhân sự trong sơ đồ. Giữ ĐÚNG tên trường camelCase như frontend."""
    key: str
    name: str
    deptLabel: str = ""
    jpDeptLabel: str = ""
    bgClass: str = "bg-slate-100"
    textClass: str = "text-slate-900"
    borderColor: str = "border-slate-300"


class OrgChartData(BaseModel):
    """Các CỤM ô theo đúng bố cục đang vẽ (nhánh trái = 3D, nhánh phải = Cầu đường)."""
    level1: list[OrgChartNode] = []
    level2: list[OrgChartNode] = []
    level3: list[OrgChartNode] = []
    level4Left: list[OrgChartNode] = []
    level4Right: list[OrgChartNode] = []
    level5Left: list[OrgChartNode] = []
    level5Right: list[OrgChartNode] = []
    level6Left: list[OrgChartNode] = []
    level6Right: list[OrgChartNode] = []


class OrgChartOut(BaseModel):
    data: OrgChartData
    updated_at: datetime | None = None
    updated_by_name: str | None = None
    # Người đang xem có được sửa không -> frontend ẩn/hiện nút cho khớp backend.
    can_edit: bool = False
