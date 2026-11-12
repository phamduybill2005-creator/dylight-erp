/** Monthly ballot calendar, always in Vietnam time, regardless of browser timezone. */
export function evaluationCycle(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)!.value);
  const year = get("year"), currentMonth = get("month"), day = get("day"), hour = get("hour");
  const month = currentMonth === 1 ? 12 : currentMonth - 1;
  const reviewedYear = currentMonth === 1 ? year - 1 : year;
  const mm = String(month).padStart(2, "0");
  return {
    month: `${reviewedYear}-${mm}`, monthLabel: `${mm}/${reviewedYear}`,
    startDate: `01/${String(currentMonth).padStart(2, "0")}/${year}`,
    deadline: `05/${String(currentMonth).padStart(2, "0")}/${year}`,
    open: day <= 5 && (day > 1 || hour >= 8),
    votingOpen: day <= 5,
  };
}

export function evaluationCanEdit(month: string, now = new Date()): boolean {
  const cycle = evaluationCycle(now);
  return cycle.votingOpen && month === cycle.month;
}

export function evaluationMonthFromSearch(search: string, now = new Date()): string {
  const fallback = evaluationCycle(now).month;
  const month = new URLSearchParams(search).get("month") ?? "";
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && month <= fallback ? month : fallback;
}

export function evaluationNotificationUrl(notification: { sender_id?: number | null; title: string }): string | null {
  if (notification.sender_id != null) return null;
  const match = /^Đánh giá định kì tháng (0[1-9]|1[0-2])\/(\d{4})$/.exec(notification.title);
  return match ? `/peer-review?month=${match[2]}-${match[1]}` : null;
}
