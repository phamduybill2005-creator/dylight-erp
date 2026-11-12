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
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
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
  vm.runInNewContext(source, { module, exports: module.exports, Date: Clock, Error, URLSearchParams, window: browser,
    document: { addEventListener() {}, removeEventListener() {} },
    require: name => {
      if (name === "react") return react;
      if (name === "next/navigation") return { useRouter: () => ({}), useSearchParams: () => new URLSearchParams(location.search) };
      if (name === "@/components/app-shell") return { __esModule: true, default: "main" };
      if (name === "@/lib/api") return { api: {
        me: async () => ({ id: 7, role: "FIELD_STAFF", department: "" }),
        colleagues: async () => options.colleagues || [],
        peerReviewsMine: async month => { calls.push(month); return options.load ? options.load(month) : options.ballots || []; },
        savePeerReview: async payload => { writes.push(["save", payload]); return options.save ? options.save(payload) : { ...payload, id: 12 }; },
        deletePeerReview: async id => { writes.push(["delete", id]); if (options.withdraw) return options.withdraw(id); },
      } };
      if (name === "@/lib/format") return { monthLocal: () => "2026-11" };
      if (name === "@/lib/use-sticky-state") return { useStickyState: (_, initial) => react.useState(initial) };
      if (name === "@/lib/departments") return { PRESET_DEPARTMENTS: [] };
      if (name === "@/lib/groups") return { normalizeDept: value => value };
      if (name === "@/components/filter-bar") return { splitDepts: value => (value || "").split(",").map(dept => dept.trim()).filter(Boolean) };
      if (name === "@/lib/peer-review-forms") return loadTypeScript("src/lib/peer-review-forms.ts");
      if (name === "@/lib/evaluation-schedule") return calendarWithClock(Clock);
      return require(name);
    },
  });
  const tree = module.exports.default();
  const form = nodes(tree).find(node => typeof node.type === "function" && node.type.name === "ReviewForm" && (!options.kind || node.props.def.kind === options.kind));
  if (!options.page) { page = false; slots.length = 0; effects.length = 0; }
  return { calls, writes, timers, navigate: search => { location.search = search; }, advance: iso => { instant = iso; },
    fireTimers() { const pending = [...timers.values()]; timers.clear(); pending.forEach(timer => timer.fn()); },
    render() { cursor = 0; const tree = options.page ? module.exports.default() : form.type({ ...form.props, ownDepts: options.ownDepts ?? ["AI"],
      colleagues: options.colleagues || [{ id: 8, full_name: "Peer", role: "FIELD_STAFF", department: "AI" }] }); effects.splice(0).forEach(fn => fn()); return tree; } };
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

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const ballot = (month, id = 12, evaluatee_id = 8, scores = [5, 4, 3]) =>
  ({ id, evaluatee_id, evaluatee_name: evaluatee_id === 8 ? "Peer" : "Other", month, kind: "QUALITY", scores });
const monthField = tree => nodes(tree).find(node => node.props?.type === "month");
const personField = tree => nodes(tree).find(node => node.type === "select" && nodes(node).some(child => child.type === "option" && child.props.value === 8));
const button = (tree, label) => nodes(tree).find(node => node.type === "button" && textOf(node) === label);
const pickers = tree => nodes(tree).filter(node => typeof node.type === "function" && node.type.name === "ScorePicker");
const renderForm = app => { app.render(); app.render(); return app.render(); };
async function settleForm(app) { await new Promise(resolve => setImmediate(resolve)); return renderForm(app); }
function choosePeer(app, id = "8") { personField(renderForm(app)).props.onChange({ target: { value: id } }); return renderForm(app); }
function setScores(app, values) { pickers(renderForm(app)).forEach((picker, i) => picker.props.onChange(values[i])); return renderForm(app); }

test("month change hides old ballots and blocks edits until its read succeeds", async () => {
  const october = deferred();
  const app = mountForm("?month=2026-09", { load: month => month === "2026-09" ? [ballot("2026-09")] : october.promise });
  renderForm(app); await settleForm(app); choosePeer(app);
  monthField(renderForm(app)).props.onChange({ target: { value: "2026-10" } });
  let tree = renderForm(app);
  assert.ok(!textOf(tree).includes("Đã chấm Peer tháng 10/2026"));
  assert.ok(!button(tree, "Rút lại"));
  assert.ok(pickers(tree).every(picker => picker.props.disabled));
  october.resolve([ballot("2026-10", 13, 8, [2, 2, 2])]);
  tree = await settleForm(app);
  assert.deepEqual(pickers(tree).map(picker => picker.props.value), [2, 2, 2]);
  assert.ok(pickers(tree).every(picker => !picker.props.disabled));
});

