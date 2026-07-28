// NHÓM (グループ) của dự án — theo Excel "Sheet Quản Lý" bên Nhật: CHỈ CÓ 3 NHÓM.
// Lưu vào DB bằng TÊN TIẾNG NHẬT (khớp Excel + dữ liệu dự án đã nhập trước đây),
// nhưng hiển thị dạng "Tiếng Nhật (Tiếng Việt)" cho cả 2 bên cùng đọc được.
export const PROJECT_GROUPS: { ja: string; vi: string }[] = [
  { ja: "測量解析", vi: "Phòng Bản đồ" },
  { ja: "3次元設計", vi: "Phòng BIM" },
  { ja: "土木設計", vi: "Phòng Thiết kế đường 2D" },
];

/** Nhãn hiển thị: "測量解析 (Phòng Bản đồ)". Giá trị lạ (dữ liệu cũ) thì giữ nguyên. */
export function groupLabel(value?: string | null): string {
  const v = (value || "").trim();
  if (!v) return "";
  const g = PROJECT_GROUPS.find((x) => x.ja === v || x.vi === v);
  return g ? `${g.ja} (${g.vi})` : v;
}

/** Tên tiếng Việt tương ứng (để suy ra PHÒNG BAN từ nhóm). */
export function groupToDept(value?: string | null): string {
  const v = (value || "").trim();
  const g = PROJECT_GROUPS.find((x) => x.ja === v || x.vi === v);
  return g ? g.vi : v;
}

/** TÊN TIẾNG NHẬT của PHÒNG BAN — dùng để hiển thị "Phòng X (日本語)".
 *  KHÁC với PROJECT_GROUPS: グループ của DỰ ÁN chỉ có 3 nhóm (Phòng AI không nhận
 *  dự án từ Nhật nên không nằm trong danh sách nhóm, nhưng vẫn có tên tiếng Nhật). */
export const DEPT_JA: Record<string, string> = {
  "Phòng Bản đồ": "測量解析",
  "Phòng BIM": "3次元設計",
  "Phòng Thiết kế đường 2D": "土木設計",
  "Phòng AI": "AI開発",
};

/** Chuẩn hoá về TÊN PHÒNG BAN tiếng Việt (nhận cả khi dữ liệu ghi tên tiếng Nhật),
 *  để "測量解析" và "Phòng Bản đồ" không bị tính thành 2 phòng khác nhau. */
export function normalizeDept(v?: string | null): string {
  const d = (v || "").trim();
  if (!d) return "";
  const hit = Object.keys(DEPT_JA).find((vi) => vi === d || DEPT_JA[vi] === d);
  return hit ?? d;
}

/** Nhãn PHÒNG BAN kèm tên tiếng Nhật bên cạnh: "Phòng Bản đồ (測量解析)".
 *  Phòng chưa có tên tiếng Nhật thì giữ nguyên tiếng Việt. */
export function deptLabel(dept?: string | null): string {
  const vi = normalizeDept(dept);
  if (!vi) return "";
  const ja = DEPT_JA[vi];
  return ja ? `${vi} (${ja})` : vi;
}

// ---------------------------------------------------------------------------
// GEO担当 (người phụ trách phía NHẬT) thuộc phòng ban nào — họ không có tài khoản
// nên map cứng theo tên. Chưa liệt kê -> mặc định "Phòng Thiết kế đường 2D".
// Sửa ở đây khi công ty phân lại người Nhật cho phòng khác.
// ---------------------------------------------------------------------------
const GEO_PERSON_DEPT: Record<string, string> = {
  "寺崎": "Phòng Bản đồ",
  "伊藤": "Phòng Bản đồ",
};
const GEO_DEPT_DEFAULT = "Phòng Thiết kế đường 2D";

/** Phòng ban (tiếng Việt đã chuẩn hoá) của một người phía Nhật (GEO担当). */
export function geoDeptOf(name?: string | null): string {
  const n = (name || "").trim();
  return GEO_PERSON_DEPT[n] ?? GEO_DEPT_DEFAULT;
}

/** Nhóm (tiếng Nhật) tương ứng với một PHÒNG BAN tiếng Việt. */
export function deptToGroup(dept?: string | null): string {
  const d = (dept || "").trim();
  const g = PROJECT_GROUPS.find((x) => x.vi === d || x.ja === d);
  return g ? g.ja : "";
}
