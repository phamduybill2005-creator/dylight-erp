// Run from frontend: node --test tests/attendance-export.test.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");

function loadExportRows() {
  const modulePath = path.join(__dirname, "../src/lib/attendance-export.ts");
  if (!fs.existsSync(modulePath)) return undefined;
  const module = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(modulePath, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(compiled, { exports: module.exports, module });
  return module.exports.loadAttendanceExportRows;
}

test("exports only users returned by the latest server request", async () => {
  const loadAttendanceExportRows = loadExportRows();
  assert.equal(
    typeof loadAttendanceExportRows,
    "function",
    "attendance export loader is not implemented",
  );

  let userLoads = 0;
  const client = {
    users: async () => {
      userLoads += 1;
      return [{
        id: 1,
        company_id: 1,
        email: "current@example.com",
        full_name: "Nhân viên hiện tại",
        role: "FIELD_STAFF",
        is_active: true,
        is_approved: true,
        department: "Phòng AI",
      }];
    },
    timesheets: async () => [
      { id: 10, user_id: 1, project_id: 2, work_date: "2026-09-10", hours: 8 },
      { id: 11, user_id: 99, project_id: 2, work_date: "2026-09-10", hours: 80 },
    ],
    attendanceSummary: async () => [
      { user_id: 1, full_name: "Nhân viên hiện tại", present_days: 1, late_days: 1, total_hours: 7.5 },
      { user_id: 99, full_name: "Người đã xóa", present_days: 20, late_days: 2, total_hours: 160 },
    ],
  };

  const result = await loadAttendanceExportRows(client, "2026-09", "", []);

  assert.equal(userLoads, 1);
  assert.deepEqual(Array.from(result.users, (u) => u.id), [1]);
  assert.deepEqual(Array.from(result.rows[0]), [
    1,
    "Nhân viên hiện tại",
    "Phòng AI",
    8,
    7.5,
    1,
  ]);
  assert.equal(result.rows.length, 1);
});
