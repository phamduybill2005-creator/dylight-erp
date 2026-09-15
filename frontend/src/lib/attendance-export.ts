import type { AttendanceSummary, Timesheet, User } from "./types";

type AttendanceExportClient = {
  users: () => Promise<User[]>;
  timesheets: (params: { from: string; to: string }) => Promise<Timesheet[]>;
  attendanceSummary: (period: string) => Promise<AttendanceSummary[]>;
};

type ExportCell = string | number;

const departmentsOf = (value?: string | null) =>
  (value || "").split(",").map((part) => part.trim()).filter(Boolean);

/**
 * Nạp dữ liệu mới nhất và tạo các dòng xuất Excel.
 * Danh sách user từ server là nguồn chân lý, nên dữ liệu giờ cũ không thể làm
 * xuất hiện lại một tài khoản đã bị xóa.
 */
export async function loadAttendanceExportRows(
  client: AttendanceExportClient,
  period: string,
  department: string,
  fallbackSummary: AttendanceSummary[],
): Promise<{ users: User[]; rows: ExportCell[][] }> {
  const [year, month] = period.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  const from = `${period}-01`;
  const to = `${period}-${String(lastDay).padStart(2, "0")}`;

  const [users, timesheets, summaries] = await Promise.all([
    client.users(),
    client.timesheets({ from, to }).catch(() => [] as Timesheet[]),
    client.attendanceSummary(period).catch(() => fallbackSummary),
  ]);

  const projectTimeByUser = new Map<number, number>();
  for (const entry of timesheets) {
    projectTimeByUser.set(
      entry.user_id,
      (projectTimeByUser.get(entry.user_id) || 0) + Number(entry.hours || 0),
    );
  }

  const summaryByUser = new Map(summaries.map((item) => [item.user_id, item]));
  const filteredUsers = users.filter(
    (user) => !department || departmentsOf(user.department).includes(department),
  );

  const rows = filteredUsers.map<ExportCell[]>((user, index) => {
    const summary = summaryByUser.get(user.id);
    return [
      index + 1,
      user.full_name || "",
      user.department || "",
      Math.round((projectTimeByUser.get(user.id) || 0) * 10) / 10,
      summary ? Math.round(Number(summary.total_hours || 0) * 10) / 10 : 0,
      summary ? Number(summary.late_days || 0) : 0,
    ];
  });

  return { users, rows };
}
