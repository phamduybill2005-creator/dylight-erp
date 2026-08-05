"""
==========================================================================
 DYLIGHT ERP — MÔ HÌNH DỮ LIỆU (9 BẢNG CỐT LÕI)
==========================================================================
Kiến trúc đa người dùng (multi-tenant) theo mô hình "shared schema":
mọi bảng nghiệp vụ đều mang khóa `company_id` để cô lập dữ liệu giữa
các công ty/chi nhánh.

Vòng đời tài chính của một gói thầu:
    BIDS (đấu thầu)
      └─> PROJECTS (dự án trúng thầu)
            └─> CONTRACTS (hợp đồng)
                  ├─> INVOICES (hóa đơn chi phí — có ảnh + dữ liệu AI OCR)
                  └─> PAYMENTS (tạm ứng / thanh toán / quyết toán)
    PROGRESS  : nhật ký tiến độ theo dự án
    ACTIVITY_LOGS : vết kiểm toán (audit) thao tác người dùng
==========================================================================
"""
import enum
from datetime import datetime, date
from decimal import Decimal

from sqlalchemy import (
    String, Text, ForeignKey, Numeric, Integer, Date, DateTime, Boolean,
    Enum as SAEnum, func, JSON, Table, Column, UniqueConstraint
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

# Bảng liên kết nhiều-nhiều giữa Dự án và Thành viên thực hiện
project_members = Table(
    "project_members",
    Base.metadata,
    Column("project_id", Integer, ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True),
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
)


# --------------------------------------------------------------------------
# CÁC KIỂU LIỆT KÊ (ENUM) — chuẩn hóa trạng thái nghiệp vụ
# --------------------------------------------------------------------------
class UserRole(str, enum.Enum):
    ADMIN = "ADMIN"              # Quản trị hệ thống
    DIRECTOR = "DIRECTOR"        # Giám đốc (xem báo cáo, lãi/lỗ)
    MANAGER = "MANAGER"          # Quản lý cấp cao
    MANAGER_MID = "MANAGER_MID"  # Quản lý cấp trung
    ACCOUNTANT = "ACCOUNTANT"    # Kế toán (duyệt hóa đơn, quyết toán)
    FIELD_STAFF = "FIELD_STAFF"  # Cán bộ hiện trường (chụp hóa đơn)


class BidStatus(str, enum.Enum):
    DRAFT = "DRAFT"              # Đang chuẩn bị hồ sơ
    SUBMITTED = "SUBMITTED"      # Đã nộp thầu
    WON = "WON"                  # Trúng thầu -> sinh ra Project
    LOST = "LOST"                # Trượt thầu
    CANCELLED = "CANCELLED"


class ProjectStatus(str, enum.Enum):
    PLANNING = "PLANNING"
    IN_PROGRESS = "IN_PROGRESS"
    ON_HOLD = "ON_HOLD"
    COMPLETED = "COMPLETED"
    CLOSED = "CLOSED"


class ContractStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    ACTIVE = "ACTIVE"
    COMPLETED = "COMPLETED"
    LIQUIDATED = "LIQUIDATED"    # Đã thanh lý


class InvoiceStatus(str, enum.Enum):
    PENDING = "PENDING"          # Vừa upload, chờ OCR
    PROCESSING = "PROCESSING"    # AI đang bóc tách
    EXTRACTED = "EXTRACTED"      # Đã có dữ liệu, chờ kế toán duyệt
    VERIFIED = "VERIFIED"        # Đã duyệt -> tính vào chi phí
    REJECTED = "REJECTED"        # Bị từ chối


class PaymentType(str, enum.Enum):
    ADVANCE = "ADVANCE"          # Tạm ứng
    PROGRESS = "PROGRESS"        # Thanh toán theo tiến độ
    FINAL = "FINAL"              # Quyết toán cuối


class PaymentDirection(str, enum.Enum):
    IN = "IN"                    # Tiền thu về (chủ đầu tư trả cho mình)
    OUT = "OUT"                  # Tiền chi ra (trả NCC/nhà thầu phụ)


class AttendanceSource(str, enum.Enum):
    MANUAL = "MANUAL"            # Tự bấm vào/ra trong app
    MACHINE = "MACHINE"          # Máy chấm công gửi lên
    API = "API"                  # Nguồn API khác


class EvaluationDirection(str, enum.Enum):
    STAFF_TO_MANAGER = "STAFF_TO_MANAGER"   # Nhân viên đánh giá quản lý trực tiếp
    MANAGER_TO_STAFF = "MANAGER_TO_STAFF"   # Quản lý đánh giá nhân viên cấp dưới


class PartnerType(str, enum.Enum):
    INVESTOR = "INVESTOR"          # Chủ đầu tư
    SUPPLIER = "SUPPLIER"          # Nhà cung cấp
    SUBCONTRACTOR = "SUBCONTRACTOR"  # Nhà thầu phụ


class SalaryType(str, enum.Enum):
    MONTHLY = "MONTHLY"           # Lương tháng
    DAILY = "DAILY"               # Lương công nhật (theo ngày công)


# --------------------------------------------------------------------------
# 1. COMPANIES — đơn vị thuê (tenant): công ty hoặc chi nhánh
# --------------------------------------------------------------------------
class Company(Base):
    __tablename__ = "companies"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    code: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    tax_code: Mapped[str | None] = mapped_column(String(20))  # MST công ty
    address: Mapped[str | None] = mapped_column(Text)
    phone: Mapped[str | None] = mapped_column(String(30))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Giám đốc bật để chia sẻ phiếu lương — mỗi nhân viên xem được lương CỦA MÌNH.
    payroll_shared: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    users: Mapped[list["User"]] = relationship(back_populates="company")
    projects: Mapped[list["Project"]] = relationship(back_populates="company")


# --------------------------------------------------------------------------
# 2. USERS — tài khoản người dùng, gắn với một công ty
# --------------------------------------------------------------------------
class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(255))
    hashed_password: Mapped[str] = mapped_column(String(255))
    role: Mapped[UserRole] = mapped_column(SAEnum(UserRole, native_enum=False), default=UserRole.FIELD_STAFF)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # False = tài khoản tự đăng ký bằng Google, đang CHỜ Giám đốc/Quản trị duyệt & phân vị trí.
    is_approved: Mapped[bool] = mapped_column(Boolean, default=True)
    # Tăng 1 mỗi khi đổi/đặt-lại mật khẩu hoặc "đăng xuất mọi thiết bị" -> token cũ
    # (nhúng tv khác) lập tức vô hiệu. Token cũ KHÔNG có claim tv -> coi như 0 (khớp mặc định).
    token_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    phone: Mapped[str | None] = mapped_column(String(30))
    address: Mapped[str | None] = mapped_column(Text)
    dob: Mapped[date | None] = mapped_column(Date)
    identity_card: Mapped[str | None] = mapped_column(String(20))
    cv_details: Mapped[str | None] = mapped_column(Text)
    schedule: Mapped[str | None] = mapped_column(Text)
    department: Mapped[str | None] = mapped_column(String(120))   # bộ phận / phòng ban
    manager_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    manager_ids: Mapped[str | None] = mapped_column(String(255), nullable=True)   # danh sách ID quản lý, vd "2,3,4"
    # Mã nhân viên trên máy chấm công Yunatt (staffNumber, vd "01"). Dùng để ghép
    # dữ liệu quẹt từ Yunatt về đúng người trong ERP khi đồng bộ tự động.
    yunatt_code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # Giờ làm việc CƠ SỞ riêng của nhân viên (dạng "HH:MM", giờ VN) — dùng ĐÁNH GIÁ ĐI MUỘN.
    # NULL = dùng mốc chung của công ty (config WORK_START_HOUR). Cột mới -> ALTER ở _ensure_schema.
    work_start: Mapped[str | None] = mapped_column(String(5))   # giờ vào cơ sở, vd "08:00"
    work_end: Mapped[str | None] = mapped_column(String(5))     # giờ ra cơ sở, vd "17:30"

    # --- Cấu hình lương (NHẠY CẢM: chỉ Giám đốc xem/sửa; KHÔNG trả ra UserOut chung) ---
    # salary_type lưu dạng String ("MONTHLY"/"DAILY") để dễ tự thêm cột (ALTER) trên DB cũ.
    base_salary: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=0)   # lương cơ bản (tháng) hoặc đơn giá ngày
    salary_type: Mapped[str] = mapped_column(String(20), default=SalaryType.MONTHLY.value)
    allowance: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=0)     # phụ cấp/tháng (xăng xe, công trường…)
    num_dependents: Mapped[int] = mapped_column(Integer, default=0)           # số người phụ thuộc (giảm trừ thuế TNCN)

    company: Mapped["Company"] = relationship(back_populates="users")
    manager: Mapped["User | None"] = relationship("User", remote_side=[id], backref="subordinates")
    projects: Mapped[list["Project"]] = relationship("Project", secondary=project_members, back_populates="members")

    @property
    def manager_name(self) -> str | None:
        return self.manager.full_name if self.manager else None


