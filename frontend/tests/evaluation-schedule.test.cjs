const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const { loadTypeScript } = require("./helpers/load-typescript.cjs");

const calendar = () => loadTypeScript("src/lib/evaluation-schedule.ts");

function calendarWithClock(Clock) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync("src/lib/evaluation-schedule.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, Date: Clock, Intl, URLSearchParams });
  return module.exports;
}

test("Vietnam calendar opens at 08:00 day 1 through day 5 and targets previous month", () => {
  const { evaluationCycle } = calendar();
  const start = evaluationCycle(new Date("2026-11-01T01:00:00Z"));
  assert.equal(start.open, true);
  assert.equal(start.month, "2026-10");
  assert.equal(start.monthLabel, "10/2026");
  assert.equal(start.deadline, "05/11/2026");
  for (const [date, open] of [
    ["2026-11-01T00:59:59Z", false], ["2026-11-01T17:01:00Z", true],
    ["2026-11-05T16:59:59Z", true], ["2026-11-05T17:00:00Z", false],
    ["2026-11-27T01:00:00Z", false], ["2026-11-07T01:00:00Z", false],
  ]) assert.equal(evaluationCycle(new Date(date)).open, open, date);
  const january = evaluationCycle(new Date("2026-12-31T17:00:00Z"));
  assert.equal(january.month, "2026-12");
  assert.equal(january.deadline, "05/01/2027");
});

test("reminder links choose exact reviewed month and reject invalid or future month", () => {
  const { evaluationMonthFromSearch, evaluationNotificationUrl } = calendar();
  const now = new Date("2026-11-01T01:00:00Z");
  assert.equal(evaluationMonthFromSearch("", now), "2026-10");
  assert.equal(evaluationMonthFromSearch("?month=2026-09", now), "2026-09");
  for (const query of ["?month=2026-13", "?month=2027-01", "?month=oops", "?month=2026-00"]) {
    assert.equal(evaluationMonthFromSearch(query, now), "2026-10");
  }
  assert.equal(evaluationNotificationUrl({ sender_id: null, title: "Đánh giá định kì tháng 10/2026" }), "/peer-review?month=2026-10");
  assert.equal(evaluationNotificationUrl({ sender_id: null, title: "Đánh giá định kì tháng 12/2026" }), "/peer-review?month=2026-12");
  assert.equal(evaluationNotificationUrl({ sender_id: 3, title: "Đánh giá dự án" }), null);
});

test("voting opens at midnight on day 1, locks on day 6 and never reopens an old month", () => {
  const { evaluationCanEdit } = calendar();
  for (const [instant, month, allowed] of [
    ["2026-10-31T16:59:59Z", "2026-10", false],
    ["2026-10-31T17:00:00Z", "2026-10", true],
    ["2026-11-05T16:59:59Z", "2026-10", true],
    ["2026-11-05T17:00:00Z", "2026-10", false],
    ["2026-11-30T17:00:00Z", "2026-10", false],
    ["2026-11-30T17:00:00Z", "2026-11", true],
    ["2026-12-31T17:00:00Z", "2026-12", true],
  ]) assert.equal(evaluationCanEdit(month, new Date(instant)), allowed, `${instant} ${month}`);
});

function mountAlert(iso, stored = new Map()) {
  const slots = [], effects = [];
  let cursor = 0;
  const RealDate = Date;
  class Clock extends RealDate { constructor(...args) { super(...(args.length ? args : [iso])); } }
  const module = { exports: {} };
  const react = { ...require("react"),
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = value; }]; },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i]) { effects.push(fn); slots[i] = deps; } },
  };
  const source = ts.transpileModule(fs.readFileSync("src/components/evaluation-alert.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, Date: Clock, window: {},
    localStorage: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) },
    require: name => {
      if (name === "react") return react;
      if (name === "next/link") return { __esModule: true, default: "a" };
      if (name === "@/lib/roles") return { roleTier: () => "STAFF" };
      if (name === "@/lib/format") return { todayLocal: () => iso.slice(0, 10) };
      if (name === "@/lib/evaluation-schedule") return calendarWithClock(Clock);
      return require(name);
    },
  });
  return { render() { cursor = 0; const tree = module.exports.default({ user: { id: 7, role: "FIELD_STAFF" } }); effects.splice(0).forEach(fn => fn()); return tree; } };
}
const nodes = tree => !tree || typeof tree !== "object" ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const textOf = tree => tree == null || typeof tree === "boolean" ? "" : Array.isArray(tree) ? tree.map(textOf).join("") : typeof tree === "object" ? textOf(tree.props?.children) : String(tree);

