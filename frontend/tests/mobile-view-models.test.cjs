const test = require("node:test");
const assert = require("node:assert/strict");
const { loadTypeScript } = require("./helpers/load-typescript.cjs");

test("timesheet mobile summary exposes total hours and only worked days", () => {
  const { summarizeTimesheetProject } = loadTypeScript("src/lib/mobile-view-models.ts");
  const days = ["2026-09-14", "2026-09-15", "2026-09-16"];
  const hours = new Map([
    ["17|2026-09-14", 3],
    ["17|2026-09-15", 0],
    ["17|2026-09-16", 5.5],
  ]);

  assert.deepEqual(summarizeTimesheetProject(17, days, hours), {
    totalHours: 8.5,
    workDays: 1.0625,
    workedDays: [
      { date: "2026-09-14", hours: 3 },
      { date: "2026-09-16", hours: 5.5 },
    ],
  });
});

test("project mobile facts prioritize owner, deadline and progress", () => {
  const { projectMobileFacts } = loadTypeScript("src/lib/mobile-view-models.ts");

  assert.deepEqual(projectMobileFacts({
    dosco_manager: "N.V.CUONG",
    lead_name: "Fallback",
    internal_deadline: "2026-09-25",
    end_date: "2026-09-30",
    progress_percent: 67.4,
  }), {
    owner: "N.V.CUONG",
    deadline: "2026-09-25",
    progress: 67,
  });
});

test("revenue mobile facts expose revenue before supporting hours", () => {
  const { revenueMobileFacts } = loadTypeScript("src/lib/mobile-view-models.ts");

  assert.deepEqual(revenueMobileFacts({ client_hours: "16", total_hours: 12.5 }, 4260000), {
    revenue: 4260000,
    clientHours: 16,
    actualHours: 12.5,
  });
});