# --------------------------------------------------------------------------
# 3. BIDS — gói thầu đang theo đuổi (đấu thầu)
# --------------------------------------------------------------------------
class Bid(Base):
    __tablename__ = "bids"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    code: Mapped[str] = mapped_column(String(50), index=True)
    name: Mapped[str] = mapped_column(String(255))
    investor: Mapped[str | None] = mapped_column(String(255))   # Chủ đầu tư
    package_value: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=0)  # Giá gói (chưa VAT)
    status: Mapped[BidStatus] = mapped_column(SAEnum(BidStatus), default=BidStatus.DRAFT)
    submit_date: Mapped[date | None] = mapped_column(Date)
    result_date: Mapped[date | None] = mapped_column(Date)
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    project: Mapped["Project | None"] = relationship(back_populates="bid", uselist=False)


# --------------------------------------------------------------------------
# 4. PROJECTS — dự án (thường sinh ra từ một gói thầu trúng)
# --------------------------------------------------------------------------
class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    bid_id: Mapped[int | None] = mapped_column(ForeignKey("bids.id"))  # nguồn gốc thầu
    code: Mapped[str] = mapped_column(String(50), index=True)
    name: Mapped[str] = mapped_column(String(255))
    location: Mapped[str | None] = mapped_column(String(255))
    manager_name: Mapped[str | None] = mapped_column(String(255))
    # グループ (nhóm dự án) — cột mới, ALTER ở _ensure_schema.
    group_name: Mapped[str | None] = mapped_column(String(255))
    # GEO担当 / DOSCO担当 — người phụ trách 2 bên, LƯU TÊN dạng text (GEO bên Nhật
    # thường không có tài khoản; gõ/dán từ Excel). Cột mới -> ALTER ở _ensure_schema.
    geo_manager: Mapped[str | None] = mapped_column(String(255))
    dosco_manager: Mapped[str | None] = mapped_column(String(255))
    # Người CHỦ TRÌ dự án (chỉ huy trưởng) — có toàn quyền quản lý thành viên & tiến độ.
    # Cột trên bảng ĐÃ TỒN TẠI -> phải ALTER ở _ensure_schema (create_all không tự thêm).
    lead_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    status: Mapped[ProjectStatus] = mapped_column(SAEnum(ProjectStatus), default=ProjectStatus.PLANNING)
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    internal_deadline: Mapped[date | None] = mapped_column(Date)
    evaluation: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    company: Mapped["Company"] = relationship(back_populates="projects")
    bid: Mapped["Bid | None"] = relationship(back_populates="project")
    contracts: Mapped[list["Contract"]] = relationship(back_populates="project")
    invoices: Mapped[list["Invoice"]] = relationship(back_populates="project")
    progress_logs: Mapped[list["Progress"]] = relationship(back_populates="project")
    members: Mapped[list["User"]] = relationship("User", secondary=project_members, back_populates="projects")
    lead: Mapped["User | None"] = relationship("User", foreign_keys=[lead_id])

    @property
    def lead_name(self) -> str | None:
        return self.lead.full_name if self.lead else None

    @property
    def lead_department(self) -> str | None:
        return self.lead.department if self.lead else None


