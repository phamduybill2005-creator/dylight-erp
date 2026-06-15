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
    Enum as SAEnum, func, JSON, Table, Column
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
    MANAGER = "MANAGER"          # Chỉ huy trưởng / quản lý dự án
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
    role: Mapped[UserRole] = mapped_column(SAEnum(UserRole), default=UserRole.FIELD_STAFF)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    phone: Mapped[str | None] = mapped_column(String(30))
    address: Mapped[str | None] = mapped_column(Text)
    dob: Mapped[date | None] = mapped_column(Date)
    identity_card: Mapped[str | None] = mapped_column(String(20))
    cv_details: Mapped[str | None] = mapped_column(Text)
    schedule: Mapped[str | None] = mapped_column(Text)
    manager_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

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
    status: Mapped[ProjectStatus] = mapped_column(SAEnum(ProjectStatus), default=ProjectStatus.PLANNING)
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    company: Mapped["Company"] = relationship(back_populates="projects")
    bid: Mapped["Bid | None"] = relationship(back_populates="project")
    contracts: Mapped[list["Contract"]] = relationship(back_populates="project")
    invoices: Mapped[list["Invoice"]] = relationship(back_populates="project")
    progress_logs: Mapped[list["Progress"]] = relationship(back_populates="project")
    members: Mapped[list["User"]] = relationship("User", secondary=project_members, back_populates="projects")


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
    title: Mapped[str] = mapped_column(String(255))               # Tên hạng mục/mốc
    percent_complete: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0)
    planned_date: Mapped[date | None] = mapped_column(Date)
    actual_date: Mapped[date | None] = mapped_column(Date)
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    project: Mapped["Project"] = relationship(back_populates="progress_logs")


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
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    @property
    def amount(self) -> Decimal:
        """Thành tiền của một đầu việc = khối lượng × đơn giá (nhóm cha tự cộng ở tầng trên)."""
        return (self.quantity or Decimal(0)) * (self.unit_price or Decimal(0))


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


# --------------------------------------------------------------------------
# 10. ATTENDANCE — chấm công (1 bản ghi / người / ngày)
#     Ghi giờ vào & ra để đánh giá hiệu quả và quản lý ra/vào công ty.
#     Nguồn: nhân viên tự bấm trong app, hoặc máy chấm công gửi lên qua API.
# --------------------------------------------------------------------------
class Attendance(Base):
    __tablename__ = "attendance"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    work_date: Mapped[date] = mapped_column(Date, index=True)     # ngày làm việc
    check_in: Mapped[datetime | None] = mapped_column(DateTime)   # giờ vào
    check_out: Mapped[datetime | None] = mapped_column(DateTime)  # giờ ra
    source: Mapped[AttendanceSource] = mapped_column(SAEnum(AttendanceSource), default=AttendanceSource.MANUAL)
    device_id: Mapped[str | None] = mapped_column(String(100))    # mã máy chấm công (nếu có)
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
        """Đi trễ nếu giờ vào muộn hơn mốc bắt đầu làm việc (config WORK_START_HOUR)."""
        from app.config import settings
        if not self.check_in:
            return False
        return self.check_in.hour >= settings.WORK_START_HOUR and not (
            self.check_in.hour == settings.WORK_START_HOUR and self.check_in.minute == 0
        )


# --------------------------------------------------------------------------
# 11. EVALUATIONS — đánh giá 2 chiều giữa nhân viên ↔ quản lý trực tiếp
#     Mỗi kỳ (period "YYYY-MM") một người chấm một người: điểm 1–5 + nhận xét.
# --------------------------------------------------------------------------
class Evaluation(Base):
    __tablename__ = "evaluations"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    period: Mapped[str] = mapped_column(String(7), index=True)    # "YYYY-MM"
    evaluator_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)  # người chấm
    evaluatee_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)  # người được chấm
    direction: Mapped[EvaluationDirection] = mapped_column(SAEnum(EvaluationDirection))
    rating: Mapped[int] = mapped_column(Integer, default=0)       # 1–5 sao
    comment: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    evaluator: Mapped["User"] = relationship("User", foreign_keys=[evaluator_id])
    evaluatee: Mapped["User"] = relationship("User", foreign_keys=[evaluatee_id])

    @property
    def evaluator_name(self) -> str | None:
        return self.evaluator.full_name if self.evaluator else None

    @property
    def evaluatee_name(self) -> str | None:
        return self.evaluatee.full_name if self.evaluatee else None
