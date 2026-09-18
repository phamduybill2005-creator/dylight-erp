export type WorkedDay = { date: string; hours: number };

export function summarizeTimesheetProject(
  projectId: number,
  days: string[],
  hours: ReadonlyMap<string, number>,
) {
  const workedDays: WorkedDay[] = [];
  let totalHours = 0;

  for (const date of days) {
    const value = hours.get(`${projectId}|${date}`) ?? 0;
    totalHours += value;
    if (value > 0) workedDays.push({ date, hours: value });
  }

  return { totalHours, workDays: totalHours / 8, workedDays };
}

type ProjectMobileInput = {
  dosco_manager?: string | null;
  lead_name?: string | null;
  internal_deadline?: string | null;
  end_date?: string | null;
  progress_percent?: number | null;
};

export function projectMobileFacts(project: ProjectMobileInput) {
  return {
    owner: project.dosco_manager || project.lead_name || "Chưa phân công",
    deadline: project.internal_deadline || project.end_date || null,
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
