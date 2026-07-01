// Phân tầng vai trò -> giao diện. Nguồn chân lý duy nhất cho việc gating UI.
//
// 3 tầng giao diện (chốt với người dùng):
//   DIRECTOR : ADMIN + DIRECTOR    -> thấy đầy đủ, gồm doanh thu / lãi-lỗ.
//   MANAGER  : MANAGER + ACCOUNTANT -> ẩn doanh thu/lãi-lỗ, vẫn chụp + duyệt hóa đơn.
//   STAFF    : FIELD_STAFF          -> việc cá nhân, chấm công, đánh giá quản lý.

import type { Role } from "./types";

export type Tier = "DIRECTOR" | "MANAGER" | "STAFF";

export function roleTier(role: Role | undefined | null): Tier {
  if (role === "ADMIN" || role === "DIRECTOR") return "DIRECTOR";
  if (role === "MANAGER" || role === "ACCOUNTANT") return "MANAGER";
  return "STAFF";
}

/** Quản lý trở lên (thấy nhân sự, chấm công toàn đội, chấm điểm cấp dưới). */
export const isManagerUp = (role: Role | undefined | null) => roleTier(role) !== "STAFF";

/** Được xem TIỀN của dự án (giá trị HĐ, chi phí, thanh toán/công nợ, lãi/lỗ,
 *  khối lượng – đơn giá – thành tiền hạng mục).
 *  Theo yêu cầu chủ doanh nghiệp: CHỈ GIÁM ĐỐC thấy tiền — quản lý cấp cao/cấp
 *  trung + nhân viên đều KHÔNG. Khớp đúng can_see_money ở backend.
 *  (Ngoại lệ: hóa đơn chi phí đầu vào "Hóa đơn AI" quản lý vẫn duyệt — gate riêng.) */
export const canSeeMoney = (role: Role | undefined | null) => roleTier(role) === "DIRECTOR";

/** Chỉ Giám đốc (được xem tài chính: doanh thu, lãi/lỗ, báo cáo). */
export const isDirector = (role: Role | undefined | null) => roleTier(role) === "DIRECTOR";

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Quản trị hệ thống",
  DIRECTOR: "Giám đốc",
  MANAGER: "Quản lý",
  ACCOUNTANT: "Kế toán",
  FIELD_STAFF: "Nhân viên",
};

export const TIER_LABEL: Record<Tier, string> = {
  DIRECTOR: "Ban Giám đốc",
  MANAGER: "Quản lý",
  STAFF: "Nhân viên",
};

/**
 * CHỨC VỤ hiển thị theo 3 tầng (khác ROLE_LABEL — vai trò hệ thống dùng cho dropdown):
 *   MANAGER                         -> "Quản lý cấp cao"
 *   FIELD_STAFF CÓ cấp dưới trực tiếp -> "Quản lý cấp trung"
 *   FIELD_STAFF KHÔNG cấp dưới        -> "Nhân viên"
 * ADMIN/DIRECTOR/ACCOUNTANT giữ nhãn vai trò gốc.
 * `hasSubordinates` do backend tính (User.has_subordinates).
 */
export function roleTitle(
  role: Role | undefined | null,
  hasSubordinates?: boolean | null,
): string {
  if (!role) return "";
  if (role === "MANAGER") return "Quản lý cấp cao";
  if (role === "FIELD_STAFF") return hasSubordinates ? "Quản lý cấp trung" : "Nhân viên";
  return ROLE_LABEL[role] || role;
}