test("popup follows monthly calendar, opens correct ballot and dismissal lasts entire cycle", () => {
  const storage = new Map();
  let app = mountAlert("2026-11-01T01:00:00Z", storage);
  app.render(); const tree = app.render();
  assert.ok(textOf(tree).includes("10/2026"));
  assert.ok(nodes(tree).some(node => node.type === "p" && textOf(node) === "Thời hạn: 01/11/2026 – 05/11/2026"));
  const link = nodes(tree).find(node => node.props?.href === "/peer-review?month=2026-10");
  assert.ok(link);
  link.props.onClick(); assert.equal(app.render(), null);
  app = mountAlert("2026-11-05T01:00:00Z", storage);
  app.render(); assert.equal(app.render(), null);
  app = mountAlert("2026-12-01T01:00:00Z", storage);
  app.render(); assert.ok(textOf(app.render()).includes("11/2026"));
  app = mountAlert("2026-11-07T01:00:00Z"); // Saturday, outside evaluation window
  app.render(); assert.equal(app.render(), null);
});

function mountForm(search = "", options = {}) {
  const slots = [], effects = [], calls = [], writes = [], timers = new Map();
  const location = { search };
  let instant = options.instant || "2026-11-01T01:00:00Z", nextTimer = 0;
  let cursor = 0, page = true;
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [instant])); } }
  const browser = { location, setTimeout: (fn, delay) => { timers.set(++nextTimer, { fn, delay }); return nextTimer; },
    clearTimeout: id => timers.delete(id), addEventListener() {}, removeEventListener() {} };
  const react = { ...require("react"),
    useState(initial) {
      const i = cursor++;
      if (page && i === 0) return [{ id: 7, role: "FIELD_STAFF", department: "" }, () => {}];
      if (!(i in slots)) slots[i] = { value: typeof initial === "function" ? initial() : initial, set: value => { slots[i].value = typeof value === "function" ? value(slots[i].value) : value; } };
      return [slots[i].value, slots[i].set];
    },
    useMemo: fn => fn(),
    useEffect(fn, deps) {
      const i = cursor++, prior = slots[i];
      if (!prior || deps.some((dep, j) => !Object.is(dep, prior.deps[j]))) {
        slots[i] = { deps };
        effects.push(() => { prior?.cleanup?.(); slots[i].cleanup = fn(); });
      }
    },
  };
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync("src/app/peer-review/page.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, Date: Clock, URLSearchParams, window: browser,
    document: { addEventListener() {}, removeEventListener() {} },
    require: name => {
      if (name === "react") return react;
      if (name === "next/navigation") return { useRouter: () => ({}), useSearchParams: () => new URLSearchParams(location.search) };
      if (name === "@/components/app-shell") return { __esModule: true, default: "main" };
      if (name === "@/lib/api") return { api: {
        peerReviewsMine: async month => { calls.push(month); return options.ballots || []; },
        savePeerReview: async payload => { writes.push(["save", payload]); return { ...payload, id: 12 }; },
        deletePeerReview: async id => { writes.push(["delete", id]); },
      } };
      if (name === "@/lib/format") return { monthLocal: () => "2026-11" };
      if (name === "@/lib/use-sticky-state") return { useStickyState: (_, initial) => react.useState(initial) };
      if (name === "@/lib/departments") return { PRESET_DEPARTMENTS: [] };
      if (name === "@/lib/groups") return { normalizeDept: value => value };
      if (name === "@/components/filter-bar") return { splitDepts: () => [] };
      if (name === "@/lib/peer-review-forms") return loadTypeScript("src/lib/peer-review-forms.ts");
      if (name === "@/lib/evaluation-schedule") return calendarWithClock(Clock);
      return require(name);
    },
  });
  const tree = module.exports.default();
  const form = nodes(tree).find(node => typeof node.type === "function" && node.type.name === "ReviewForm");
  page = false; slots.length = 0; effects.length = 0;
  return { calls, writes, timers, navigate: search => { location.search = search; }, advance: iso => { instant = iso; },
    fireTimers() { const pending = [...timers.values()]; timers.clear(); pending.forEach(timer => timer.fn()); },
    render() { cursor = 0; const tree = form.type({ ...form.props, ownDepts: undefined,
      colleagues: [{ id: 8, full_name: "Peer", role: "FIELD_STAFF", department: "" }] }); effects.splice(0).forEach(fn => fn()); return tree; } };
}

