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
  function DetailsDialog() {}
  const router = { push() {}, replace() {} }, module = { exports: {} };
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
      if (name === "@/components/peer-review-details-dialog") return DetailsDialog;
      if (name === "@/components/filter-bar") return { splitDepts: value => (value || "").split(",") };
      if (name.startsWith("@/lib/")) return loadTypeScript(`src/lib/${name.slice(6)}.ts`);
      if (name === "xlsx") return { utils: { aoa_to_sheet: data => { exports.push(data); return {}; }, book_new: () => ({}), book_append_sheet() {} }, writeFile() {} };
      return require(name);
    },
  });
  return { api, listeners, exports, currentUser, DetailsDialog,
    render() { cursor = 0; refreshers.length = 0; const tree = module.exports.default(); effects.splice(0).forEach(effect => effect()); return tree; },
    refresh() { refreshers.filter(item => item.options.enabled !== false).forEach(item => item.fn()); },
    get refreshers() { return refreshers; },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}
const person = { user_id: 7, full_name: "Nguyễn An", role: "STAFF", department: "Phòng AI", office_hours: 120, project_hours: 100, late_days: 3, my_rating: null };
const month = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" }).slice(0, 7);
const review = { user_id: 7, month, late_cp: 2, late_kp: 3, leave_cp: 0.5, leave_kp: 1.5, leave_cp_auto: 99, attendance_pending_sessions: 4, attitude_points: 4, score_attitude: 20, score_quality: 40, score_team: 15, peer_quality: 4, peer_quality_count: 2, peer_team: 3, peer_team_count: 1 };
const nodes = tree => !tree || typeof tree !== "object" ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const textOf = tree => tree == null || typeof tree === "boolean" ? "" : Array.isArray(tree) ? tree.map(textOf).join("") : typeof tree === "object" ? textOf(tree.props?.children) : String(tree);
const find = (tree, predicate) => nodes(tree).find(predicate);
const button = (tree, label) => find(tree, node => node.type === "button" && textOf(node) === label);
const flush = () => new Promise(resolve => setImmediate(resolve));
async function ready(app) { app.render(); await flush(); app.render(); await flush(); return app.render(); }

test("positive ballot counts open named details on desktop and mobile for the selected month or quarter", async () => {
  const app = mount({ evaluationMonthReviews: async () => [{ ...review, peer_quality: 4.25, peer_quality_count: 2, peer_team: 3.5, peer_team_count: 1 }] });
  let tree = await ready(app);
  const controls = nodes(tree).filter(node => node.type === "button" && /phiếu/.test(textOf(node)));
  assert.equal(controls.length, 4);
  assert.ok(controls.every(node => node.props["aria-haspopup"] === "dialog"));
  controls[0].props.onClick(); tree = app.render();
  let dialog = find(tree, node => node.type === app.DetailsDialog);
  assert.equal(dialog.props.evaluateeId, 7);
  assert.equal(dialog.props.evaluateeName, "Nguyễn An");
  assert.equal(dialog.props.kind, "QUALITY");
  assert.equal(dialog.props.fromMonth, month);
  assert.equal(dialog.props.toMonth, month);
  dialog.props.onClose(); assert.equal(find(app.render(), node => node.type === app.DetailsDialog), undefined);
  controls[3].props.onClick(); tree = app.render();
  assert.equal(find(tree, node => node.type === app.DetailsDialog).props.kind, "TEAM");
  app.api.evaluationMonthReviews = async () => [{ ...review, month: `${month.slice(0, 4)}-01`, peer_quality: 4.25, peer_quality_count: 2, peer_team: 3.5, peer_team_count: 1 }];
  button(tree, "Quý 1").props.onClick(); tree = app.render();
  assert.equal(find(tree, node => node.type === app.DetailsDialog), undefined);
  await flush(); tree = app.render();
  nodes(tree).find(node => node.type === "button" && textOf(node) === "2 phiếu").props.onClick();
  dialog = find(app.render(), node => node.type === app.DetailsDialog);
  assert.equal(dialog.props.fromMonth, `${month.slice(0, 4)}-01`);
  assert.equal(dialog.props.toMonth, `${month.slice(0, 4)}-03`);
  app.currentUser.role = "MANAGER";
  assert.equal(find(app.render(), node => node.type === app.DetailsDialog), undefined);
  app.unmount();
});

test("empty peer averages provide no ballot detail controls", async () => {
  const app = mount({ evaluationMonthReviews: async () => [{ ...review, peer_quality: null, peer_quality_count: 0, peer_team: null, peer_team_count: 0 }] });
  const tree = await ready(app);
  assert.equal(nodes(tree).filter(node => node.type === "button" && /phiếu/.test(textOf(node))).length, 0);
  app.unmount();
});

test("director sees automatic attitude and peer points including self without manual score inputs", async () => {
  const self = { ...person, user_id: 1, full_name: "Giám đốc", role: "DIRECTOR" };
  const app = mount({ evaluationsOverview: async () => [self, person], evaluationMonthReviews: async () => [review, { ...review, user_id: 1 }] });
  const tree = await ready(app);
  assert.equal(nodes(tree).filter(node => node.type === "input" && ["late_cp", "late_kp", "leave_cp", "leave_kp", "score_attitude", "score_quality", "score_team"].includes(node.props["aria-label"])).length, 0);
  const cards = nodes(tree).filter(node => node.type === "article");
  assert.ok(textOf(cards.find(card => textOf(card).includes("Nguyễn An"))).includes("4 buổi chờ đối soát"));
  assert.ok(!textOf(tree).includes("99"));
  assert.ok(cards.every(card => textOf(card).includes("4/5") && textOf(card).includes("3/5") && textOf(card).includes("3,75")));
  app.unmount();
});

