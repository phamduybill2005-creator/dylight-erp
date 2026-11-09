"""Contracts for derived AM/PM attendance and explicit administrative decisions."""
from datetime import date, datetime, timedelta, timezone
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

SessionName = Literal["AM", "PM"]
PermissionDecision = Literal["EXCUSED_LATE", "EXCUSED_ABSENCE", "EXCUSED_EARLY", "EXCUSED_LATE_EARLY"]
SessionStatus = Literal[
    "PRESENT", "EXCUSED_ABSENCE", "UNEXCUSED_ABSENCE", "EXCUSED_LATE",
    "UNEXCUSED_LATE", "PENDING_APPROVAL", "NEEDS_REVIEW", "WAITING_DATA",
    "NOT_SCHEDULED", "NOT_FINISHED",
]


class AttendancePermissionFields(BaseModel):
    user_id: int = Field(gt=0)
    work_date: date
    decision: PermissionDecision | None
    reason: str = Field(min_length=1, max_length=2000)
    approved_by: str = Field(default="", max_length=255)

    @field_validator("reason", "approved_by")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def require_basis(self):
        if not self.reason or (self.decision is not None and not self.approved_by):
            raise ValueError("Phải nhập lý do và người đã đồng ý cho phép.")
        return self


class AttendancePermissionWrite(AttendancePermissionFields):
    session: SessionName


class AttendanceDayPermissionWrite(AttendancePermissionFields):
    sessions: list[SessionName] = Field(min_length=1, max_length=2)

    @field_validator("sessions")
    @classmethod
    def unique_sessions(cls, value):
        if len(set(value)) != len(value):
            raise ValueError("Không chọn trùng buổi.")
        return sorted(value)


class AttendanceCoverageWrite(BaseModel):
    work_date: date
    session: SessionName
    reason: str = Field(min_length=1, max_length=2000)

    @field_validator("reason")
    @classmethod
    def require_reason(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Phải nhập căn cứ xác nhận dữ liệu.")
        return value.strip()


class AttendancePermissionOut(BaseModel):
    decision: PermissionDecision
    reason: str
    approved_by: str
    recorded_by: str
    updated_at: datetime


class AttendanceForgotPunchWrite(BaseModel):
    user_id: int = Field(gt=0)
    work_date: date
    punch: Literal["IN", "OUT"]
    decision: Literal["FORGOT"] | None
    reported_at: datetime | None = None
    reason: str = Field(min_length=1, max_length=2000)
    approved_by: str = Field(min_length=1, max_length=255)

    @field_validator("reason", "approved_by")
    @classmethod
    def require_basis(cls, value):
        if not value.strip():
            raise ValueError("Phải nhập lý do và người xác nhận.")
        return value.strip()

    @field_validator("reported_at")
    @classmethod
    def vietnam_local(cls, value):
        if value is not None and value.tzinfo is not None:
            return value.astimezone(timezone(timedelta(hours=7))).replace(tzinfo=None)
        return value

    @model_validator(mode="after")
    def report_not_before_workday(self):
        if self.reported_at and self.reported_at.date() < self.work_date:
            raise ValueError("Thời điểm báo không được trước ngày làm việc.")
        return self


class AttendanceForgotPunchOut(BaseModel):
    punch: Literal["IN", "OUT"]
    decision: Literal["FORGOT"]
    reported_at: datetime | None = None
    reason: str
    approved_by: str
    recorded_by: str
    updated_at: datetime


class AttendanceCoverageOut(BaseModel):
    work_date: date
    session: SessionName
    confirmed_by: str
    confirmed_at: datetime
    reason: str


class AttendanceSessionOut(BaseModel):
    session: SessionName
    status: SessionStatus
    late_minutes: int = 0
    early_status: Literal["EXCUSED_EARLY", "UNEXCUSED_EARLY"] | None = None
    early_minutes: int = 0
    explanation: str
    leave_id: int | None = None
    permission_source: Literal["LEAVE", "ADMIN"] | None = None
    override: AttendancePermissionOut | None = None
    data_confirmed: bool = False


class AttendanceReconciliationDay(BaseModel):
    user_id: int
    full_name: str
    department: str | None = None
    work_date: date
    attendance_id: int | None = None
    check_in: datetime | None = None
    check_out: datetime | None = None
    morning: AttendanceSessionOut
    afternoon: AttendanceSessionOut
    forgot_punches: list[AttendanceForgotPunchOut] = Field(default_factory=list)
    needs_attention: bool
    can_edit_permission: bool = True


class AttendanceReconciliationOut(BaseModel):
    rows: list[AttendanceReconciliationDay]
    confirmations: list[AttendanceCoverageOut]
    confirmation_available: dict[SessionName, bool]