# --------------------------------------------------------------------------
# 5. CONTRACTS — hợp đồng thuộc dự án (đây là "Tổng giá trị HD" trên dashboard)
# --------------------------------------------------------------------------
class Contract(Base):
    __tablename__ = "contracts"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    code: Mapped[str] = mapped_column(String(50), index=True)
    name: Mapped[str] = mapped_column(String(255))
    partner: Mapped[str | None] = mapped_column(String(255))     # Bên ký HĐ
    value_no_vat: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=0)  # Giá trị chưa VAT
    vat_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=10)   # %VAT (mặc định 10%)
    status: Mapped[ContractStatus] = mapped_column(SAEnum(ContractStatus), default=ContractStatus.DRAFT)
    sign_date: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    project: Mapped["Project"] = relationship(back_populates="contracts")
    invoices: Mapped[list["Invoice"]] = relationship(back_populates="contract")
    payments: Mapped[list["Payment"]] = relationship(back_populates="contract")

    @property
    def value_with_vat(self) -> Decimal:
        """Giá trị đã gồm VAT."""
        return (self.value_no_vat or Decimal(0)) * (Decimal(1) + (self.vat_percent or Decimal(0)) / Decimal(100))


# --------------------------------------------------------------------------
# 6. INVOICES — hóa đơn chi phí (ngôi sao của hệ thống: ảnh + dữ liệu AI)
# --------------------------------------------------------------------------
class Invoice(Base):
    __tablename__ = "invoices"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id"), index=True)
    contract_id: Mapped[int | None] = mapped_column(ForeignKey("contracts.id"), index=True)
    uploaded_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))

    # --- Ảnh gốc ---
    image_url: Mapped[str | None] = mapped_column(String(512))   # đường dẫn ảnh đã lưu
    original_filename: Mapped[str | None] = mapped_column(String(255))

    # --- Dữ liệu AI bóc tách (OCR) ---
    supplier_name: Mapped[str | None] = mapped_column(String(255))  # Tên NCC
    supplier_tax_code: Mapped[str | None] = mapped_column(String(20))  # MST
    invoice_number: Mapped[str | None] = mapped_column(String(50))
    invoice_date: Mapped[date | None] = mapped_column(Date)
    amount_no_vat: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=0)
    vat_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=0)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=0)
    category: Mapped[str | None] = mapped_column(String(100))      # Hạng mục chi phí
    ocr_raw: Mapped[dict | None] = mapped_column(JSON)             # JSON thô từ AI (đối chiếu)
    ocr_confidence: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))  # Độ tin cậy %

    status: Mapped[InvoiceStatus] = mapped_column(SAEnum(InvoiceStatus), default=InvoiceStatus.PENDING)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    project: Mapped["Project | None"] = relationship(back_populates="invoices")
    contract: Mapped["Contract | None"] = relationship(back_populates="invoices")


# --------------------------------------------------------------------------
# 7. PAYMENTS — đợt thanh toán/quyết toán theo hợp đồng
# --------------------------------------------------------------------------
class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    contract_id: Mapped[int] = mapped_column(ForeignKey("contracts.id"), index=True)
    code: Mapped[str | None] = mapped_column(String(50))
    payment_type: Mapped[PaymentType] = mapped_column(SAEnum(PaymentType), default=PaymentType.PROGRESS)
    direction: Mapped[PaymentDirection] = mapped_column(SAEnum(PaymentDirection), default=PaymentDirection.IN)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=0)
    payment_date: Mapped[date | None] = mapped_column(Date)
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    contract: Mapped["Contract"] = relationship(back_populates="payments")


# --------------------------------------------------------------------------
# 8. PROGRESS — nhật ký tiến độ thi công theo dự án
# --------------------------------------------------------------------------
class Progress(Base):
    __tablename__ = "progress"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    title: Mapped[str] = mapped_column(String(255))               # Tên hạng mục/mốc/việc
    percent_complete: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0)
    planned_date: Mapped[date | None] = mapped_column(Date)
    actual_date: Mapped[date | None] = mapped_column(Date)
    note: Mapped[str | None] = mapped_column(Text)
    # Cột mới cho bảng tiến độ có cấu trúc (ALTER ở _ensure_schema):
    assignee_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)  # người thực hiện
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 3), default=0, server_default="0")  # khối lượng
    status: Mapped[str] = mapped_column(String(20), default="TODO", server_default="TODO")   # TODO/DOING/DONE
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    project: Mapped["Project"] = relationship(back_populates="progress_logs")
    assignee: Mapped["User | None"] = relationship("User", foreign_keys=[assignee_id])

    @property
    def assignee_name(self) -> str | None:
        return self.assignee.full_name if self.assignee else None


