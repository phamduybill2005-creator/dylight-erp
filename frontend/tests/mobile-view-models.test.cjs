const test = require("node:test");
const assert = require("node:assert/strict");
const { loadTypeScript } = require("./helpers/load-typescript.cjs");

test("timesheet mobile summary exposes total hours and only worked days", () => {
  const { summarizeTimesheetProject, timesheetCellKey } = loadTypeScript("src/lib/mobile-view-models.ts");
  const days = ["2026-09-14", "2026-09-15", "2026-09-16"];
  // Dựng Map bằng đúng hàm khóa dùng chung với bảng máy tính — test cũ tự ghép "17|ngày"
  // nên vẫn xanh trong khi trang thật tra không trúng.
  const hours = new Map([
    [timesheetCellKey(17, "2026-09-14"), 3],
    [timesheetCellKey(17, "2026-09-15"), 0],
    [timesheetCellKey(17, "2026-09-16"), 5.5],
  ]);
  assert.equal(timesheetCellKey(17, "2026-09-14"), "17:2026-09-14");

  assert.deepEqual(summarizeTimesheetProject(17, days, hours), {
    totalHours: 8.5,
    workDays: 1.0625,
    workedDays: [
      { date: "2026-09-14", hours: 3 },
      { date: "2026-09-16", hours: 5.5 },
    ],
  });
});

test("project mobile facts cover every desktop column: people, three dates, hours, progress", () => {
  const { projectMobileFacts } = loadTypeScript("src/lib/mobile-view-models.ts");

  assert.deepEqual(projectMobileFacts({
    geo_manager: "寺崎",
    dosco_manager: "N.V.CUONG",
    lead_name: "Fallback",
    start_date: "2026-09-16",
    end_date: null,
    internal_deadline: "2026-09-25",
    manual_hours: "16.00",
    total_hours: 102.4,
    total_days: 12.8,
    progress_percent: 67.4,
  }), {
    owner: "N.V.CUONG",
    geo: "寺崎",
    startDate: "2026-09-16",
    endDate: null,
    internalDeadline: "2026-09-25",
    manualHours: 16,
    manualDays: 2,
    realHours: 102.4,
    realDays: 12.8,
    progress: 67,
  });
});

test("project mobile facts fall back to lead name and use the filtered month's hours for real time", () => {
  const { projectMobileFacts } = loadTypeScript("src/lib/mobile-view-models.ts");

  const facts = projectMobileFacts({ lead_name: "Fallback", total_hours: 100, total_days: 12.5 }, 20.04);
  assert.equal(facts.owner, "Fallback");
  assert.equal(facts.realHours, 20);
  assert.equal(facts.realDays, 2.5);
  assert.equal(facts.manualHours, 0);
  assert.equal(facts.geo, null);
  assert.equal(projectMobileFacts({}).owner, "Chưa phân công");
});

test("revenue mobile facts expose revenue before supporting hours", () => {
  const { revenueMobileFacts } = loadTypeScript("src/lib/mobile-view-models.ts");

  assert.deepEqual(revenueMobileFacts({ client_hours: "16", total_hours: 12.5 }, 4260000), {
    revenue: 4260000,
    clientHours: 16,
    actualHours: 12.5,
  });
});
