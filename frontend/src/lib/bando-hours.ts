// 9 CỘT GIỜ PHÒNG BẢN ĐỒ ở tab Doanh thu — theo mẫu "Sample - Phòng Bản đồ":
// Ortho / RIEGL / QLCL / DATA / Ground / Grid_XML_Đường đồng mức / HoverMaps / トレース / TD-TN.
// Mỗi cột = tổng giờ realtime người làm nhập ở các đầu việc thuộc NHÓM HẠNG MỤC cùng tên
// (backend /projects/revenue/group-hours trả {project_id: {tên nhóm cha: giờ}}).
// Không import gì khác để test được bằng node --test (tests/bando-hours.test.cjs).

/** Tên nhóm cha -> giờ, của MỘT dự án. */
export type GroupHours = Record<string, number>;
/** project_id (chuỗi, vì JSON) -> GroupHours. */
export type ProjectGroupHours = Record<string, GroupHours>;

export type BanDoHourColumn = {
  key: string;
  /** Chữ trên đầu cột (ngắn cho vừa ô). */
  label: string;
  /** Tên đầy đủ của hạng mục trong mẫu — hiện ở tooltip. */
  title: string;
  /** Tên nhóm (đã chuẩn hoá) nhận vào cột này; khớp nguyên tên hoặc tên bắt đầu bằng "<alias>-". */
  aliases: string[];
};

export const BANDO_HOUR_COLUMNS: readonly BanDoHourColumn[] = [
  { key: "ortho", label: "Ortho", title: "Ortho", aliases: ["ortho"] },
  { key: "riegl", label: "RIEGL", title: "RIEGL", aliases: ["riegl"] },
  { key: "qlcl", label: "QLCL", title: "QLCL", aliases: ["qlcl"] },
  { key: "data", label: "DATA", title: "DATA", aliases: ["data"] },
  { key: "ground", label: "Ground", title: "Ground", aliases: ["ground"] },
  { key: "grid", label: "Grid_XML", title: "Grid_XML_Đường đồng mức", aliases: ["grid-xml", "grid"] },
  { key: "hovermaps", label: "HoverMaps", title: "HoverMaps", aliases: ["hovermaps", "hover-maps"] },
  { key: "trace", label: "トレース", title: "トレース (Trace)", aliases: ["トレース", "trace"] },
  { key: "tdtn", label: "TD-TN", title: "TD-TN (Trắc dọc – Trắc ngang)", aliases: ["td-tn", "tdtn"] },
];

/** "Grid_XML_Đường  đồng mức" -> "grid-xml-đường-đồng-mức": không phân biệt hoa thường,
 *  mọi dấu cách / gạch dưới / gạch ngang đều thành một dấu "-". */
export function normalizeGroupName(name: string | null | undefined): string {
  return (name || "").normalize("NFC").toLocaleLowerCase("vi").replace(/[\s_\-–—]+/g, "-").replace(/^-|-$/g, "");
}

/** Cột nhận giờ của một nhóm hạng mục; null = nhóm ngoài mẫu (không lên cột nào). */
export function columnKeyForGroup(name: string | null | undefined): string | null {
  const n = normalizeGroupName(name);
  if (!n) return null;
  for (const col of BANDO_HOUR_COLUMNS) {
    if (col.aliases.some((a) => n === a || n.startsWith(`${a}-`))) return col.key;
  }
  return null;
}

/** Giờ của từng cột (key -> giờ, làm tròn 0,1). Nhiều nhóm cùng về một cột thì cộng dồn. */
export function hoursByColumn(groupHours: GroupHours | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const col of BANDO_HOUR_COLUMNS) out[col.key] = 0;
  for (const [name, hours] of Object.entries(groupHours || {})) {
    const key = columnKeyForGroup(name);
    const h = Number(hours);
    if (key && Number.isFinite(h) && h > 0) out[key] += h;
  }
  for (const key of Object.keys(out)) out[key] = Math.round(out[key] * 10) / 10;
  return out;
}

/** Số giờ -> chữ trong ô: "12,5h"; 0 -> "—". */
export function formatGroupHours(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return "—";
  return `${hours.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}h`;
}