# --------------------------------------------------------------------------
# 8b. PROJECT_ITEMS — bảng dự toán/khối lượng (BOQ) chi tiết theo dự án
#     Mô hình 2 cấp: nhóm cha (parent_id = NULL) chứa các đầu việc con.
# --------------------------------------------------------------------------
class ProjectItem(Base):
    __tablename__ = "project_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    # NULL = nhóm hạng mục cha (chương); có giá trị = đầu việc con thuộc nhóm
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("project_items.id", ondelete="CASCADE"), index=True, nullable=True
    )
    order_index: Mapped[int] = mapped_column(Integer, default=0, server_default="0")  # thứ tự hiển thị
    code: Mapped[str | None] = mapped_column(String(50))           # mã hạng mục (tùy chọn)
    name: Mapped[str] = mapped_column(String(500))                 # tên hạng mục / đầu việc
    unit: Mapped[str | None] = mapped_column(String(50))           # đơn vị tính (ĐVT)
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 3), default=0)    # khối lượng
    unit_price: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=0)  # đơn giá
    # % hoàn thành đầu việc (0..100) — dùng tính tiến độ dự án. Cột mới -> ALTER ở _ensure_schema.
    progress: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0, server_default="0")
    # ĐÁNH GIÁ hạng mục: 0 = chưa chấm, 1..5 sao (chủ trì/quản lý chấm). Cột mới -> ALTER ở _ensure_schema.
    rating: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # Phòng ban phụ trách hạng mục (gán ở cấp NHÓM cha; đầu việc con hiểu ngầm theo nhóm).
    # Cột mới -> ALTER ở _ensure_schema.
    department: Mapped[str | None] = mapped_column(String(120))
    # NGƯỜI ĐƯỢC GIAO đầu việc (giao việc cho ai) — để bảng Tiến độ sổ ra đầu việc theo
    # từng người. Gán ở cấp đầu việc con. Cột mới -> ALTER ở _ensure_schema.
    assignee_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    note: Mapped[str | None] = mapped_column(Text)
    # HẠN NỘP (deadline) của hạng mục/đầu việc. Cột mới -> ALTER ở _ensure_schema.
    due_date: Mapped[date | None] = mapped_column(Date)
    # NGÀY HOÀN THÀNH — người làm đánh dấu xong. NULL = chưa xong. So với due_date để biết
    # nộp đúng hạn (xanh) hay trễ hạn (đỏ). Cột mới -> ALTER ở _ensure_schema.
    done_date: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    assignee: Mapped["User | None"] = relationship("User", foreign_keys=[assignee_id])

    @property
    def amount(self) -> Decimal:
        """Thành tiền của một đầu việc = khối lượng × đơn giá (nhóm cha tự cộng ở tầng trên)."""
        return (self.quantity or Decimal(0)) * (self.unit_price or Decimal(0))

    @property
    def assignee_name(self) -> str | None:
        return self.assignee.full_name if self.assignee else None


