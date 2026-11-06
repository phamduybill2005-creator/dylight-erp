const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { loadTypeScript } = require("./helpers/load-typescript.cjs");

function mount(api, role = "ADMIN") {
  const slots = [], effects = [], portals = [], saved = [];
  const listeners = new Map();
  let cursor = 0, refresh, refreshOptions;
  const props = { userId: 7, period: "2026-11", user: { role, id: 1 }, onSaved: value => saved.push(value) };
  function memo(value, deps, effect = false) {
    const index = cursor++, prior = slots[index];
    if (prior && deps.every((value, i) => Object.is(value, prior.deps[i]))) return prior.value;
    if (effect) effects.push(() => { prior?.cleanup?.(); slots[index].cleanup = value(); });
    slots[index] = { value, deps }; return value;
  }
  const react = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
    useRef(value) { const index = cursor++; return slots[index] ||= { current: value }; },
    useCallback: (fn, deps) => memo(fn, deps), useEffect: (fn, deps) => memo(fn, deps, true),
  };
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/components/compact-attendance-days.tsx"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).outputText;
  function Rows() {} function TimeEditor() {}
  const body = {};
  vm.runInNewContext(source, { exports: module.exports, module, Error, document: { body },
    window: { addEventListener: (event, listener) => listeners.set(event, listener), removeEventListener: event => listeners.delete(event) },
    require: name => {
      if (name === "react") return react;
      if (name === "react-dom") return { createPortal: (tree, target) => { portals.push(target); return tree; } };
      if (name === "@/lib/api") return { api: { realUser: () => ({ role }), attendanceList: async () => [], attendanceReconciliation: async () => ({ rows: [] }), ...api } };
      if (name.includes("use-auto-refresh")) return { useAutoRefresh: (fn, options) => { refresh = fn; refreshOptions = options; } };
      if (name === "./compact-attendance-day-rows") return { default: Rows };
      if (name === "./attendance-time-editor") return { default: TimeEditor };
      if (name === "@/lib/compact-attendance-days") return loadTypeScript("src/lib/compact-attendance-days.ts");
      if (name === "@/lib/attendance-reconciliation") return loadTypeScript("src/lib/attendance-reconciliation.ts");
      return require(name);
    },
  });
  return { props, Rows, TimeEditor, saved, portals, body, listeners,
    render() { cursor = 0; const tree = module.exports.default(props); effects.splice(0).forEach(effect => effect()); return tree; },
    refresh: () => refresh(), get refreshOptions() { return refreshOptions; }, unmount: () => slots.forEach(slot => slot?.cleanup?.()),
  };
}
function nodes(tree) { if (!tree || typeof tree !== "object") return []; if (Array.isArray(tree)) return tree.flatMap(nodes); return [tree, ...nodes(tree.props?.children)]; }
const find = (tree, predicate) => nodes(tree).find(predicate);
const rows = (app, tree) => find(tree, node => node.type === app.Rows);
const flush = () => new Promise(resolve => setImmediate(resolve));
function edit(app, date = "2026-11-02") { const view = rows(app, app.render()); view.props.onEdit(view.props.days.find(day => day.work_date === date)); return app.render(); }
function fill(tree, key, value) { find(tree, node => node.props?.["aria-label"] === key).props.onChange({ target: { value } }); }
const realRecord = { id: 12, user_id: 7, work_date: "2026-11-02", check_in: "2026-11-02T08:40:00", check_out: "2026-11-02T17:00:00", worked_minutes: 440, note: "Ghi chú cũ" };

test("no-punch full-day permission saves atomically, keeps failed drafts and refreshes before displaying CP", async () => {
  let reads = 0, fail = true;
  const writes = [];
  const app = mount({ attendanceReconciliation: async () => { reads++; return { rows: [] }; }, setAttendanceDayPermission: async payload => { writes.push(payload); if (fail) throw new Error("Mất kết nối"); } });
  app.render(); await flush();
  let tree = edit(app);
  assert.equal(find(tree, node => node.type === app.TimeEditor), undefined);
  fill(tree, "Người cho phép", "Giám đốc"); fill(tree, "Lý do xác nhận", "Đã xin qua Zalo");
  tree = app.render(); await find(tree, node => node.type === "form").props.onSubmit({ preventDefault() {} });
  tree = app.render();
  assert.ok(find(tree, node => node.props?.role === "alert"));
  assert.equal(find(tree, node => node.props?.["aria-label"] === "Lý do xác nhận").props.value, "Đã xin qua Zalo");
  assert.equal(rows(app, tree).props.days[1].badges[0].label, "Chưa có chấm công");
  fail = false; await find(tree, node => node.type === "form").props.onSubmit({ preventDefault() {} });
  assert.equal(writes.length, 2);
  assert.deepEqual(Array.from(writes[1].sessions), ["AM", "PM"]);
  assert.equal(writes[1].decision, "EXCUSED_ABSENCE");
  assert.equal(reads, 2);
  assert.equal(find(app.render(), node => node.props?.role === "dialog"), undefined);
  assert.ok(app.portals.every(target => target === app.body));
  app.unmount();
});

