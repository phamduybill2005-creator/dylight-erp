const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { loadTypeScript } = require("./helpers/load-typescript.cjs");

// Render the real page and run its handlers; only network, browser and Next boundaries are replaced.
function mount(overrides = {}, role = "DIRECTOR") {
  const slots = [], effects = [], listeners = new Map(), refreshers = [], exports = [];
  const currentUser = { id: 1, role, full_name: "Giám đốc", company_id: 1, is_active: true };
  let cursor = 0;
  function memo(value, deps, effect = false) {
    const index = cursor++, prior = slots[index];
    if (prior && deps.every((value, i) => Object.is(value, prior.deps[i]))) return prior.value;
    if (effect) effects.push(() => { prior?.cleanup?.(); slots[index].cleanup = value(); });
    slots[index] = { value, deps }; return value;
  }
  const react = {
    ...require("react"),
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
    useRef(value) { const index = cursor++; return slots[index] ||= { current: value }; },
    useMemo: (fn, deps) => memo(fn(), deps), useCallback: (fn, deps) => memo(fn, deps), useEffect: (fn, deps) => memo(fn, deps, true),
  };
  const api = { cachedUser: () => currentUser, me: async () => currentUser,
    evaluationsReceived: async () => [], evaluationsGiven: async () => [], projects: async () => [], colleagues: async () => [], users: async () => [],
    evaluationsOverview: async () => [person], evaluationMonthReviews: async () => [review], ...overrides };
  const router = { push() {} }, module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/app/evaluations/page.tsx"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(source, { exports: module.exports, module, Error, console,
    window: { addEventListener: (event, listener) => listeners.set(event, listener), removeEventListener: event => listeners.delete(event) },
    require: name => {
      if (name === "react") return react;
      if (name === "next/navigation") return { useRouter: () => router };
      if (name === "@/lib/api") return { api };
      if (name === "@/lib/use-sticky-state") return { useStickyState: (_, value) => react.useState(value) };
      if (name === "@/lib/use-auto-refresh") return { useAutoRefresh: (fn, options) => refreshers.push({ fn, options }) };
      if (name === "@/components/app-shell") return function AppShell() {};
      if (name === "@/components/filter-bar") return { splitDepts: value => (value || "").split(",") };
      if (name.startsWith("@/lib/")) return loadTypeScript(`src/lib/${name.slice(6)}.ts`);
      if (name === "xlsx") return { utils: { aoa_to_sheet: data => { exports.push(data); return {}; }, book_new: () => ({}), book_append_sheet() {} }, writeFile() {} };
      return require(name);
    },
  });
  return { api, listeners, exports, currentUser,
    render() { cursor = 0; refreshers.length = 0; const tree = module.exports.default(); effects.splice(0).forEach(effect => effect()); return tree; },
    refresh() { refreshers.filter(item => item.options.enabled !== false).forEach(item => item.fn()); },
    get refreshers() { return refreshers; },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}
const person = { user_id: 7, full_name: "Nguyễn An", role: "STAFF", department: "Phòng AI", office_hours: 120, project_hours: 100, late_days: 3, my_rating: null };
const month = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" }).slice(0, 7);
const review = { user_id: 7, month, late_cp: 2, late_kp: 3, leave_cp: 0.5, leave_kp: 1.5, leave_cp_auto: 99, attendance_pending_sessions: 4, score_attitude: 20, score_quality: 40, score_team: 15 };
const nodes = tree => !tree || typeof tree !== "object" ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const textOf = tree => tree == null || typeof tree === "boolean" ? "" : Array.isArray(tree) ? tree.map(textOf).join("") : typeof tree === "object" ? textOf(tree.props?.children) : String(tree);
const find = (tree, predicate) => nodes(tree).find(predicate);
const button = (tree, label) => find(tree, node => node.type === "button" && textOf(node) === label);
const flush = () => new Promise(resolve => setImmediate(resolve));
async function ready(app) { app.render(); await flush(); app.render(); await flush(); return app.render(); }

test("director sees derived attendance without count inputs while score inputs and self guard stay intact", async () => {
  const writes = [];
  const self = { ...person, user_id: 1, full_name: "Giám đốc", role: "DIRECTOR" };
  const app = mount({ evaluationsOverview: async () => [self, person], evaluationMonthReviews: async () => [review, { ...review, user_id: 1 }], setEvaluationMonthReview: async (...args) => { writes.push(args); return { ...review, score_attitude: 22 }; } });
  let tree = await ready(app);
  assert.equal(nodes(tree).filter(node => node.type === "input" && ["late_cp", "late_kp", "leave_cp", "leave_kp"].includes(node.props["aria-label"])).length, 0);
  const cards = nodes(tree).filter(node => node.type === "article");
  assert.ok(textOf(cards.find(card => textOf(card).includes("Nguyễn An"))).includes("4 buổi chờ đối soát"));
  assert.ok(!textOf(tree).includes("99"));
  assert.equal(nodes(cards.find(card => textOf(card).includes("Giám đốc"))).filter(node => node.type === "input").length, 0);
  const input = find(tree, node => node.props?.["aria-label"] === "score_attitude");
  input.props.onChange({ target: { value: "22" } }); tree = app.render();
  await find(tree, node => node.props?.["aria-label"] === "score_attitude").props.onBlur();
  assert.deepEqual(JSON.parse(JSON.stringify(writes)), [[7, month, { score_attitude: 22 }]]);
  app.unmount();
});

