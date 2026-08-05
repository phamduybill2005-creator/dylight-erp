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
  if (role === "MANAGER" || role === "MANAGER_MID" || role === "ACCOUNTANT") return "MANAGER";
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
  MANAGER: "Quản lý cấp cao",
  MANAGER_MID: "Quản lý cấp trung",
  ACCOUNTANT: "Kế toán",
  FIELD_STAFF: "Nhân viên",
};

export const TIER_LABEL: Record<Tier, string> = {
  DIRECTOR: "Ban Giám đốc",
  MANAGER: "Quản lý",
  STAFF: "Nhân viên",
};

export type RankKey =
  | "ADMIN" | "DIRECTOR" | "MANAGER_TOP" | "MANAGER_MID" | "ACCOUNTANT" | "STAFF";

export const RANKS: { key: RankKey; label: string; role: Role; top?: boolean }[] = [
  { key: "DIRECTOR", label: "Giám đốc", role: "DIRECTOR" },
  { key: "ADMIN", label: "Quản trị hệ thống", role: "ADMIN" },
  { key: "MANAGER_TOP", label: "Quản lý cấp cao", role: "MANAGER", top: true },
  { key: "MANAGER_MID", label: "Quản lý cấp trung", role: "MANAGER_MID", top: false },
  { key: "ACCOUNTANT", label: "Kế toán", role: "ACCOUNTANT" },
  { key: "STAFF", label: "Nhân viên", role: "FIELD_STAFF" },
];

export const rankLabel = (k: RankKey): string =>
  RANKS.find((r) => r.key === k)?.label ?? k;

/** Cấp bậc HIỆN TẠI của một người (trực tiếp từ vai trò đã được phân công). */
export function rankOf(
  role: Role | undefined | null,
  hasSubordinates?: boolean | null,
  isTopManager?: boolean | null,
): RankKey {
  if (role === "ADMIN") return "ADMIN";
  if (role === "DIRECTOR") return "DIRECTOR";
  if (role === "ACCOUNTANT") return "ACCOUNTANT";
  if (role === "MANAGER_MID") return "MANAGER_MID";
  if (role === "MANAGER") return "MANAGER_TOP";
  if (role === "FIELD_STAFF" && hasSubordinates) return "MANAGER_MID";
  return "STAFF";
}

/** Cho phép xem toàn bộ chấm công, nhân sự, tổng hợp: CHỈ Quản trị hệ thống, Giám đốc, Quản lý cấp cao. */
export function isSeniorManagerUp(
  u: { role?: Role | null; has_subordinates?: boolean | null; manager_id?: number | null; manager_ids?: string | number[] | null } | null | undefined
): boolean {
  if (!u) return false;
  const isTop = !u.manager_id && (!u.manager_ids || u.manager_ids.length === 0);
  const r = rankOf(u.role, u.has_subordinates, isTop);
  return r === "ADMIN" || r === "DIRECTOR" || r === "MANAGER_TOP";
}

/** Thứ tự cấp bậc từ CAO đến THẤP (0 = Giám đốc lớn nhất). */
export const RANK_WEIGHT: Record<RankKey, number> = {
  DIRECTOR: 0,
  ADMIN: 1,
  MANAGER_TOP: 2,
  MANAGER_MID: 3,
  ACCOUNTANT: 4,
  STAFF: 5,
};

export function userRankWeight(
  u: { role?: Role | null; has_subordinates?: boolean | null; manager_id?: number | null; manager_ids?: string | number[] | null } | null | undefined
): number {
  if (!u) return 99;
  const isTop = !u.manager_id && (!u.manager_ids || u.manager_ids.length === 0);
  const r = rankOf(u.role, u.has_subordinates, isTop);
  return RANK_WEIGHT[r] ?? 99;
}

/** Thang THĂNG CẤP theo thời gian (thấp → cao). Kế toán là nhánh riêng. */
export const PROMOTION_LADDER: RankKey[] = ["STAFF", "MANAGER_MID", "MANAGER_TOP", "ADMIN", "DIRECTOR"];

/** Cấp kế tiếp khi thăng cấp; null = đã kịch trần hoặc không nằm trên thang. */
export function nextRank(cur: RankKey): RankKey | null {
  const i = PROMOTION_LADDER.indexOf(cur);
  if (i < 0 || i === PROMOTION_LADDER.length - 1) return null;
  return PROMOTION_LADDER[i + 1];
}

export function roleTitle(
  role: Role | undefined | null,
  hasSubordinates?: boolean | null,
  isTopManager?: boolean | null,
): string {
  if (!role) return "";
  const r = rankOf(role, hasSubordinates, isTopManager);
  return rankLabel(r);
}
