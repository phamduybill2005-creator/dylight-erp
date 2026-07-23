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
 *  Theo yêu cầu chủ doanh nghiệp: CHỈ GIÁM ĐỐC thấy tiền — quản lý cấp trung
 *  + nhân viên đều KHÔNG. Khớp đúng can_see_money ở backend.
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
 * CHỨC VỤ hiển thị (khác ROLE_LABEL — vai trò hệ thống dùng cho dropdown):
 *   Là QUẢN LÝ (role MANAGER, hoặc FIELD_STAFF có cấp dưới) và:
 *     - KHÔNG có ai quản lý bên trên (trưởng phòng/đầu nhánh) -> "Quản lý cấp cao"
 *     - CÓ quản lý bên trên (báo cáo cho trưởng phòng)         -> "Quản lý cấp trung"
 *   FIELD_STAFF KHÔNG cấp dưới -> "Nhân viên".
 * ADMIN/DIRECTOR/ACCOUNTANT giữ nhãn vai trò gốc.
 * Sơ đồ DOSCO: Giám đốc > trưởng phòng (Sơn, Lâm, Bính = cấp CAO) > quản lý trung
 * gian (Quang, Cường... = cấp TRUNG) > nhân viên.
 *   `hasSubordinates` do backend tính (User.has_subordinates).
 *   `isTopManager`   = KHÔNG có manager_id/manager_ids (không ai quản lý bên trên).
 *      Bỏ trống -> mặc định coi như cấp TRUNG (an toàn cho nơi thiếu dữ liệu quản lý).
 */
export function roleTitle(
  role: Role | undefined | null,
  hasSubordinates?: boolean | null,
  isTopManager?: boolean | null,
): string {
  if (!role) return "";
  const isManager = role === "MANAGER" || (role === "FIELD_STAFF" && !!hasSubordinates);
  if (isManager) return isTopManager ? "Quản lý cấp cao" : "Quản lý cấp trung";
  if (role === "FIELD_STAFF") return "Nhân viên";
  return ROLE_LABEL[role] || role;
}
