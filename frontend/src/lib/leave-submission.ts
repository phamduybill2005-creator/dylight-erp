export const LEAVE_ADVANCE_ERROR = "Chỉ được gửi đơn trước tối đa 3 ngày tính theo ngày bắt đầu nghỉ.";

/** Three calendar days from today in Vietnam, regardless of the browser timezone. */
export function latestLeaveStartDate(now = new Date()): string {
  const latest = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(latest);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function validateLeaveStartDate(fromDate: string, now = new Date()): string | null {
  return fromDate > latestLeaveStartDate(now) ? LEAVE_ADVANCE_ERROR : null;
}
