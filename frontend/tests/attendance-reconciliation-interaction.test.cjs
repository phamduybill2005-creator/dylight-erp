const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { loadTypeScript } = require("./helpers/load-typescript.cjs");

// Run the component's real handlers and effects without a browser or a second React runtime.
function mount(api, role = "ADMIN") {
  const slots = [];
  const effects = [];
  const listeners = new Map();
  let cursor = 0;
  let refresh;
  let refreshOptions;
  function memo(value, deps, effect = false) {
    const index = cursor++;
    const prior = slots[index];
    if (prior && deps.every((value, i) => Object.is(value, prior.deps[i]))) return prior.value;
    if (effect) effects.push(() => { prior?.cleanup?.(); slots[index].cleanup = value(); });
    slots[index] = { value, deps };
    return value;
  }
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(value) { const index = cursor++; return slots[index] ||= { current: value }; },
    useCallback: (fn, deps) => memo(fn, deps),
    useEffect: (fn, deps) => memo(fn, deps, true),
  };
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/components/attendance-reconciliation-panel.tsx"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).outputText;
  function Results() {}
  vm.runInNewContext(source, { exports: module.exports, module, Error, window: { addEventListener: (event, listener) => listeners.set(event, listener), removeEventListener: event => listeners.delete(event) }, require: name => {
    if (name === "react") return react;
    if (name === "@/lib/api") return { api: { realUser: () => ({ role }), ...api } };
    if (name.includes("use-auto-refresh")) return { useAutoRefresh: (fn, options) => { refresh = fn; refreshOptions = options; } };
    if (name === "./attendance-reconciliation-results") return { default: Results };
    if (name.includes("attendance-reconciliation")) return loadTypeScript("src/lib/attendance-reconciliation.ts");
    return require(name);
  } });
  function render() {
    cursor = 0;
    const tree = module.exports.default({ date: "2026-11-06", user: { role, id: 1 } });
    effects.splice(0).forEach(effect => effect());
    return tree;
  }
  return { render, refresh: () => refresh(), get refreshOptions() { return refreshOptions; }, listeners, unmount: () => slots.forEach(slot => slot?.cleanup?.()) };
}
function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
const find = (tree, predicate) => nodes(tree).find(predicate);
const row = { user_id: 7, full_name: "Lan", work_date: "2026-11-06", department: "AI", morning: { session: "AM", status: "UNEXCUSED_LATE", override: null }, afternoon: { session: "PM", status: "PRESENT", override: null } };
const data = { rows: [row], confirmations: [], confirmation_available: { AM: true, PM: false } };
const flush = () => new Promise(resolve => setImmediate(resolve));

test("permission failure retains draft; reset success sends null and refreshes dynamic results", async () => {
  let reads = 0;
  let fail = true;
  const writes = [];
  const app = mount({ attendanceReconciliation: async () => { reads++; return data; }, setAttendancePermission: async payload => { writes.push(payload); if (fail) throw new Error("Không lưu được"); } });
  app.render(); await flush();
  let tree = app.render();
  find(tree, node => node.props?.onPermission)?.props.onPermission(row, "AM");
  tree = app.render();
  const initialDialog = find(tree, node => node.props?.role === "dialog");
  find(initialDialog, node => node.type === "input" && node.props.maxLength === 255).props.onChange({ target: { value: "Giám đốc" } });
  find(initialDialog, node => node.type === "textarea").props.onChange({ target: { value: "Đi khám" } });
  tree = app.render();
  await find(tree, node => node.props?.role === "dialog").props.onSubmit({ preventDefault() {} });
  tree = app.render();
  assert.ok(find(tree, node => node.props?.role === "dialog"));
  assert.equal(find(tree, node => node.type === "input" && node.props.maxLength === 255).props.value, "Giám đốc");
  assert.equal(find(tree, node => node.type === "textarea" && node.props.value === "Đi khám").props.value, "Đi khám");
  const dialog = find(tree, node => node.props?.role === "dialog");
  find(dialog, node => node.type === "select").props.onChange({ target: { value: "" } });
  tree = app.render(); fail = false;
  await find(tree, node => node.props?.role === "dialog").props.onSubmit({ preventDefault() {} });
  assert.equal(writes.length, 2);
  assert.equal(writes[1].decision, null);
  assert.equal(writes[1].reason, "Đi khám");
  assert.equal(writes[1].approved_by, "Giám đốc");
  assert.equal(reads, 2);
  assert.equal(find(app.render(), node => node.props?.role === "dialog"), undefined);
  app.unmount();
});

test("only ended sessions have explicit confirmation; failed confirmation preserves reason", async () => {
  const writes = [];
  const app = mount({ attendanceReconciliation: async () => data, confirmAttendanceData: async payload => { writes.push(payload); throw new Error("Máy đang ngoại tuyến"); } });
  app.render(); await flush();
  let tree = app.render();
  assert.equal(nodes(tree).filter(node => node.type === "form").length, 1);
  find(tree, node => node.type === "textarea").props.onChange({ target: { value: "Đã kiểm tra máy" } });
  tree = app.render();
  find(tree, node => node.type === "form").props.onSubmit({ preventDefault() {} }); await flush();
  tree = app.render();
  assert.equal(find(tree, node => node.type === "textarea").props.value, "Đã kiểm tra máy");
  assert.equal(writes[0].session, "AM");
  assert.ok(find(tree, node => node.props?.role === "alert"));
  assert.deepEqual(Array.from(app.refreshOptions.topics), ["attendance", "leave", "schedule", "users"]);
  assert.equal(app.refreshOptions.intervalMs, 20_000);
  assert.ok(app.listeners.has("attendance-reconciliation-changed"));
  app.unmount();
  assert.equal(app.listeners.size, 0);
});

test("directors can inspect team results but receive no mutation controls", async () => {
  const app = mount({ attendanceReconciliation: async () => data }, "DIRECTOR");
  app.render(); await flush();
  const tree = app.render();
  assert.equal(find(tree, node => node.props?.onPermission).props.isAdmin, false);
  assert.equal(nodes(tree).filter(node => node.type === "form").length, 0);
  app.unmount();
});

test("permission editor defaults absence sessions to absence and preserves prior overrides", async () => {
  const app = mount({ attendanceReconciliation: async () => data });
  app.render(); await flush();
  for (const [status, checkIn, prior, expected] of [
    ["UNEXCUSED_ABSENCE", "2026-11-06T13:00:00", null, "EXCUSED_ABSENCE"],
    ["WAITING_DATA", null, null, "EXCUSED_ABSENCE"],
    ["WAITING_DATA", "2026-11-06T08:00:00", null, "EXCUSED_LATE"],
    ["UNEXCUSED_LATE", "2026-11-06T08:40:00", null, "EXCUSED_LATE"],
    ["UNEXCUSED_ABSENCE", null, { decision: "EXCUSED_LATE", reason: "Đã xác nhận", approved_by: "Giám đốc" }, "EXCUSED_LATE"],
  ]) {
    let tree = app.render();
    const target = { ...row, check_in: checkIn, check_out: null, morning: { ...row.morning, status, override: prior } };
    find(tree, node => node.props?.onPermission).props.onPermission(target, "AM");
    tree = app.render();
    const dialog = find(tree, node => node.props?.role === "dialog");
    assert.equal(find(dialog, node => node.type === "select").props.value, expected, status);
  }
  app.unmount();
});