class ProjectItemRating(Base):
    __tablename__ = "project_item_ratings"
    __table_args__ = (
        UniqueConstraint(
            "project_item_id", "user_id", name="uq_proj_item_user_rating"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    project_item_id: Mapped[int] = mapped_column(
        ForeignKey("project_items.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    rating: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    project_item: Mapped["ProjectItem"] = relationship("ProjectItem")
    user: Mapped["User"] = relationship("User")


# --------------------------------------------------------------------------
# 8c. PROGRESS_SNAPSHOTS — ẢNH CHỤP % tiến độ theo NGÀY (để dựng đường tiến độ).
#     1 dòng / (dự án, ngày, phòng ban). department = "" nghĩa là TOÀN DỰ ÁN.
#     Ghi khi có người đổi % (upsert theo ngày) + khi mở biểu đồ (chốt điểm hôm nay)
#     -> theo dõi được từng ngày nhân sự/phòng làm tới đâu, mất bao lâu để xong.
# --------------------------------------------------------------------------
class ProgressSnapshot(Base):
    __tablename__ = "progress_snapshots"
    __table_args__ = (
        UniqueConstraint("project_id", "snap_date", "department", name="uq_progress_snap"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    snap_date: Mapped[date] = mapped_column(Date, index=True)     # ngày chụp (giờ VN)
    department: Mapped[str] = mapped_column(String(120), default="", server_default="")  # "" = toàn dự án
    percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0)  # % hoàn thành tại ngày đó
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


# --------------------------------------------------------------------------
# 9. ACTIVITY_LOGS — vết kiểm toán (ai làm gì, lúc nào)
# --------------------------------------------------------------------------
class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String(100))              # vd: "invoice.verify"
    entity_type: Mapped[str | None] = mapped_column(String(50))
    entity_id: Mapped[int | None] = mapped_column(Integer)
    detail: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    user: Mapped["User | None"] = relationship("User")

    @property
    def user_name(self) -> str | None:
        return self.user.full_name if self.user else None


# --------------------------------------------------------------------------
# 10. ATTENDANCE — chấm công (1 bản ghi / người / ngày)
#     Ghi giờ vào & ra để đánh giá hiệu quả và quản lý ra/vào công ty.
#     Nguồn: nhân viên tự bấm trong app, hoặc máy chấm công gửi lên qua API.
# --------------------------------------------------------------------------
class Attendance(Base):
    __tablename__ = "attendance"
    # Mỗi người chỉ có 1 bản ghi/ngày -> chống tạo bản ghi trùng (đếm công/lương sai).
    __table_args__ = (UniqueConstraint("user_id", "work_date", name="uq_attendance_user_day"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    work_date: Mapped[date] = mapped_column(Date, index=True)     # ngày làm việc
    check_in: Mapped[datetime | None] = mapped_column(DateTime)   # giờ vào
    check_out: Mapped[datetime | None] = mapped_column(DateTime)  # giờ ra
    source: Mapped[AttendanceSource] = mapped_column(SAEnum(AttendanceSource), default=AttendanceSource.MANUAL)
    device_id: Mapped[str | None] = mapped_column(String(100))    # mã máy chấm công (nếu có)
    is_late_override: Mapped[bool | None] = mapped_column(Boolean, nullable=True, default=None)  # đè trạng thái trễ (True/False/None)
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    user: Mapped["User"] = relationship("User")

    @property
    def user_name(self) -> str | None:
        return self.user.full_name if self.user else None

    @property
    def worked_minutes(self) -> int:
        """Số phút đã làm = giờ ra − giờ vào (0 nếu thiếu mốc)."""
        if self.check_in and self.check_out and self.check_out > self.check_in:
            return int((self.check_out - self.check_in).total_seconds() // 60)
        return 0

    @property
    def is_late(self) -> bool:
        """Đi trễ nếu giờ VÀO muộn hơn giờ làm CƠ SỞ của nhân viên (work_start "HH:MM").
        Nhân viên chưa đặt riêng thì dùng mốc chung của công ty (config WORK_START_HOUR).
        Đúng giờ (bằng mốc) KHÔNG tính muộn. Cho phép cấp cao đè trạng thái (is_late_override)."""
        if self.is_late_override is not None:
            return self.is_late_override
        if not self.check_in:
            return False
        if self.work_date.weekday() == 6:  # 6 = Chủ Nhật
            return False
        from app.config import settings
        start_min = settings.WORK_START_HOUR * 60
        ws = getattr(self.user, "work_start", None) if self.user else None
        if ws:
            try:
                hh, mm = ws.split(":")
                start_min = int(hh) * 60 + int(mm)
            except (ValueError, TypeError):
                pass
        return self.check_in.hour * 60 + self.check_in.minute > start_min

    @property
    def work_credit(self) -> Decimal:
        """CÔNG của ngày theo 2 CA (0.5 công/ca).
        Ca sáng 08:00–11:45, ca chiều 13:30–17:00. Làm cả 2 ca = 1.0, chỉ 1 ca = 0.5.
        - Có mặt buổi SÁNG   = giờ VÀO ở/ trước mốc hết ca sáng (MORNING_END_MIN).
        - Có mặt buổi CHIỀU  = giờ RA ở/ sau mốc vào ca chiều (AFTERNOON_START_MIN);
          nếu thiếu giờ ra thì suy theo giờ vào (vào buổi chiều -> tính chiều).
        Có chấm vào nhưng không rơi vào ca nào -> tính tối thiểu 0.5 (không để mất công)."""
        if not self.check_in:
            return Decimal(0)
        from app.config import settings
        ci = self.check_in.hour * 60 + self.check_in.minute
        worked_morning = ci <= settings.MORNING_END_MIN
        if self.check_out:
            co = self.check_out.hour * 60 + self.check_out.minute
            worked_afternoon = co >= settings.AFTERNOON_START_MIN
        else:
            worked_afternoon = ci >= settings.AFTERNOON_START_MIN
        credit = Decimal("0.5") * (worked_morning + worked_afternoon)
        return credit if credit > 0 else Decimal("0.5")


class YunattSyncLog(Base):
    """
    Nhật ký MỖI LẦN đồng bộ chấm công từ Yunatt (tự động 20:00 hoặc bấm tay).

    Mục đích: cho Ban Giám đốc THẤY được lần đồng bộ gần nhất đã chạy chưa, kết quả
    ra sao, có lỗi (sai mật khẩu Yunatt / Yunatt đổi giao diện) hay còn người chưa
    ghép hay không — vì job 20:00 chạy ngầm, trước đây chỉ ghi ra log server.
    """
    __tablename__ = "yunatt_sync_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    ran_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
    ok: Mapped[bool] = mapped_column(Boolean, default=True)        # True = đồng bộ thành công
    trigger: Mapped[str] = mapped_column(String(10), default="manual")  # "auto" (lịch) / "manual"
    months: Mapped[str | None] = mapped_column(String(120))        # các tháng đã kéo, vd "2026-05, 2026-06"
    rows: Mapped[int] = mapped_column(Integer, default=0)
    matched: Mapped[int] = mapped_column(Integer, default=0)
    days_updated: Mapped[int] = mapped_column(Integer, default=0)
    days_no_checkout: Mapped[int] = mapped_column(Integer, default=0)
    unmatched_count: Mapped[int] = mapped_column(Integer, default=0)
    message: Mapped[str | None] = mapped_column(Text)             # nội dung lỗi (nếu ok=False)


# --------------------------------------------------------------------------
# 11. EVALUATIONS — đánh giá 2 chiều giữa nhân viên ↔ quản lý trực tiếp
#     Mỗi kỳ (period "YYYY-MM") một người chấm một người: điểm 1–5 + nhận xét.
# --------------------------------------------------------------------------
class Evaluation(Base):
    __tablename__ = "evaluations"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    period: Mapped[str] = mapped_column(String(20), index=True)   # tuần = ngày Thứ 7 "YYYY-MM-DD" (tự suy từ eval_date)
    # Ngày đánh giá cụ thể + dự án (tùy chọn) — chấm THEO TỪNG NGÀY & TỪNG DỰ ÁN,
    # rồi TỔNG HỢP THEO TUẦN qua cột period. Cột mới -> ALTER ở _ensure_schema.
    eval_date: Mapped[date | None] = mapped_column(Date, index=True)
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), nullable=True)
    evaluator_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)  # người chấm
    evaluatee_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)  # người được chấm
    direction: Mapped[EvaluationDirection] = mapped_column(SAEnum(EvaluationDirection))
    rating: Mapped[int] = mapped_column(Integer, default=0)       # 1–5 sao
    comment: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    evaluator: Mapped["User"] = relationship("User", foreign_keys=[evaluator_id])
    evaluatee: Mapped["User"] = relationship("User", foreign_keys=[evaluatee_id])
    project: Mapped["Project | None"] = relationship("Project", foreign_keys=[project_id])

    @property
    def project_name(self) -> str | None:
        return self.project.name if self.project else None

    @property
    def evaluator_name(self) -> str | None:
        return self.evaluator.full_name if self.evaluator else None

    @property
    def evaluatee_name(self) -> str | None:
        return self.evaluatee.full_name if self.evaluatee else None


# --------------------------------------------------------------------------
# 11b. PROJECT_EVALUATIONS — đánh giá CHÉO 360° trong MỘT DỰ ÁN.
#     Mọi thành viên (gồm chủ trì) chấm lẫn nhau: 1 phiếu/người/dự án (ghi đè
#     khi chấm lại), điểm 1–5 sao + nhận xét. Khác Evaluation (đánh giá TUẦN
#     theo quan hệ quản lý): bảng này gắn project_id, KHÔNG có chiều & kỳ.
# --------------------------------------------------------------------------
class ProjectEvaluation(Base):
    __tablename__ = "project_evaluations"
    __table_args__ = (
        UniqueConstraint(
            "project_id", "evaluator_id", "evaluatee_id", name="uq_proj_eval"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    evaluator_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)  # người chấm
    evaluatee_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)  # người được chấm
    rating: Mapped[int] = mapped_column(Integer, default=0)   # 1–5 sao
    comment: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    evaluator: Mapped["User"] = relationship("User", foreign_keys=[evaluator_id])
    evaluatee: Mapped["User"] = relationship("User", foreign_keys=[evaluatee_id])

    @property
    def evaluator_name(self) -> str | None:
        return self.evaluator.full_name if self.evaluator else None

    @property
    def evaluatee_name(self) -> str | None:
        return self.evaluatee.full_name if self.evaluatee else None


# --------------------------------------------------------------------------
# 12. PARTNERS — danh mục đối tác: Chủ đầu tư / Nhà cung cấp / Nhà thầu phụ
#     (NHẠY CẢM: chỉ Giám đốc/Quản trị quản lý — gắn công nợ về sau)
# --------------------------------------------------------------------------
class Partner(Base):
    __tablename__ = "partners"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    type: Mapped[PartnerType] = mapped_column(SAEnum(PartnerType), index=True)
    name: Mapped[str] = mapped_column(String(255))
    tax_code: Mapped[str | None] = mapped_column(String(20))      # MST
    contact_person: Mapped[str | None] = mapped_column(String(255))
    phone: Mapped[str | None] = mapped_column(String(30))
    email: Mapped[str | None] = mapped_column(String(255))
    address: Mapped[str | None] = mapped_column(Text)
    note: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


# --------------------------------------------------------------------------
# 13. PAYROLL — bảng lương theo kỳ (tính từ chấm công)
#     (NHẠY CẢM: chỉ Giám đốc/Quản trị)
# --------------------------------------------------------------------------
class Payroll(Base):
    __tablename__ = "payroll"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    period: Mapped[str] = mapped_column(String(7), index=True)    # "YYYY-MM"
    working_days: Mapped[Decimal] = mapped_column(Numeric(6, 2), default=0)   # ngày công thực tế
    base_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=0)   # lương theo công
    allowance: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=0)     # phụ cấp
    gross: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=0)         # tổng thu nhập
    insurance: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=0)     # BHXH+BHYT+BHTN (NV đóng 10.5%)
    personal_income_tax: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=0)  # thuế TNCN
    net: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=0)           # thực nhận
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    user: Mapped["User"] = relationship("User")

    @property
    def user_name(self) -> str | None:
        return self.user.full_name if self.user else None


