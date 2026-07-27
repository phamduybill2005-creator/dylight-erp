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

/** Nhãn PHÒNG BAN kèm tên tiếng Nhật bên cạnh: "Phòng Bản đồ (測量解析)".
 *  Phòng chưa có tên tiếng Nhật (vd Phòng AI) thì giữ nguyên tiếng Việt. */
export function deptLabel(dept?: string | null): string {
  const d = (dept || "").trim();
  if (!d) return "";
  const g = PROJECT_GROUPS.find((x) => x.vi === d || x.ja === d);
  return g ? `${g.vi} (${g.ja})` : d;
}

/** Chuẩn hoá về TÊN PHÒNG BAN tiếng Việt (nhận cả khi dữ liệu ghi tên tiếng Nhật),
 *  để không bị đếm/lọc trùng "測量解析" và "Phòng Bản đồ" thành 2 phòng khác nhau. */
export const normalizeDept = (v?: string | null): string => groupToDept(v);

/** Nhóm (tiếng Nhật) tương ứng với một PHÒNG BAN tiếng Việt. */
export function deptToGroup(dept?: string | null): string {
  const d = (dept || "").trim();
  const g = PROJECT_GROUPS.find((x) => x.vi === d || x.ja === d);
  return g ? g.ja : "";
}