test("actual ballot defaults to previous month, honors reminder link and retains manual selection", () => {
  for (const [query, expected] of [["", "2026-10"], ["?month=2026-09", "2026-09"], ["?month=2027-01", "2026-10"]]) {
    const app = mountForm(query);
    app.render(); const tree = app.render();
    const field = nodes(tree).find(node => node.type === "input" && node.props.type === "month");
    assert.equal(field.props.value, expected);
    assert.equal(app.calls.at(-1), expected);
    field.props.onChange({ target: { value: "2026-08" } });
    assert.equal(nodes(app.render()).find(node => node.props?.type === "month").props.value, "2026-08");
    assert.equal(app.calls.at(-1), "2026-08");
  }
});

test("clicking a reminder on the already-open ballot changes the selected month", () => {
  const app = mountForm(); app.render();
  const field = nodes(app.render()).find(node => node.props?.type === "month");
  field.props.onChange({ target: { value: "2026-09" } });
  assert.equal(nodes(app.render()).find(node => node.props?.type === "month").props.value, "2026-09");
  app.navigate("?month=2026-10"); app.render();
  assert.equal(nodes(app.render()).find(node => node.props?.type === "month").props.value, "2026-10");
  assert.equal(app.calls.at(-1), "2026-10");
});

test("open form locks automatically at Vietnam midnight; stale save/withdraw handlers cannot write", async () => {
  const app = mountForm("", { instant: "2026-11-05T16:59:59Z", ballots: [
    { id: 12, evaluatee_id: 8, evaluatee_name: "Peer", month: "2026-10", kind: "QUALITY", scores: [5, 4, 3] },
  ] });
  app.render(); await new Promise(resolve => setImmediate(resolve));
  let tree = app.render();
  const select = nodes(tree).find(node => node.type === "select" && nodes(node).some(child => child.type === "option" && child.props.value === 8));
  select.props.onChange({ target: { value: "8" } });
  app.render(); tree = app.render();
  const save = nodes(tree).find(node => node.type === "button" && textOf(node) === "Lưu sửa");
  const withdraw = nodes(tree).find(node => node.type === "button" && textOf(node) === "Rút lại");
  assert.equal(save.props.disabled, false);
  assert.equal(withdraw.props.disabled, false);
  assert.equal([...app.timers.values()][0]?.delay, 1000);
  app.advance("2026-11-05T17:00:00Z");
  await save.props.onClick(); await withdraw.props.onClick();
  assert.equal(app.writes.length, 0);
  app.fireTimers(); tree = app.render();
  assert.ok(textOf(tree).includes("đã khóa"));
  for (const node of nodes(tree).filter(node => typeof node.type === "function" && node.type.name === "ScorePicker")) assert.equal(node.props.disabled, true);
  assert.equal(nodes(tree).find(node => node.type === "button" && textOf(node) === "Lưu sửa").props.disabled, true);
  assert.equal(nodes(tree).find(node => node.type === "button" && textOf(node) === "Rút lại").props.disabled, true);
});