# Enums cho các module Đợt 2/3
class LeaveStatus(str, enum.Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


# --------------------------------------------------------------------------
# 14. LEAVE_REQUESTS — đơn nghỉ phép/nghỉ ốm, duyệt theo cấp quản lý
# --------------------------------------------------------------------------
class LeaveRequest(Base):
    __tablename__ = "leave_requests"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    from_date: Mapped[date] = mapped_column(Date)
    to_date: Mapped[date] = mapped_column(Date)
    leave_type: Mapped[str | None] = mapped_column(String(50), default="FULL")
    reason: Mapped[str | None] = mapped_column(Text)
    status: Mapped[LeaveStatus] = mapped_column(SAEnum(LeaveStatus), default=LeaveStatus.PENDING)
    decided_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    user: Mapped["User"] = relationship("User", foreign_keys=[user_id])

    @property
    def user_name(self) -> str | None:
        return self.user.full_name if self.user else None

    @property
    def days(self) -> float:
        if not (self.from_date and self.to_date):
            return 0
        diff = (self.to_date - self.from_date).days + 1
        if diff == 1 and self.leave_type in ("MORNING", "AFTERNOON"):
            return 0.5
        return float(diff)


# --------------------------------------------------------------------------
# 16. EQUIPMENT + EQUIPMENT_LOGS — sổ thiết bị/máy móc & nhật ký điều động
# --------------------------------------------------------------------------
class Equipment(Base):
    __tablename__ = "equipment"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    code: Mapped[str | None] = mapped_column(String(50))
    name: Mapped[str] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(20), default="IDLE")   # IDLE/IN_USE/MAINTENANCE
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class EquipmentLog(Base):
    __tablename__ = "equipment_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    equipment_id: Mapped[int] = mapped_column(ForeignKey("equipment.id"), index=True)
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id"))
    log_date: Mapped[date | None] = mapped_column(Date)
    hours_used: Mapped[Decimal] = mapped_column(Numeric(8, 1), default=0)
    fuel: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)     # nhiên liệu (lít)
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    equipment: Mapped["Equipment"] = relationship("Equipment")
    project: Mapped["Project | None"] = relationship("Project")

    @property
    def equipment_name(self) -> str | None:
        return self.equipment.name if self.equipment else None

    @property
    def project_name(self) -> str | None:
        return self.project.name if self.project else None


