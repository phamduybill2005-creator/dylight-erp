export type WorkedDay = { date: string; hours: number };

/** Khóa ô (dự án × ngày) trong Map giờ của trang Tiến độ — DÙNG CHUNG cho bảng máy tính
 *  và thẻ điện thoại. Trước đây hai nơi dùng 2 định dạng khác nhau ("id:ngày" / "id|ngày")
 *  nên thẻ điện thoại tra không trúng, luôn ra 0h. */
export const timesheetCellKey = (projectId: number, date: string) => `${projectId}:${date}`;

export function summarizeTimesheetProject(
  projectId: number,
  days: string[],
  hours: ReadonlyMap<string, number>,
) {
  const workedDays: WorkedDay[] = [];
  let totalHours = 0;

  for (const date of days) {
    const value = hours.get(timesheetCellKey(projectId, date)) ?? 0;
    totalHours += value;
    if (value > 0) workedDays.push({ date, hours: value });
  }

  return { totalHours, workDays: totalHours / 8, workedDays };
}

type ProjectMobileInput = {
  geo_manager?: string | null;
  dosco_manager?: string | null;
  lead_name?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  internal_deadline?: string | null;
  manual_hours?: number | string | null;
  total_hours?: number | string | null;
  total_days?: number | string | null;
  progress_percent?: number | null;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Số liệu cho THẺ DỰ ÁN trên điện thoại — đủ các cột của bảng máy tính (người phụ trách
 *  2 phía, 3 mốc Time in/out/due, Manual time, Real time, % tiến độ).
 *  `monthHours`: tổng giờ nhập trong THÁNG đang lọc — có truyền thì Real time lấy số này
 *  (như cột Real time của bảng khi lọc tháng); không truyền thì lấy tổng của dự án. */
export function projectMobileFacts(project: ProjectMobileInput, monthHours?: number | null) {
  const manualHours = finiteNumber(project.manual_hours);
  const realHours = monthHours != null ? round1(monthHours) : round1(finiteNumber(project.total_hours));
  const realDays = monthHours != null ? round1(realHours / 8) : round1(finiteNumber(project.total_days));
  return {
    owner: project.dosco_manager || project.lead_name || "Chưa phân công",
    geo: project.geo_manager || null,
    startDate: project.start_date || null,
    endDate: project.end_date || null,
    internalDeadline: project.internal_deadline || null,
    manualHours,
    manualDays: round1(manualHours / 8),
    realHours,
    realDays,
    progress: Math.max(0, Math.min(100, Math.round(project.progress_percent ?? 0))),
  };
}

type RevenueMobileInput = {
  client_hours?: number | string | null;
  total_hours?: number | string | null;
};

function finiteNumber(value: number | string | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function revenueMobileFacts(project: RevenueMobileInput, revenue: number) {
  return {
    revenue,
    clientHours: finiteNumber(project.client_hours),
    actualHours: finiteNumber(project.total_hours),
  };
}
