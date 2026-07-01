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

/** Được xem TIỀN của dự án (giá trị HĐ, chi phí, lãi/lỗ, khối lượng, đơn giá).
 *  Nhân viên (STAFF) KHÔNG thấy tiền. Khớp đúng is_staff_tier ở backend. */
export const canSeeMoney = (role: Role | undefined | null) => roleTier(role) !== "STAFF";

/** Chỉ Giám đốc (được xem tài chính: doanh thu, lãi/lỗ, báo cáo). */
export const isDirector = (role: Role | undefined | null) => roleTier(role) === "DIRECTOR";

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Quản trị hệ thống",
  DIRECTOR: "Giám đốc",
  MANAGER: "Quản lý cấp cao",
  ACCOUNTANT: "Kế toán",
  FIELD_STAFF: "Quản lý cấp trung",
};

export const TIER_LABEL: Record<Tier, string> = {
  DIRECTOR: "Ban Giám đốc",
  MANAGER: "Quản lý",
  STAFF: "Nhân viên",
};