class DesignPhase(str, enum.Enum):
    SURVEY = "SURVEY"          # Khảo sát
    BASIC = "BASIC"            # Thiết kế cơ sở
    TECHNICAL = "TECHNICAL"    # Thiết kế kỹ thuật
    SHOP = "SHOP"              # Bản vẽ thi công (BVTC)


class DesignDocStatus(str, enum.Enum):
    DRAFT = "DRAFT"            # Nháp
    SUBMITTED = "SUBMITTED"    # Đã trình CĐT
    REVIEWING = "REVIEWING"    # Đang thẩm tra/thẩm định
    APPROVED = "APPROVED"      # Đã phê duyệt
    REVISE = "REVISE"          # Yêu cầu sửa


# --------------------------------------------------------------------------
# 18. DESIGN_DOCUMENTS — hồ sơ thiết kế & bản vẽ (đặc thù cty thiết kế cầu đường)
#     Theo giai đoạn TK (khảo sát/cơ sở/kỹ thuật/BVTC) + phiên bản + trạng thái duyệt.
# --------------------------------------------------------------------------
class DesignDocument(Base):
    __tablename__ = "design_documents"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    phase: Mapped[DesignPhase] = mapped_column(SAEnum(DesignPhase), index=True)
    code: Mapped[str | None] = mapped_column(String(80))        # mã bản vẽ/hồ sơ
    name: Mapped[str] = mapped_column(String(500))              # tên hồ sơ/bản vẽ
    discipline: Mapped[str | None] = mapped_column(String(100))  # bộ môn: Cầu/Đường/Thủy văn/ATGT…
    version: Mapped[str | None] = mapped_column(String(30))     # phiên bản: Rev.A/B/C
    status: Mapped[DesignDocStatus] = mapped_column(SAEnum(DesignDocStatus), default=DesignDocStatus.DRAFT)
    file_url: Mapped[str | None] = mapped_column(String(1000))  # link file (Drive/cloud) DWG/RVT/PDF
    note: Mapped[str | None] = mapped_column(Text)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    project: Mapped["Project"] = relationship("Project")
    created_by: Mapped["User | None"] = relationship("User", foreign_keys=[created_by_id])

    @property
    def project_name(self) -> str | None:
        return self.project.name if self.project else None

    @property
    def created_by_name(self) -> str | None:
        return self.created_by.full_name if self.created_by else None


# --------------------------------------------------------------------------
# 19. NOTIFICATIONS — thông báo nội bộ (Giám đốc↔Quản lý↔Nhân viên)
# --------------------------------------------------------------------------
class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    sender_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    recipient_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(255))
    body: Mapped[str | None] = mapped_column(Text)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    sender: Mapped["User | None"] = relationship("User", foreign_keys=[sender_id])

    @property
    def sender_name(self) -> str | None:
        return self.sender.full_name if self.sender else None


# --------------------------------------------------------------------------
# 20. ASSIGNMENTS — phân công việc / giao dự án (Giám đốc→Quản lý→Nhân viên)
# --------------------------------------------------------------------------
class Assignment(Base):
    __tablename__ = "assignments"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    assigner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    assignee_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id"))
    title: Mapped[str] = mapped_column(String(500))
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="ASSIGNED")  # ASSIGNED/IN_PROGRESS/DONE
    # Mốc thời gian để đo "làm trong bao lâu" — hệ thống TỰ đóng dấu khi đổi trạng thái
    # (bắt đầu làm / hoàn thành). Cột mới -> ALTER ở _ensure_schema.
    started_at: Mapped[datetime | None] = mapped_column(DateTime)
    done_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    assigner: Mapped["User"] = relationship("User", foreign_keys=[assigner_id])
    assignee: Mapped["User"] = relationship("User", foreign_keys=[assignee_id])
    project: Mapped["Project | None"] = relationship("Project")

    @property
    def assigner_name(self) -> str | None:
        return self.assigner.full_name if self.assigner else None

    @property
    def assignee_name(self) -> str | None:
        return self.assignee.full_name if self.assignee else None

    @property
    def project_name(self) -> str | None:
        return self.project.name if self.project else None


# --------------------------------------------------------------------------
# 21. NICKNAMES — biệt danh RIÊNG TƯ (chỉ người đặt nhìn thấy)
#     1 dòng = owner đặt biệt danh cho target. Mỗi (owner,target) tối đa 1 dòng.
# --------------------------------------------------------------------------
class Nickname(Base):
    __tablename__ = "nicknames"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)    # người đặt
    target_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)   # người được đặt
    nickname: Mapped[str] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


