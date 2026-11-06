import type { AttendancePermissionDecision, AttendancePermissionPayload, AttendanceReconciliationRow, AttendanceSessionResult, LeaveRequest, ReconciliationStatus } from "./types";

export const RECONCILIATION_LABELS: Record<ReconciliationStatus, string> = {
  PRESENT: "Có mặt", EXCUSED_ABSENCE: "Nghỉ có phép", UNEXCUSED_ABSENCE: "Nghỉ không phép",
  EXCUSED_LATE: "Muộn có phép", UNEXCUSED_LATE: "Muộn không phép", PENDING_APPROVAL: "Chờ duyệt đơn",
  NEEDS_REVIEW: "Cần kiểm tra", WAITING_DATA: "Chờ đủ dữ liệu", NOT_SCHEDULED: "Không có lịch làm", NOT_FINISHED: "Chưa hết ca",
};

export type ReconciliationFilters = { department: string; status: ReconciliationStatus | ""; attentionOnly: boolean };
export function filterReconciliationRows(rows: AttendanceReconciliationRow[], filters: ReconciliationFilters) {
  return rows.filter(row => (!filters.department || (row.department || "").split(",").map(d => d.trim()).includes(filters.department))
    && (!filters.status || row.morning.status === filters.status || row.afternoon.status === filters.status)
    && (!filters.attentionOnly || row.needs_attention));
}

export function sessionBasis(result: AttendanceSessionResult): string {
  if (result.permission_source === "ADMIN") return "Xác nhận của quản trị";
  if (result.permission_source === "LEAVE") return "Đơn đã duyệt";
  if (result.status === "PENDING_APPROVAL" && result.leave_id !== null) return "Đơn chờ duyệt";
  if (result.status === "NOT_SCHEDULED") return "Lịch làm việc / ngày nghỉ";
  if (result.status === "WAITING_DATA") return "Chưa xác nhận đủ dữ liệu nguồn";
  if (result.status === "NEEDS_REVIEW") return "Mốc chấm công cần kiểm tra";
  return "Đối chiếu tự động";
}

export const reconciliationLeavePath = (id: number) => `/leave?request_id=${id}`;

/** Backend wall-clock timestamps without an offset are stored in Vietnam time. */
export function parseReconciliationTimestamp(value?: string | null): Date | null {
  if (!value) return null;
  const normalized = value.trim().replace(" ", "T");
  const explicitOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
  if (!explicitOffset && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(normalized)) return null;
  const date = new Date(explicitOffset ? normalized : `${normalized}+07:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatReconciliationTime(value?: string | null): string {
  return parseReconciliationTimestamp(value)?.toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" }) || "—";
}

export function formatReconciliationDateTime(value?: string | null): string {
  return parseReconciliationTimestamp(value)?.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) || "—";
}

export type PermissionDraft = { decision: AttendancePermissionDecision | ""; reason: string; approved_by: string };
export function permissionPayload(target: Pick<AttendancePermissionPayload, "user_id" | "work_date" | "session">, draft: PermissionDraft): AttendancePermissionPayload {
  if (!draft.reason.trim()) throw new Error("Vui lòng nhập lý do xác nhận / đặt lại.");
  if (!draft.approved_by.trim()) throw new Error("Vui lòng nhập người cho phép / xác nhận đặt lại.");
  return { ...target, decision: draft.decision || null, reason: draft.reason.trim(), approved_by: draft.approved_by.trim() };
}

export function validateArrivalTime(category: string, value: string): boolean {
  return category !== "LATE" || /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
export function lateArrivalLabel(leave: Pick<LeaveRequest, "leave_type" | "allowed_arrival_time">): string {
  if (!leave.leave_type?.startsWith("LATE")) return "";
  return leave.allowed_arrival_time ? `Được đến muộn đến ${leave.allowed_arrival_time}` : "Chưa ghi giờ đến (đơn cũ)";
}
