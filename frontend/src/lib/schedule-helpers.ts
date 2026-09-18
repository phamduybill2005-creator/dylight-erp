import type { LeaveRequest } from "./types";

/**
 * Lấy mốc thời gian xét duyệt hoặc tạo mới của đơn nghỉ.
 * Đơn nào được duyệt sau cùng (decided_at mới hơn) sẽ có timestamp cao hơn.
 */
export function getLeaveApprovalTime(leave: LeaveRequest): number {
  if (leave.decided_at) {
    const t = new Date(leave.decided_at).getTime();
    if (!isNaN(t) && t > 0) return t;
  }
  if (leave.created_at) {
    const t = new Date(leave.created_at).getTime();
    if (!isNaN(t) && t > 0) return t;
  }
  return 0;
}

/**
 * Hàm so sánh 2 đơn nghỉ:
 * Đơn nào được duyệt sau cùng (mới nhất) sẽ đứng trước (-1).
 * Nếu cùng thời gian duyệt, đơn nào có ID lớn hơn (tạo sau) sẽ đứng trước.
 */
export function compareLeavesLatestApproved(a: LeaveRequest, b: LeaveRequest): number {
  const timeA = getLeaveApprovalTime(a);
  const timeB = getLeaveApprovalTime(b);
  if (timeB !== timeA) {
    return timeB - timeA;
  }
  return (b.id || 0) - (a.id || 0);
}

/**
 * Lấy tất cả các đơn nghỉ ĐÃ DUYỆT của 1 nhân sự cho một ngày cụ thể (từ T9/2026 trở đi).
 * Danh sách trả về được sắp xếp với đơn được DUYỆT SAU CÙNG ở vị trí ĐẦU TIÊN [0].
 */
export function getApprovedLeavesForDate(
  leaves: LeaveRequest[],
  userId: number,
  dateStr: string,
): LeaveRequest[] {
  if (dateStr < "2026-09-01") return [];
  return leaves
    .filter((l) => {
      if (l.user_id !== userId) return false;
      if (l.status !== "APPROVED") return false;
      if (l.from_date < "2026-09-01") return false;
      return l.from_date <= dateStr && l.to_date >= dateStr;
    })
    .sort(compareLeavesLatestApproved);
}

/**
 * Lấy đơn nghỉ ĐÃ DUYỆT sau cùng của nhân sự trong một ngày (dùng để hiển thị ô lịch).
 */
export function resolveLatestApprovedLeave(
  leaves: LeaveRequest[],
  userId: number,
  dateStr: string,
): LeaveRequest | undefined {
  return getApprovedLeavesForDate(leaves, userId, dateStr)[0];
}