# --------------------------------------------------------------------------
# CHAT — nhắn tin nội bộ (1-1 & nhóm). Độc lập với NOTIFICATIONS.
# --------------------------------------------------------------------------
class ConversationType(str, enum.Enum):
    DIRECT = "DIRECT"   # 1-1
    GROUP = "GROUP"     # nhóm nhiều người


# --------------------------------------------------------------------------
# 22. CONVERSATIONS — phòng chat (1-1 hoặc nhóm), cô lập theo company
# --------------------------------------------------------------------------
class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    type: Mapped[ConversationType] = mapped_column(SAEnum(ConversationType), default=ConversationType.DIRECT)
    title: Mapped[str | None] = mapped_column(String(255))     # tên nhóm (DIRECT để NULL, hiển thị theo người kia)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    # dedup 1-1: cặp uid nhỏ:uid lớn "12:45"; NULL với nhóm. UNIQUE ở _ensure_schema.
    direct_key: Mapped[str | None] = mapped_column(String(40), index=True)
    # Nhóm chat GẮN với 1 dự án (get-or-create ở /chat/project/{id}); NULL với phòng thường.
    # Cột trên bảng ĐÃ TỒN TẠI -> phải ALTER ở _ensure_schema.
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id"), index=True, nullable=True)
    # để sort danh sách phòng theo tin mới nhất mà không JOIN nặng
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    members: Mapped[list["ConversationMember"]] = relationship(back_populates="conversation")


# --------------------------------------------------------------------------
# 23. CONVERSATION_MEMBERS — thành viên phòng + con trỏ đã đọc
# --------------------------------------------------------------------------
class ConversationMember(Base):
    __tablename__ = "conversation_members"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    # tin cuối đã đọc -> tính unread = COUNT(messages.id > last_read_message_id)
    last_read_message_id: Mapped[int | None] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    conversation: Mapped["Conversation"] = relationship(back_populates="members")
    user: Mapped["User"] = relationship("User")

    @property
    def user_name(self) -> str | None:
        return self.user.full_name if self.user else None


# --------------------------------------------------------------------------
# 24. CHAT_MESSAGES — tin nhắn trong phòng
# --------------------------------------------------------------------------
class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), index=True
    )
    sender_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)

    sender: Mapped["User | None"] = relationship("User", foreign_keys=[sender_id])

    @property
    def sender_name(self) -> str | None:
        return self.sender.full_name if self.sender else None


# --------------------------------------------------------------------------
# 25. MESSAGE_REACTIONS — cảm xúc (emoji) trên tin nhắn; mỗi người 1 emoji/tin
# --------------------------------------------------------------------------
class MessageReaction(Base):
    __tablename__ = "message_reactions"
    __table_args__ = (
        UniqueConstraint("message_id", "user_id", name="uq_reaction_msg_user"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    message_id: Mapped[int] = mapped_column(
        ForeignKey("chat_messages.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    emoji: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


# --------------------------------------------------------------------------
# 27. TIMESHEETS — GIỜ LÀM THỰC TẾ mỗi người khai cho từng dự án theo NGÀY.
#     1 dòng = (người, dự án, ngày) -> số giờ. Dùng dựng bảng Nhân công theo ngày
#     (Dự án × Ngày = tổng giờ) để kiểm soát dự án từng ngày.
# --------------------------------------------------------------------------
class Timesheet(Base):
    __tablename__ = "timesheets"
    # 1 dòng = (người, dự án, ĐẦU VIỆC, ngày). project_item_id NULL = giờ ở cấp dự án
    # (không gắn đầu việc). Dedup do router (find-then-upsert) đảm nhiệm — không dùng
    # UNIQUE cứng để tránh vướng NULL (nhiều đầu việc / ngày phải cho phép).

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    # Đầu việc (project_items) — kéo hạng mục/đầu việc sang bảng tiến độ để điền giờ.
    project_item_id: Mapped[int | None] = mapped_column(
        ForeignKey("project_items.id", ondelete="CASCADE"), index=True, nullable=True
    )
    work_date: Mapped[date] = mapped_column(Date, index=True)
    hours: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0)   # giờ thực tế đã làm
    note: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    user: Mapped["User"] = relationship("User")
    project: Mapped["Project"] = relationship("Project")

    @property
    def user_name(self) -> str | None:
        return self.user.full_name if self.user else None

    @property
    def project_name(self) -> str | None:
        return self.project.name if self.project else None

    @property
    def project_code(self) -> str | None:
        return self.project.code if self.project else None


# --------------------------------------------------------------------------
# 26. DEPARTMENTS — danh mục PHÒNG BAN của công ty (nguồn chân lý cho danh sách).
#     Trước đây phòng ban là hằng số cứng ở frontend; bảng này cho Admin/Giám đốc
#     TỰ thêm phòng mới (kể cả phòng chưa có ai) và ĐỔI TÊN phòng. Việc gán người
#     vào phòng vẫn lưu dạng chuỗi ở users.department (nhiều phòng ngăn bởi dấu phẩy);
#     khi đổi tên, router cascade cập nhật các chuỗi tham chiếu để không "mồ côi".
# --------------------------------------------------------------------------
class Department(Base):
    __tablename__ = "departments"
    __table_args__ = (
        UniqueConstraint("company_id", "name", name="uq_department_company_name"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    order_index: Mapped[int] = mapped_column(Integer, default=0, server_default="0")  # thứ tự hiển thị
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