test("quarter totals and Excel preserve half days, lateness units, pending sessions and automatic peer points", async () => {
  const year = month.slice(0, 4), reviews = ["01", "02", "03"].map((m, i) => ({ ...review, month: `${year}-${m}`, late_cp: i, late_kp: i + 1, leave_cp: 0.5, leave_kp: i ? 0 : 0.5, attendance_pending_sessions: i, score_attitude: i === 2 ? null : 20, score_quality: i === 2 ? null : 40, score_team: i === 2 ? null : 15, peer_quality: i === 2 ? null : 4, peer_quality_count: i === 2 ? 0 : 2, peer_team: i === 2 ? null : 3, peer_team_count: i === 2 ? 0 : 1 }));
  const app = mount({ evaluationMonthReviews: async () => reviews });
  let tree = await ready(app); button(tree, "Quý 1").props.onClick(); app.render(); await flush(); tree = app.render();
  assert.equal(nodes(tree).filter(node => node.props?.["aria-label"] === "score_attitude").length, 0);
  assert.ok(textOf(tree).includes("3 buổi chờ đối soát"));
  await button(tree, "Xuất Excel").props.onClick();
  assert.ok(app.exports[0][0].includes("Muộn CP (lần)"));
  assert.ok(app.exports[0][0].includes("Chờ đối soát (buổi)"));
  assert.deepEqual(Array.from(app.exports[0][1]).slice(6), [3, 6, 1.5, 0.5, 4, 4, 4, 3, 2, 3.75, 3]);
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

test("quarter independently averages eligible attitude and peer components with full precision", async () => {
  const year = month.slice(0, 4);
  const app = mount({ evaluationMonthReviews: async () => [
    { ...review, month: `${year}-01`, attitude_points: null, score_attitude: null, score_quality: 41.25, score_team: null, peer_quality: 4.125, peer_quality_count: 2, peer_team: null, peer_team_count: 0 },
    { ...review, month: `${year}-02`, attitude_points: 4.65, score_attitude: 23.25, score_quality: null, score_team: 18.25, peer_quality: null, peer_quality_count: 0, peer_team: 3.65, peer_team_count: 1 },
    { ...review, month: `${year}-03`, attitude_points: 4.9, score_attitude: 24.5, score_quality: null, score_team: null, peer_quality: null, peer_quality_count: 0, peer_team: null, peer_team_count: 0 },
  ] });
  let tree = await ready(app); button(tree, "Quý 1").props.onClick(); app.render(); await flush(); tree = app.render();
  assert.ok(textOf(tree).includes("4,78/5"));
  assert.ok(textOf(tree).includes("4,17"));
  await button(tree, "Xuất Excel").props.onClick();
  const [headers, row] = app.exports[0];
  assert.equal(row[headers.indexOf("Ý thức (/5)")], 4.775);
  assert.equal(row[headers.indexOf("Chất lượng CV (/5)")], 4.125);
  assert.equal(row[headers.indexOf("Tập thể (/5)")], 3.65);
  assert.equal(row[headers.indexOf("Kết quả (/5)")], 4.17);
  app.unmount();
});

test("a missing peer average never becomes zero or produces a result", async () => {
  const app = mount({ evaluationMonthReviews: async () => [{ ...review, attitude_points: 4.65, score_attitude: 23.25, score_team: null, peer_team: null, peer_team_count: 0 }] });
  const tree = await ready(app);
  assert.ok(textOf(tree).includes("4,65/5"));
  await button(tree, "Xuất Excel").props.onClick();
  const [headers, row] = app.exports[0];
  assert.equal(row[headers.indexOf("Tập thể (/5)")], "");
  assert.equal(row[headers.indexOf("Kết quả (/5)")], "");
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

test("a request from a previous period visit cannot overwrite refreshed attendance and peer points after a round trip", async () => {
  const requests = [];
  const app = mount(); let tree = await ready(app);
  app.api.evaluationMonthReviews = (...args) => new Promise(resolve => requests.push({ args, resolve }));
  app.refresh(); await flush();
  const originalVisit = requests[0];
  const monthInput = () => find(tree, node => node.type === "input" && node.props.type === "month");
  monthInput().props.onChange({ target: { value: "2025-01" } }); app.render(); await flush(); tree = app.render();
  monthInput().props.onChange({ target: { value: month } }); app.render(); await flush();
  requests.at(-1).resolve([{ ...review, late_cp: 6, attendance_pending_sessions: 8, peer_quality: 4.5, peer_quality_count: 5 }]); await flush();
  originalVisit.resolve([{ ...review, attendance_pending_sessions: 99 }]); await flush(); tree = app.render();
  assert.ok(textOf(tree).includes("8 buổi chờ đối soát")); assert.ok(!textOf(tree).includes("99 buổi"));
  assert.ok(textOf(tree).includes("4,5/5"));
  await button(tree, "Xuất Excel").props.onClick();
  const [headers, row] = app.exports[0];
  assert.equal(row[headers.indexOf("Muộn CP (lần)")], 6);
  assert.equal(row[headers.indexOf("Chất lượng CV (/5)")], 4.5);
  assert.equal(row[headers.indexOf("Số phiếu CL CV")], 5);
  app.unmount();
});
