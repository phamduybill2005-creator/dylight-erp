import type { Attendance, AttendanceDayPermissionPayload, AttendancePermissionDecision, AttendanceReconciliationRow, AttendanceSessionResult, ReconciliationStatus } from "./types";

export type CompactDayBadge = { label: string; title: string; tone: "good" | "bad" | "waiting" | "muted" };
export type CompactAttendanceDay = { work_date: string; record: Attendance | null; result: AttendanceReconciliationRow | null; future: boolean; badges: CompactDayBadge[] };
export type CompactPermissionDraft = { scope: "AM" | "PM" | "ALL"; decision: AttendancePermissionDecision | ""; reason: string; approved_by: string };

export function compactMonthRange(period: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error("Tháng không hợp lệ.");
  const [year, month] = period.split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, "0")}` };
}

export function vietnamToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find(part => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

const LABELS: Record<ReconciliationStatus, string> = {
  PRESENT: "Có mặt", EXCUSED_ABSENCE: "Nghỉ có phép", UNEXCUSED_ABSENCE: "Nghỉ không phép", EXCUSED_LATE: "Muộn có phép", UNEXCUSED_LATE: "Muộn không phép",
  PENDING_APPROVAL: "Chờ duyệt", NEEDS_REVIEW: "Cần kiểm tra", WAITING_DATA: "Chờ dữ liệu", NOT_SCHEDULED: "Nghỉ theo lịch", NOT_FINISHED: "Chưa hết ca",
};

export function compactSessionBasis(result: AttendanceSessionResult): string {
  const permission = result.override
    ? `Người cho phép: ${result.override.approved_by}. Lý do: ${result.override.reason}`
    : result.permission_source === "LEAVE" ? "Đơn đã duyệt" : "";
  return [result.explanation, permission].filter(Boolean).join(" · ");
}

function badge(result: AttendanceSessionResult, future: boolean): CompactDayBadge {
  const status = result.status;
  const tone = ["PRESENT", "EXCUSED_ABSENCE", "EXCUSED_LATE"].includes(status) ? "good"
    : ["UNEXCUSED_ABSENCE", "UNEXCUSED_LATE"].includes(status) ? "bad"
    : ["NEEDS_REVIEW", "WAITING_DATA", "PENDING_APPROVAL"].includes(status) ? "waiting" : "muted";
  return { label: future && status === "NOT_FINISHED" ? "Chưa đến ngày" : LABELS[status], title: compactSessionBasis(result), tone };
}

export function buildCompactAttendanceDays(period: string, userId: number, records: Attendance[], results: AttendanceReconciliationRow[], today = vietnamToday()): CompactAttendanceDay[] {
  const { to } = compactMonthRange(period);
  const byDate = new Map(records.filter(row => row.user_id === userId).map(row => [row.work_date, row]));
  const resultsByDate = new Map(results.filter(row => row.user_id === userId).map(row => [row.work_date, row]));
  return Array.from({ length: Number(to.slice(-2)) }, (_, index) => {
    const work_date = `${period}-${String(index + 1).padStart(2, "0")}`;
    const record = byDate.get(work_date) || null;
    const result = resultsByDate.get(work_date) || null;
    const future = work_date > today;
    let badges: CompactDayBadge[];
    if (!result) badges = [{ label: future ? "Chưa đến ngày" : record ? "Chờ dữ liệu" : "Chưa có chấm công", title: "Chưa có kết quả đối chiếu cho ngày này; không suy ra nghỉ không phép.", tone: "muted" }];
    else {
      const morning = badge(result.morning, future);
      const afternoon = badge(result.afternoon, future);
      badges = result.morning.status === result.afternoon.status
        ? [{ ...morning, title: `Sáng: ${morning.title}\nChiều: ${afternoon.title}` }]
        : [{ ...morning, label: `Sáng: ${morning.label}` }, { ...afternoon, label: `Chiều: ${afternoon.label}` }];
    }
    return { work_date, record, result, future, badges };
  });
}

export function initialCompactPermission(day: CompactAttendanceDay): CompactPermissionDraft {
  const morning = day.result?.morning;
  const afternoon = day.result?.afternoon;
  const amOverride = morning?.override;
  const pmOverride = afternoon?.override;
  const matchingOverride = amOverride && pmOverride && amOverride.decision === pmOverride.decision && amOverride.reason === pmOverride.reason && amOverride.approved_by === pmOverride.approved_by;
  const current = amOverride || pmOverride;
  const isLate = (result?: AttendanceSessionResult) => !!result && (result.status === "EXCUSED_LATE" || result.status === "UNEXCUSED_LATE" || result.late_minutes > 0);
  let scope: CompactPermissionDraft["scope"] = "ALL";
  if (!matchingOverride && current) scope = amOverride ? "AM" : "PM";
  else if (!current && isLate(morning) !== isLate(afternoon)) scope = isLate(morning) ? "AM" : "PM";
  else if (!current && morning && afternoon && morning.status !== afternoon.status) {
    scope = ["PRESENT", "NOT_SCHEDULED"].includes(morning.status) ? "PM" : "AM";
  }
  const selectedResults = scope === "AM" ? [morning] : scope === "PM" ? [afternoon] : [morning, afternoon];
  const selectedStatuses = selectedResults.map(result => result?.status);
  const late = selectedResults.some(isLate);
  const absence = !late && (!day.record?.check_in && !day.record?.check_out
    || selectedStatuses.some(status => status === "EXCUSED_ABSENCE" || status === "UNEXCUSED_ABSENCE"));
  return { scope, decision: current?.decision || (absence ? "EXCUSED_ABSENCE" : "EXCUSED_LATE"), reason: current?.reason || "", approved_by: current?.approved_by || "" };
}

export function compactPermissionPayload(userId: number, workDate: string, draft: CompactPermissionDraft): AttendanceDayPermissionPayload {
  if (!draft.reason.trim()) throw new Error("Vui lòng nhập lý do.");
  if (!draft.approved_by.trim()) throw new Error("Vui lòng nhập người cho phép / xác nhận đặt lại.");
  return { user_id: userId, work_date: workDate, sessions: draft.scope === "ALL" ? ["AM", "PM"] : [draft.scope], decision: draft.decision || null, reason: draft.reason.trim(), approved_by: draft.approved_by.trim() };
}
