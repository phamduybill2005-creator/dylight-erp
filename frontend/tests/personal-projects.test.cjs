const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");

const moduleExports = {};
vm.runInNewContext(ts.transpileModule(
  fs.readFileSync(path.join(__dirname, "../src/lib/personal-projects.ts"), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText, { exports: moduleExports });
const { personalProjects } = moduleExports;
const user = { id: 7, company_id: 1 };
const project = (id, overrides = {}) => ({
  id, company_id: 1, status: "IN_PROGRESS", members: [], ...overrides,
});

test("counts direct members and leads once, excluding department-only or company-wide visibility", () => {
  const rows = [
    project(1, { lead_id: 7 }),
    project(2, { members: [{ id: 7 }] }),
    project(3, { lead_id: 7, members: [{ id: 7 }, { id: 7 }] }),
    project(4, { lead_id: 9, members: [{ id: 8 }], group_name: "Phòng AI" }),
    project(5, { dosco_manager: "Demo", geo_manager: "Demo" }),
  ];
  assert.deepEqual(personalProjects(rows, user).map((p) => p.id), [1, 2, 3]);
});

test("excludes completed, closed, deleted and other-company projects", () => {
  const rows = [
    project(1, { lead_id: 7, status: "PLANNING" }),
    project(2, { lead_id: 7, status: "ON_HOLD" }),
    project(3, { lead_id: 7, status: "COMPLETED" }),
    project(4, { lead_id: 7, status: "CLOSED" }),
    project(5, { lead_id: 7, is_deleted: true }),
    project(6, { lead_id: 7, company_id: 2 }),
  ];
  assert.deepEqual(personalProjects(rows, user).map((p) => p.id), [1, 2]);
});

test("refreshed assignments, completion and removal immediately change the personal list", () => {
  const initial = [project(1, { members: [{ id: 7 }] })];
  assert.equal(personalProjects(initial, user).length, 1);
  const assigned = [...initial, project(2, { members: [{ id: 7 }] })];
  assert.deepEqual(personalProjects(assigned, user).map((p) => p.id), [1, 2]);
  const refreshed = [project(1, { status: "COMPLETED", members: [{ id: 7 }] }), project(2)];
  assert.equal(personalProjects(refreshed, user).length, 0);
  assert.equal(personalProjects([project(3, { members: undefined })], user).length, 0);
});
