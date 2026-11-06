const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { loadTypeScript } = require("./helpers/load-typescript.cjs");

function render(props) {
  const filename = path.join(__dirname, "../src/components/attendance-reconciliation-results.tsx");
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, { exports: module.exports, module, require: name => name.includes("attendance-reconciliation") ? loadTypeScript("src/lib/attendance-reconciliation.ts") : require(name) });
  return renderToStaticMarkup(React.createElement(module.exports.default, { rows: [], loading: false, error: null, hasData: true, filtered: false, isAdmin: false, onPermission() {}, ...props }));
}
const morning = { session: "AM", status: "WAITING_DATA", late_minutes: 0, explanation: "Máy chưa gửi đủ dữ liệu", leave_id: null, permission_source: null, override: null, data_confirmed: false };
const row = { user_id: 3, full_name: "Nguyễn Lan", department: "AI", work_date: "2026-11-06", attendance_id: null, check_in: null, check_out: null, needs_attention: true, morning, afternoon: { ...morning, session: "PM", status: "PENDING_APPROVAL", leave_id: 42 } };

test("loading, failed request, successful empty result and filtered emptiness are distinct", () => {
  assert.match(render({ loading: true, hasData: false }), /Đang tải đối chiếu/);
  const failed = render({ error: "Mất kết nối", hasData: false });
  assert.match(failed, /role="alert"/);
  assert.doesNotMatch(failed, /Không có nhân sự/);
  assert.match(render({}), /Không có nhân sự trong phạm vi/);
  assert.match(render({ filtered: true }), /Không có kết quả khớp bộ lọc/);
});

test("a person without punches remains visible as waiting and pending leave stays unapproved", () => {
  const html = render({ rows: [row] });
  assert.match(html, /Nguyễn Lan/);
  assert.match(html, /Chờ đủ dữ liệu/);
  assert.match(html, /Chờ duyệt đơn/);
  assert.match(html, /Chưa xác nhận đủ dữ liệu nguồn/);
  assert.match(html, /href="\/leave\?request_id=42"/);
  assert.doesNotMatch(html, /Nghỉ không phép/);
  assert.doesNotMatch(html, /Xác nhận phép/);
  assert.match(render({ rows: [row], isAdmin: true }), /Xác nhận phép/);
});

test("administrator basis shows reason and authorizer separately from actual punches", () => {
  const html = render({ rows: [{ ...row, check_in: "2026-11-06T08:40:00+07:00", morning: { ...morning, status: "EXCUSED_LATE", permission_source: "ADMIN", override: { decision: "EXCUSED_LATE", approved_by: "Chị Hà", reason: "Đi khám", recorded_by: "Admin", updated_at: "2026-11-06T10:00:00+07:00" } } }] });
  assert.match(html, /Xác nhận của quản trị/);
  assert.match(html, /Chị Hà/);
  assert.match(html, /Đi khám/);
  assert.match(html, /Mốc chấm thực tế/);
});
