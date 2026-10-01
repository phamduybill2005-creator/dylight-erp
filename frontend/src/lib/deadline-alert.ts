import type { Project } from "./types";

export type DeadlineAlertEntry = { p: Project; due: string };

/** Chỉ nhắc đúng ngày hạn sớm nhất giữa hạn nội bộ và ngày hoàn thành. */
export function projectsDueToday(projects: Project[], today: string): DeadlineAlertEntry[] {
  return projects
    .filter((p) => !p.is_deleted && p.status !== "COMPLETED" && p.status !== "CLOSED")
    .map((p) => {
      const dates = [p.internal_deadline, p.end_date]
        .filter((d): d is string => !!d)
        .map((d) => d.slice(0, 10))
        .sort();
      return { p, due: dates[0] };
    })
    .filter((entry) => entry.due === today);
}
