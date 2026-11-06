"""Contracts for derived AM/PM attendance and explicit administrative decisions."""
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

SessionName = Literal["AM", "PM"]
PermissionDecision = Literal["EXCUSED_LATE", "EXCUSED_ABSENCE"]
SessionStatus = Literal[
    "PRESENT", "EXCUSED_ABSENCE", "UNEXCUSED_ABSENCE", "EXCUSED_LATE",
    "UNEXCUSED_LATE", "PENDING_APPROVAL", "NEEDS_REVIEW", "WAITING_DATA",
    "NOT_SCHEDULED", "NOT_FINISHED",
]


class AttendancePermissionWrite(BaseModel):
    user_id: int = Field(gt=0)
    work_date: date
    session: SessionName
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
    needs_attention: bool


class AttendanceReconciliationOut(BaseModel):
    rows: list[AttendanceReconciliationDay]
    confirmations: list[AttendanceCoverageOut]
    confirmation_available: dict[SessionName, bool]
