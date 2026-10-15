const vietnamClock = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

/** Preserve unknown legacy wall times; explicit offsets and new VN writes are unambiguous. */
export function formatVietnamTime(iso?: string | null, naiveZone: "utc" | "vietnam" = "vietnam"): string {
  if (!iso?.trim()) return "—";
  const value = iso.trim().replace(" ", "T");
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)
    ? value : `${value}${naiveZone === "vietnam" ? "+07:00" : "Z"}`;
  const date = new Date(zoned.replace(/(\.\d{3})\d+(?=Z|[+-]|$)/i, "$1"));
  if (Number.isNaN(date.getTime())) return "—";
  const parts = Object.fromEntries(vietnamClock.formatToParts(date).map(({ type, value }) => [type, value]));
  return `${parts.hour}:${parts.minute} ${parts.day}/${parts.month}`;
}