test("quarter totals and Excel preserve half days, lateness units, pending sessions and saved scores", async () => {
  const year = month.slice(0, 4), reviews = ["01", "02", "03"].map((m, i) => ({ ...review, month: `${year}-${m}`, late_cp: i, late_kp: i + 1, leave_cp: 0.5, leave_kp: i ? 0 : 0.5, attendance_pending_sessions: i, score_attitude: i === 2 ? null : 20, score_quality: i === 2 ? null : 40, score_team: i === 2 ? null : 15 }));
  const app = mount({ evaluationMonthReviews: async () => reviews });
  let tree = await ready(app); button(tree, "Quý 1").props.onClick(); app.render(); await flush(); tree = app.render();
  assert.equal(nodes(tree).filter(node => node.props?.["aria-label"] === "score_attitude").length, 0);
  assert.ok(textOf(tree).includes("3 buổi chờ đối soát"));
  await button(tree, "Xuất Excel").props.onClick();
  assert.ok(app.exports[0][0].includes("Muộn CP (lần)"));
  assert.ok(app.exports[0][0].includes("Chờ đối soát (buổi)"));
  assert.deepEqual(Array.from(app.exports[0][1]).slice(6), [3, 6, 1.5, 0.5, 20, 40, 15, 75, 3]);
  app.unmount();
});

test("attendance refresh reloads both sources and the latest period request wins", async () => {
  let calls = 0; const requests = [];
  const app = mount({ evaluationsOverview: async () => { calls++; return [person]; }, evaluationMonthReviews: (...args) => new Promise((resolve, reject) => requests.push({ args, resolve, reject })) });
  app.render(); await flush(); app.render();
  requests.at(-1).resolve([review]); await flush(); let tree = app.render();
  assert.ok(app.refreshers.some(item => ["attendance", "leave", "schedule"].every(topic => item.options.topics?.includes(topic))));
  app.refresh(); await flush(); const stale = requests.at(-1);
  assert.equal(calls, 2);
  const nextMonth = `${month.slice(0, 4)}-02`;
  find(tree, node => node.type === "input" && node.props.type === "month").props.onChange({ target: { value: nextMonth } });
  app.render(); await flush(); requests.at(-1).resolve([{ ...review, month: nextMonth, attendance_pending_sessions: 8 }]); await flush();
  stale.resolve([{ ...review, attendance_pending_sessions: 99 }]); await flush(); tree = app.render();
  assert.ok(textOf(tree).includes("8 buổi chờ đối soát")); assert.ok(!textOf(tree).includes("99 buổi"));
  assert.ok(app.listeners.has("attendance-reconciliation-changed"));
  app.listeners.get("attendance-reconciliation-changed")(); await flush(); assert.equal(calls, 4);
  app.unmount();
});

test("failed initial attendance load reports an error and cannot export fabricated zero counts", async () => {
  const app = mount({ evaluationMonthReviews: async () => { throw new Error("Mất kết nối đối soát"); } });
  const tree = await ready(app);
  assert.ok(find(tree, node => node.props?.role === "alert"));
  assert.ok(textOf(tree).includes("Mất kết nối đối soát"));
  assert.equal(button(tree, "Xuất Excel").props.disabled, true);
  assert.ok(!textOf(tree).includes("Chưa có nhân sự nào."));
  app.unmount();
});

test("a failed refresh retains known attendance with an error, and retry restores a complete export", async () => {
  const app = mount(); let tree = await ready(app);
  app.api.evaluationMonthReviews = async () => { throw new Error("Lỗi mạng"); };
  app.refresh(); await flush(); tree = app.render();
  assert.ok(textOf(tree).includes("Nguyễn An"));
  assert.ok(textOf(find(tree, node => node.props?.role === "alert")).includes("Lỗi mạng"));
  assert.equal(button(tree, "Xuất Excel").props.disabled, true);
  app.api.evaluationMonthReviews = async () => [{ ...review, attendance_pending_sessions: 1 }];
  app.refresh(); await flush(); tree = app.render();
  assert.ok(textOf(tree).includes("1 buổi chờ đối soát"));
  assert.equal(find(tree, node => node.props?.role === "alert"), undefined);
  assert.equal(button(tree, "Xuất Excel").props.disabled, false);
  app.unmount();
});