test("reset chooses one session and actual time editing reuses the existing real record", async () => {
  let reads = 0;
  const writes = [];
  const app = mount({ attendanceList: async () => [realRecord], attendanceReconciliation: async () => { reads++; return { rows: [] }; }, setAttendanceDayPermission: async payload => writes.push(payload) });
  app.render(); await flush(); let tree = edit(app);
  const timeEditor = find(tree, node => node.type === app.TimeEditor);
  assert.equal(timeEditor.props.record, realRecord);
  timeEditor.props.onSaved({ ...realRecord, worked_minutes: 450 }); await flush();
  assert.equal(reads, 2);
  tree = app.render(); fill(tree, "Buổi áp dụng", "PM"); fill(tree, "Xác nhận phép", ""); fill(tree, "Người cho phép", "Giám đốc"); fill(tree, "Lý do xác nhận", "Đặt lại");
  tree = app.render(); await find(tree, node => node.type === "form").props.onSubmit({ preventDefault() {} });
  assert.deepEqual(Array.from(writes[0].sessions), ["PM"]);
  assert.equal(writes[0].decision, null);
  assert.equal(app.saved[0].worked_minutes, 450);
  app.unmount();
});

test("note failures keep drafts during leave refresh and non-admins have no permission controls", async () => {
  const app = mount({ attendanceList: async () => [realRecord], updateAttendance: async () => { throw new Error("Không lưu được ghi chú"); } }, "DIRECTOR");
  app.render(); await flush(); let view = rows(app, app.render());
  assert.equal(view.props.isAdmin, false);
  view.props.onNoteChange(realRecord.id, "Bản nháp");
  view = rows(app, app.render()); view.props.onNoteSave(view.props.days[1]); await flush();
  await app.refresh();
  view = rows(app, app.render());
  assert.equal(view.props.notes[realRecord.id], "Bản nháp");
  assert.match(view.props.noteErrors[realRecord.id], /Không lưu/);
  view.props.onEdit(view.props.days[1]);
  assert.equal(find(app.render(), node => node.props?.role === "dialog"), undefined);
  assert.deepEqual(Array.from(app.refreshOptions.topics), ["attendance", "leave", "schedule"]);
  app.unmount(); assert.equal(app.listeners.size, 0);
});

test("failed reads never look like empty attendance and stale refreshes cannot replace newer results", async () => {
  let resolveFirst, count = 0;
  const app = mount({ attendanceReconciliation: () => ++count === 1 ? new Promise(resolve => { resolveFirst = resolve; }) : Promise.resolve({ rows: [] }) });
  app.render(); await app.refresh();
  assert.equal(rows(app, app.render()).props.days.length, 30);
  resolveFirst({ rows: [{ user_id: 7, work_date: "2026-11-02", morning: { status: "EXCUSED_ABSENCE" }, afternoon: { status: "EXCUSED_ABSENCE" } }] }); await flush();
  assert.equal(rows(app, app.render()).props.days[1].badges[0].label, "Chưa có chấm công");
  app.unmount();
  const failed = mount({ attendanceReconciliation: async () => { throw new Error("Máy chủ lỗi"); } });
  failed.render(); await flush();
  assert.ok(find(failed.render(), node => node.props?.role === "alert"));
  assert.equal(rows(failed, failed.render()), undefined);
  failed.unmount();
});

test("historical read-only permission keeps approved status and actual time editor but never grants permission", async () => {
  const session = { status: "EXCUSED_ABSENCE", explanation: "Đơn đã duyệt", permission_source: "LEAVE", override: null, leave_id: 8, late_minutes: 0 };
  const historical = { user_id: 7, work_date: "2026-11-02", can_edit_permission: false, morning: { ...session, session: "AM" }, afternoon: { ...session, session: "PM" } };
  let writes = 0;
  const app = mount({ attendanceList: async () => [realRecord], attendanceReconciliation: async () => ({ rows: [historical] }), setAttendanceDayPermission: async () => writes++ });
  app.render(); await flush();
  assert.equal(rows(app, app.render()).props.days[1].badges[0].label, "Nghỉ có phép");
  const tree = edit(app);
  assert.equal(find(tree, node => node.type === "form"), undefined);
  assert.equal(find(tree, node => node.type === app.TimeEditor).props.record, realRecord);
  assert.ok(find(tree, node => typeof node.props?.children === "string" && node.props.children.includes("Xác nhận phép chỉ đọc")));
  assert.equal(writes, 0);
  app.unmount();
});

test("a permission editor becoming read-only cannot submit its earlier handler, and reset explains approved leave", async () => {
  const session = { status: "EXCUSED_ABSENCE", explanation: "Đơn đã duyệt", permission_source: "LEAVE", override: null, leave_id: 8, late_minutes: 0 };
  let canEdit = true, writes = 0;
  const app = mount({ attendanceList: async () => [realRecord], attendanceReconciliation: async () => ({ rows: [{ user_id: 7, work_date: "2026-11-02", can_edit_permission: canEdit, morning: { ...session, session: "AM" }, afternoon: { ...session, session: "PM" } }] }), setAttendanceDayPermission: async () => writes++ });
  app.render(); await flush(); let tree = edit(app);
  fill(tree, "Xác nhận phép", ""); fill(tree, "Người cho phép", "Giám đốc"); fill(tree, "Lý do xác nhận", "Đặt lại");
  tree = app.render();
  assert.ok(find(tree, node => node.props?.children === "Chỉ gỡ xác nhận của Admin; đơn đã duyệt vẫn áp dụng."));
  const earlierSubmit = find(tree, node => node.type === "form").props.onSubmit;
  canEdit = false; await app.refresh(); app.render();
  await earlierSubmit({ preventDefault() {} });
  assert.equal(writes, 0);
  app.unmount();
});
