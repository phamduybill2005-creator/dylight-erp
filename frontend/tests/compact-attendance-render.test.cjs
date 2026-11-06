const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { loadTypeScript } = require("./helpers/load-typescript.cjs");

function render(days, isAdmin = true) {
  const filename = path.join(__dirname, "../src/components/compact-attendance-day-rows.tsx");
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, { exports: module.exports, module, require: name => name.includes("attendance-reconciliation") ? loadTypeScript("src/lib/attendance-reconciliation.ts") : require(name) });
  return renderToStaticMarkup(React.createElement(module.exports.default, { days, isAdmin, notes: {}, noteErrors: {}, noteSaving: {}, onEdit() {}, onNoteChange() {}, onNoteSave() {} }));
}
const unknown = { work_date: "2026-11-02", record: null, result: null, future: false, badges: [{ label: "Chưa có chấm công", title: "Chờ kiểm tra nguồn", tone: "muted" }] };

test("no-punch dates have a date-adjacent ADMIN pencil and a compact honest status, without notes or synthetic hours", () => {
  const html = render([unknown]);
  assert.match(html, /02\/11/);
  assert.match(html, /aria-label="Sửa chấm công ngày 02\/11"/);
  assert.match(html, /Chưa có chấm công/);
  assert.doesNotMatch(html, /<input/);
  assert.doesNotMatch(html, /0\.0h/);
  assert.doesNotMatch(html, /Nghỉ có phép/);
  assert.doesNotMatch(render([unknown], false), /Sửa chấm công/);
  assert.doesNotMatch(render([{ ...unknown, future: true }]), /Sửa chấm công/);
});

test("approved absence needs no punch and actual hours and note remain visible only for a real record", () => {
  const absent = { ...unknown, badges: [{ label: "Nghỉ có phép", title: "Đơn đã duyệt", tone: "good" }] };
  const html = render([absent]);
  assert.equal((html.match(/>Nghỉ có phép<\/span>/g) || []).length, 1);
  const worked = { ...unknown, record: { id: 12, check_in: "2026-11-02T08:40:00", check_out: "2026-11-02T17:00:00", worked_minutes: 440, note: "Đi khám" } };
  const real = render([worked]);
  assert.match(real, /08:40 – 17:00/);
  assert.match(real, /7\.3h/);
  assert.match(real, /value="Đi khám"/);
  assert.match(real, /data-attendance-id="12"/);
});

test("the complete month renders compact day rows with no per-day source paragraphs", () => {
  const { buildCompactAttendanceDays } = loadTypeScript("src/lib/compact-attendance-days.ts");
  const html = render(buildCompactAttendanceDays("2026-11", 7, [], [], "2026-11-06"));
  assert.equal((html.match(/data-work-date=/g) || []).length, 30);
  assert.equal((html.match(/Sửa chấm công ngày/g) || []).length, 6);
  assert.doesNotMatch(html, /<p[ >]/);
});

test("historical read-only approved absence stays visible without a permission pencil, while real clock rows retain it", () => {
  const historical = { ...unknown, result: { can_edit_permission: false }, badges: [{ label: "Nghỉ có phép", title: "Đơn đã duyệt", tone: "good" }] };
  const html = render([historical]);
  assert.match(html, />Nghỉ có phép<\/span>/);
  assert.doesNotMatch(html, /Sửa chấm công/);
  const clock = render([{ ...historical, record: { id: 12, check_in: "2026-11-02T08:40:00", check_out: "2026-11-02T17:00:00", worked_minutes: 440 } }]);
  assert.match(clock, /Sửa chấm công ngày 02\/11/);
  assert.match(clock, /08:40 – 17:00/);
});