test("an older score save response cannot undo attendance refreshed while the save was pending", async () => {
  let finishSave;
  const app = mount({ setEvaluationMonthReview: () => new Promise(resolve => { finishSave = resolve; }) });
  let tree = await ready(app);
  find(tree, node => node.props?.["aria-label"] === "score_attitude").props.onChange({ target: { value: "22" } });
  tree = app.render(); const saving = find(tree, node => node.props?.["aria-label"] === "score_attitude").props.onBlur();
  app.api.evaluationMonthReviews = async () => [{ ...review, late_cp: 6, attendance_pending_sessions: 8, score_attitude: 22 }];
  app.refresh(); await flush(); app.render();
  finishSave({ ...review, score_attitude: 22 }); await saving; tree = app.render();
  assert.ok(textOf(tree).includes("8 buổi chờ đối soát"));
  await button(tree, "Xuất Excel").props.onClick();
  assert.equal(app.exports[0][1][6], 6);
  assert.equal(app.exports[0][1][10], 22);
  app.unmount();
});

test("a score save from a previous visit cannot overwrite a newly selected period after a round trip", async () => {
  let finishSave;
  const app = mount({ setEvaluationMonthReview: () => new Promise(resolve => { finishSave = resolve; }) });
  let tree = await ready(app);
  find(tree, node => node.props?.["aria-label"] === "score_attitude").props.onChange({ target: { value: "22" } });
  tree = app.render(); const saving = find(tree, node => node.props?.["aria-label"] === "score_attitude").props.onBlur();
  find(tree, node => node.type === "input" && node.props.type === "month").props.onChange({ target: { value: "2025-01" } });
  app.render(); await flush(); tree = app.render();
  app.api.evaluationMonthReviews = async () => [{ ...review, score_attitude: 24 }];
  find(tree, node => node.type === "input" && node.props.type === "month").props.onChange({ target: { value: month } });
  app.render(); await flush(); app.render();
  finishSave({ ...review, score_attitude: 22 }); await saving; tree = app.render();
  assert.equal(find(tree, node => node.props?.["aria-label"] === "score_attitude").props.value, "24");
  app.unmount();
});

test("a GET started before a successful score save keeps that score and still refreshes attendance", async () => {
  for (const score of [22, null]) {
    let finishRead;
    const app = mount({ setEvaluationMonthReview: async () => ({ ...review, score_attitude: score }) });
    let tree = await ready(app);
    app.api.evaluationMonthReviews = () => new Promise(resolve => { finishRead = resolve; });
    app.refresh(); await flush(); tree = app.render();
    find(tree, node => node.props?.["aria-label"] === "score_attitude").props.onChange({ target: { value: score === null ? "" : String(score) } });
    tree = app.render(); await find(tree, node => node.props?.["aria-label"] === "score_attitude").props.onBlur();
    finishRead([{ ...review, late_cp: 6, attendance_pending_sessions: 8 }]); await flush(); tree = app.render();
    assert.equal(find(tree, node => node.props?.["aria-label"] === "score_attitude").props.value, score === null ? "" : "22");
    assert.ok(textOf(tree).includes("8 buổi chờ đối soát"));
    assert.equal(button(tree, "Xuất Excel").props.disabled, false);
    await button(tree, "Xuất Excel").props.onClick();
    assert.equal(app.exports[0][1][6], 6);
    assert.equal(app.exports[0][1][10], score ?? 0); // Existing aggregation treats a cleared component as zero when other scores remain.
    // A later request may reflect another director's subsequent edit.
    app.api.evaluationMonthReviews = async () => [{ ...review, score_attitude: 24 }];
    app.refresh(); await flush(); tree = app.render();
    assert.equal(find(tree, node => node.props?.["aria-label"] === "score_attitude").props.value, "24");
    app.unmount();
  }
});

test("an old empty GET cannot erase a newly created future-month score row", async () => {
  const futureMonth = "2099-01";
  let finishRead;
  const created = { ...review, month: futureMonth, late_cp: 0, late_kp: 0, leave_cp: 0, leave_kp: 0, leave_cp_auto: 0, attendance_pending_sessions: 0, score_attitude: 22, score_quality: null, score_team: null };
  const app = mount({ evaluationMonthReviews: async () => [], setEvaluationMonthReview: async () => created });
  let tree = await ready(app);
  find(tree, node => node.type === "input" && node.props.type === "month").props.onChange({ target: { value: futureMonth } });
  app.render(); await flush(); tree = app.render();
  app.api.evaluationMonthReviews = () => new Promise(resolve => { finishRead = resolve; });
  app.refresh(); await flush(); tree = app.render();
  find(tree, node => node.props?.["aria-label"] === "score_attitude").props.onChange({ target: { value: "22" } });
  tree = app.render(); await find(tree, node => node.props?.["aria-label"] === "score_attitude").props.onBlur();
  finishRead([]); await flush(); tree = app.render();
  assert.equal(find(tree, node => node.props?.["aria-label"] === "score_attitude").props.value, "22");
  await button(tree, "Xuất Excel").props.onClick();
  assert.equal(app.exports[0][1][10], 22);
  assert.equal(app.exports[0][1][13], 22);
  app.unmount();
});
