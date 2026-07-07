// Tiện ích định dạng hiển thị theo chuẩn Việt Nam.

/** Định dạng tiền VND: 78000000000 -> "78.000.000.000 ₫". */
export function formatVND(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(n);
}

/** Rút gọn số tiền lớn cho thẻ KPI: 78 tỷ, 4,6 tỷ, 165 triệu. */
export function formatCompactVND(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${trim(n / 1e9)} tỷ`;
  if (abs >= 1e6) return `${trim(n / 1e6)} triệu`;
  if (abs >= 1e3) return `${trim(n / 1e3)} nghìn`;
  return `${n}`;
}

function trim(x: number): string {
  // Tối đa 1 chữ số thập phân, bỏ ".0" thừa.
  return x.toLocaleString("vi-VN", { maximumFractionDigits: 1 });
}

/** "2025-05-18" -> "18/05/2025". */
export function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("vi-VN");
}

// ---- Ngày theo GIỜ ĐỊA PHƯƠNG (Việt Nam) ----
// KHÔNG dùng new Date().toISOString() để lấy ngày: toISOString() trả GIỜ UTC,
// nên lúc rạng sáng ở VN (UTC vẫn là hôm trước) sẽ ra SAI NGÀY. Dùng các hàm dưới.

/** Một Date -> "YYYY-MM-DD" theo giờ địa phương (không qua UTC). */
export function dateLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Hôm nay theo giờ địa phương, "YYYY-MM-DD". */
export function todayLocal(): string {
  return dateLocal(new Date());
}

/** Tháng hiện tại theo giờ địa phương, "YYYY-MM". */
export function monthLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Chuỗi thời gian từ backend là GIỜ VN "trần" (vn_now, không có múi giờ).
 *  Gắn "+07:00" để new Date() hiểu đúng là giờ VN trên MỌI máy (tránh lệch 7h ở
 *  trình duyệt không phải UTC+7). Nếu chuỗi đã có múi giờ thì giữ nguyên. */
function parseVN(s: string): Date {
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}+07:00`);
}

/**
 * Số NGÀY của 1 phân công (giao việc) — dùng đo "làm trong bao lâu".
 *   - Đã xong (DONE): done_at − (started_at ?? created_at)
 *   - Đang làm: hôm nay − (started_at ?? created_at)
 * Trả 0 nếu ra số âm; null nếu thiếu mốc bắt đầu. Mốc lưu là giờ VN -> quy về đúng
 * múi giờ trước khi trừ nên không lệch dù xem ở máy múi giờ khác; làm tròn về ngày.
 */
export function assignmentDays(
  status: string,
  created_at?: string | null,
  started_at?: string | null,
  done_at?: string | null,
): number | null {
  const start = started_at || created_at;
  if (!start) return null;
  const a = parseVN(start);
  if (isNaN(a.getTime())) return null;
  const endStr = status === "DONE" ? done_at || created_at : null;
  const b = status === "DONE" ? (endStr ? parseVN(endStr) : null) : new Date();
  if (!b || isNaN(b.getTime())) return null;
  const days = Math.round((b.getTime() - a.getTime()) / 86_400_000);
  return days < 0 ? 0 : days;
}
