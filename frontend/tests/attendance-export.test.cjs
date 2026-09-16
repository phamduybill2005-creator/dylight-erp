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

test("exports only people shown in the on-screen summary list", async () => {
  // Bảng Tổng hợp trên màn hình dựng từ /attendance/summary: CHỈ người có dữ liệu
  // chấm công trong tháng. File Excel phải khớp đúng danh sách đó — trước đây nó
  // lấy MỌI tài khoản từ /users nên lòi ra người không có trên màn hình (vd tài
  // khoản Giám đốc "Nguyễn Văn Giám" không chấm công: dòng 0 / 0 / 0).
  const loadAttendanceExportRows = loadExportRows();
  const user = (id, full_name, department, role = "FIELD_STAFF") => ({
    id, company_id: 1, email: `u${id}@example.com`, full_name, role,
    is_active: true, is_approved: true, department,
  });
  const client = {
    users: async () => [
      user(1, "L.T.KHAI", "Phòng Thiết kế đường 2D"),
      user(2, "Nguyễn Văn Giám", null, "DIRECTOR"),   // không chấm công tháng này
      user(3, "N.V.HOA", "Phòng bản đồ"),             // chỉ khai giờ dự án, không chấm công
      user(4, "D.D.TRUONG", "Phòng AI"),
    ],
    timesheets: async () => [
      { id: 1, user_id: 1, project_id: 9, work_date: "2026-09-10", hours: 80 },
      { id: 2, user_id: 3, project_id: 9, work_date: "2026-09-10", hours: 12 },
    ],
    attendanceSummary: async () => [
      { user_id: 1, full_name: "L.T.KHAI", present_days: 13, late_days: 2, total_hours: 101.6 },
      { user_id: 4, full_name: "D.D.TRUONG", present_days: 4, late_days: 1, total_hours: 30.1 },
    ],
  };

  const result = await loadAttendanceExportRows(client, "2026-09", "", []);
  const names = result.rows.map((r) => r[1]);

  assert.deepEqual(names, ["L.T.KHAI", "D.D.TRUONG"]);
  assert.ok(!names.includes("Nguyễn Văn Giám"), "không được xuất người không có trên màn hình");
  // STT đánh lại liền mạch sau khi lọc, không nhảy số.
  assert.deepEqual(result.rows.map((r) => r[0]), [1, 2]);
});