test("failed ballot read stays blocked and retry restores authoritative saved scores", async () => {
  let attempts = 0;
  const app = mountForm("", { load: () => ++attempts === 1 ? Promise.reject(new Error("offline")) : [ballot("2026-10")] });
  renderForm(app); choosePeer(app);
  let tree = await settleForm(app);
  assert.ok(nodes(tree).some(node => node.props?.role === "alert" && textOf(node).includes("offline")));
  assert.ok(pickers(tree).every(picker => picker.props.disabled));
  const retry = button(tree, "Thử lại"); assert.ok(retry);
  retry.props.onClick(); renderForm(app);
  tree = await settleForm(app);
  assert.deepEqual(pickers(tree).map(picker => picker.props.value), [5, 4, 3]);
  assert.equal(button(tree, "Lưu sửa").props.disabled, false);
});

test("pending initial read cannot accept a save that its later snapshot would erase", async () => {
  const read = deferred();
  const app = mountForm("", { load: () => read.promise });
  renderForm(app); choosePeer(app); setScores(app, [1, 2, 3]);
  const tree = renderForm(app);
  assert.ok(pickers(tree).every(picker => picker.props.disabled));
  await nodes(tree).find(node => node.type === "button" && textOf(node).startsWith("Gửi đánh giá")).props.onClick();
  assert.equal(app.writes.length, 0);
  read.resolve([]); await settleForm(app);
});

test("one save blocks synchronous duplicate handlers and all selection controls", async () => {
  const saved = deferred();
  const app = mountForm("", { ballots: [ballot("2026-10")], save: () => saved.promise });
  renderForm(app); await settleForm(app); const tree = choosePeer(app);
  const save = button(tree, "Lưu sửa").props.onClick;
  const first = save(); const duplicate = save();
  assert.equal(app.writes.length, 1);
  const pendingTree = renderForm(app);
  assert.ok(nodes(pendingTree).filter(node => node.type === "select" || node.props?.type === "month").every(node => node.props.disabled));
  assert.ok(nodes(pendingTree).filter(node => node.type === "button" && textOf(node).includes("Peer")).every(node => node.props.disabled));
  saved.resolve(ballot("2026-10")); await Promise.all([first, duplicate]);
});

test("old selection handlers cannot mutate the newly selected ballot", async () => {
  const app = mountForm("", { ballots: [ballot("2026-10"), ballot("2026-10", 13, 9)], colleagues: [
    { id: 8, full_name: "Peer", role: "FIELD_STAFF", department: "AI" },
    { id: 9, full_name: "Other", role: "FIELD_STAFF", department: "AI" },
  ] });
  renderForm(app); await settleForm(app); const tree = choosePeer(app);
  const staleSave = button(tree, "Lưu sửa").props.onClick;
  const staleWithdraw = button(tree, "Rút lại").props.onClick;
  choosePeer(app, "9");
  await staleSave(); await staleWithdraw();
  assert.equal(app.writes.length, 0);
});

for (const action of ["save", "withdraw"]) {
  test(`late ${action} after reminder navigation cannot alter another month's scores or status`, async () => {
    const mutation = deferred();
    const app = mountForm("?month=2026-10", { load: month => [ballot(month, month === "2026-10" ? 12 : 13, 8, month === "2026-10" ? [5, 4, 3] : [2, 2, 2])],
      save: () => mutation.promise, withdraw: () => mutation.promise });
    renderForm(app); await settleForm(app); const tree = choosePeer(app);
    const pending = button(tree, action === "save" ? "Lưu sửa" : "Rút lại").props.onClick();
    app.navigate("?month=2026-09"); renderForm(app); await settleForm(app);
    mutation.resolve(action === "save" ? ballot("2026-10") : undefined); await pending;
    const finalTree = renderForm(app);
    assert.deepEqual(pickers(finalTree).map(picker => picker.props.value), [2, 2, 2]);
    assert.ok(textOf(finalTree).includes("Đã chấm Peer tháng 09/2026"));
    assert.ok(!textOf(finalTree).includes(action === "save" ? "Đã lưu" : "Đã rút"));
    assert.ok(!textOf(finalTree).includes("4.0"));
  });
}

test("same-id save response refreshes displayed scores", async () => {
  const app = mountForm("", { ballots: [ballot("2026-10")], save: () => ballot("2026-10", 12, 8, [3, 3, 3]) });
  renderForm(app); await settleForm(app); choosePeer(app);
  await button(setScores(app, [1, 1, 1]), "Lưu sửa").props.onClick();
  assert.deepEqual(pickers(renderForm(app)).map(picker => picker.props.value), [3, 3, 3]);
});

test("historical quality chips cannot escape current department eligibility", async () => {
  const app = mountForm("", { ownDepts: ["BIM"], ballots: [ballot("2026-10")], colleagues: [
    { id: 8, full_name: "Peer", role: "FIELD_STAFF", department: "AI" },
  ] });
  renderForm(app); let tree = await settleForm(app);
  const chip = nodes(tree).find(node => node.type === "button" && textOf(node).includes("Peer"));
  assert.equal(chip.props.disabled, true);
  chip.props.onClick(); tree = renderForm(app);
  assert.equal(nodes(tree).find(node => node.type === "select").props.value, "BIM");
  assert.ok(pickers(tree).every(picker => picker.props.disabled));
});

