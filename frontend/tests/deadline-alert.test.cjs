const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { loadTypeScript } = require("./helpers/load-typescript.cjs");

function select(projects, today = "2026-10-01") {
  const file = "src/lib/deadline-alert.ts";
  const selector = fs.existsSync(path.resolve(__dirname, "..", file))
    ? loadTypeScript(file).projectsDueToday : undefined;
  assert.equal(typeof selector, "function", "deadline-day selector is not implemented");
  return selector(projects, today);
}

const project = (id, extra = {}) => ({
  id, name: `Project ${id}`, status: "IN_PROGRESS",
  internal_deadline: null, end_date: null, ...extra,
});

test("only today's deadlines trigger reminders, excluding tomorrow, 61 days away and overdue", () => {
  const rows = select([
    project(1, { end_date: "2026-10-01" }),
    project(2, { end_date: "2026-10-02" }),
    project(3, { end_date: "2026-12-01" }),
    project(4, { end_date: "2026-09-30" }),
    project(5),
  ]);
  assert.deepEqual(rows.map((row) => row.p.id), [1]);
  assert.equal(rows[0].due, "2026-10-01");
});

test("uses the earlier internal or completion deadline and supports either date on its own", () => {
  const rows = select([
    project(1, { internal_deadline: "2026-10-01", end_date: "2026-11-30" }),
    project(2, { internal_deadline: "2026-11-30", end_date: "2026-10-01" }),
    project(3, { internal_deadline: "2026-10-01" }),
    project(4, { internal_deadline: "2026-09-30", end_date: "2026-10-01" }),
    project(5, { internal_deadline: "2026-10-01", end_date: "2026-09-30" }),
  ]);
  assert.deepEqual(rows.map((row) => row.p.id), [1, 2, 3]);
});

test("completed, closed and deleted projects never trigger reminders", () => {
  assert.deepEqual(select([
    project(1, { end_date: "2026-10-01", status: "COMPLETED" }),
    project(2, { end_date: "2026-10-01", status: "CLOSED" }),
    project(3, { end_date: "2026-10-01", is_deleted: true }),
  ]), []);
});

test("a deadline only triggers on its own calendar date", () => {
  const projects = [project(1, { internal_deadline: "2026-10-02" })];
  assert.deepEqual(select(projects, "2026-10-01"), []);
  assert.deepEqual(select(projects, "2026-10-02").map((row) => row.p.id), [1]);
  assert.deepEqual(select(projects, "2026-10-03"), []);
});
