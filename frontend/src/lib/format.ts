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