test("page heading advances with the ballot cycle at Vietnam midnight", () => {
  const app = mountForm("", { page: true, instant: "2026-11-30T16:59:59Z" });
  assert.ok(textOf(renderForm(app)).includes("Đánh giá định kì tháng 10/2026"));
  assert.equal([...app.timers.values()][0]?.delay, 1000);
  app.advance("2026-11-30T17:00:00Z"); app.fireTimers();
  const tree = renderForm(app);
  assert.ok(textOf(tree).includes("Đánh giá định kì tháng 11/2026"));
  assert.ok(textOf(tree).includes("Thời hạn: 01/12/2026 – 05/12/2026"));
});

test("returning to a month during its pending save reloads after the mutation settles", async () => {
  const saved = deferred(); let persisted = false;
  const app = mountForm("?month=2026-10", { load: month => month === "2026-10" ? [ballot(month, 12, 8, persisted ? [1, 1, 1] : [5, 4, 3])] : [],
    save: async () => { await saved.promise; persisted = true; return ballot("2026-10", 12, 8, [1, 1, 1]); } });
  renderForm(app); await settleForm(app); choosePeer(app);
  const pending = button(setScores(app, [1, 1, 1]), "Lưu sửa").props.onClick();
  app.navigate("?month=2026-09"); renderForm(app); await settleForm(app);
  app.navigate("?month=2026-10"); renderForm(app); await settleForm(app);
  saved.resolve(); await pending; renderForm(app);
  assert.deepEqual(pickers(await settleForm(app)).map(picker => picker.props.value), [1, 1, 1]);
});

test("quality without a department has no eligible peers while team stays company wide", async () => {
  for (const kind of ["QUALITY", "TEAM"]) {
    const app = mountForm("", { kind, ownDepts: kind === "QUALITY" ? [] : undefined, colleagues: [
      { id: 8, full_name: "Peer", role: "FIELD_STAFF", department: "AI" },
    ] });
    renderForm(app); const tree = await settleForm(app);
    assert.equal(nodes(tree).some(node => node.type === "option" && node.props.value === 8), kind === "TEAM");
  }
});

test("quality history navigation selects a shared department instead of a foreign first department", async () => {
  const app = mountForm("", { ownDepts: ["BIM", "AI"], ballots: [ballot("2026-10")], colleagues: [
    { id: 8, full_name: "Peer", role: "FIELD_STAFF", department: "Map, AI" },
  ] });
  renderForm(app); let tree = await settleForm(app);
  const chip = nodes(tree).find(node => node.type === "button" && textOf(node).includes("Peer"));
  assert.equal(chip.props.disabled, false);
  chip.props.onClick(); tree = renderForm(app);
  assert.equal(nodes(tree).find(node => node.type === "select").props.value, "AI");
  assert.equal(personField(tree).props.value, "8");
});

for (const action of ["save", "withdraw"]) {
  test(`late ${action} error belongs to the original month after reminder navigation`, async () => {
    const mutation = deferred();
    const app = mountForm("?month=2026-10", { load: month => [ballot(month)], save: () => mutation.promise, withdraw: () => mutation.promise });
    renderForm(app); await settleForm(app); const tree = choosePeer(app);
    const pending = button(tree, action === "save" ? "Lưu sửa" : "Rút lại").props.onClick();
    app.navigate("?month=2026-09"); renderForm(app); await settleForm(app);
    mutation.reject(new Error("Original request failed")); await pending;
    assert.ok(!textOf(renderForm(app)).includes("Original request failed"));
  });
}

test("new-cycle midnight discards a late previous-cycle save result", async () => {
  const mutation = deferred();
  const app = mountForm("", { load: month => [ballot(month, month === "2026-10" ? 12 : 13, 8, month === "2026-10" ? [5, 4, 3] : [2, 2, 2])], save: () => mutation.promise });
  renderForm(app); await settleForm(app);
  const pending = button(choosePeer(app), "Lưu sửa").props.onClick();
  app.advance("2026-11-30T17:00:00Z"); app.fireTimers(); renderForm(app); await settleForm(app);
  mutation.resolve(ballot("2026-10")); await pending;
  const tree = renderForm(app);
  assert.equal(monthField(tree).props.value, "2026-11");
  assert.deepEqual(pickers(tree).map(picker => picker.props.value), [2, 2, 2]);
  assert.ok(!textOf(tree).includes("Đã lưu"));
});

test("clicking the already-selected history chip keeps the current save handler usable", async () => {
  const app = mountForm("", { ballots: [ballot("2026-10")] });
  renderForm(app); await settleForm(app); const tree = choosePeer(app);
  nodes(tree).find(node => node.type === "button" && textOf(node).includes("Peer")).props.onClick();
  // Selecting the same person produces no React state update or render.
  await button(tree, "Lưu sửa").props.onClick();
  assert.equal(app.writes.length, 1);
});
