const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { loadTypeScript } = require("./helpers/load-typescript.cjs");

test("detail API reads the exact target, category and month range without changing mine or summary", async () => {
  const requests = [], module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/lib/api.ts"), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, process, Headers, FormData, URLSearchParams, Event, console,
    localStorage: { getItem: () => "test-token" }, sessionStorage: { getItem: () => null }, window: {},
    require: name => name === "./leave-links" ? loadTypeScript("src/lib/leave-links.ts") : require(name),
    fetch: async (url, init) => { requests.push({ url, ...init }); return { ok: true, status: 200, json: async () => ({ evaluators: [] }) }; },
  });
  assert.equal(typeof module.exports.api.peerReviewDetails, "function");
  await module.exports.api.peerReviewDetails(7, "TEAM", "2026-01", "2026-03");
  const url = new URL(requests[0].url);
  assert.equal(url.pathname, "/api/v1/peer-reviews/details");
  assert.deepEqual(Object.fromEntries(url.searchParams), { evaluatee_id: "7", kind: "TEAM", from_month: "2026-01", to_month: "2026-03" });
  assert.equal(requests[0].headers.get("Authorization"), "Bearer test-token");
  assert.equal(requests[0].method ?? "GET", "GET");
  assert.equal(requests[0].body, undefined);
});

function mount(overrides = {}) {
  const slots = [], effects = [], listeners = new Map(), portals = [];
  let cursor = 0, refresh, refreshOptions, closed = 0;
  const props = { evaluateeId: 7, evaluateeName: "Nguyễn An", kind: "QUALITY", fromMonth: "2026-01", toMonth: "2026-03", onClose: () => closed++ };
  const api = { peerReviewDetails: async () => details, ...overrides };
  function memo(value, deps, effect = false) {
    const index = cursor++, prior = slots[index];
    if (prior && deps.every((value, i) => Object.is(value, prior.deps[i]))) return prior.value;
    if (effect) effects.push(() => { prior?.cleanup?.(); slots[index].cleanup = value(); });
    slots[index] = { value, deps }; return value;
  }
  const react = { ...require("react"),
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
    useRef(value) { const index = cursor++; return slots[index] ||= { current: value }; },
    useCallback: (fn, deps) => memo(fn, deps), useEffect: (fn, deps) => memo(fn, deps, true),
  };
  const module = { exports: {} }, body = { style: { overflow: "auto" } };
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/components/peer-review-details-dialog.tsx"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(source, { exports: module.exports, module, Error, document: { body, activeElement: { focus() {} } },
    window: { addEventListener: (event, listener) => listeners.set(event, listener), removeEventListener: event => listeners.delete(event) },
    require: name => {
      if (name === "react") return react;
      if (name === "react-dom") return { createPortal: (tree, target) => { portals.push(target); return tree; } };
      if (name === "@/lib/api") return { api };
      if (name === "@/lib/use-auto-refresh") return { useAutoRefresh: (fn, options) => { refresh = fn; refreshOptions = options; } };
      if (name === "@/lib/peer-review-forms") return loadTypeScript("src/lib/peer-review-forms.ts");
      return require(name);
    },
  });
  return { props, api, listeners, portals, body,
    render() { cursor = 0; const tree = module.exports.default(props); effects.splice(0).forEach(effect => effect()); return tree; },
    refresh: () => refresh(), get refreshOptions() { return refreshOptions; }, get closed() { return closed; },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}
const details = { evaluatee_id: 7, evaluatee_name: "Nguyễn An", kind: "QUALITY", from_month: "2026-01", to_month: "2026-03", count: 3,
  evaluators: [
    { evaluator_id: 8, evaluator_name: "Trần Bình", avg: 23 / 6, count: 2, reviews: [
      { id: 11, month: "2026-01", scores: [5, 4, 3], avg: 4, updated_at: null },
      { id: 12, month: "2026-02", scores: [2, 4, 5], avg: 11 / 3, updated_at: null },
    ] },
    { evaluator_id: 9, evaluator_name: "Lê Chi", avg: 3, count: 1, reviews: [{ id: 13, month: "2026-03", scores: [2, 3, 4], avg: 3, updated_at: null }] },
  ] };
const nodes = tree => !tree || typeof tree !== "object" ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const textOf = tree => tree == null || typeof tree === "boolean" ? "" : Array.isArray(tree) ? tree.map(textOf).join("") : typeof tree === "object" ? textOf(tree.props?.children) : String(tree);
const find = (tree, predicate) => nodes(tree).find(predicate);
const button = (tree, label) => find(tree, node => node.type === "button" && (node.props["aria-label"] === label || textOf(node).includes(label)));
const flush = () => new Promise(resolve => setImmediate(resolve));

test("portal lists named evaluator averages and expands the actual three scores separately by month", async () => {
  const calls = [];
  const app = mount({ peerReviewDetails: async (...args) => { calls.push(args); return details; } });
  let tree = app.render(); assert.ok(textOf(tree).includes("Đang tải"));
  await flush(); tree = app.render();
  assert.deepEqual(calls, [[7, "QUALITY", "2026-01", "2026-03"]]);
  assert.ok(find(tree, node => node.props?.role === "dialog" && node.props["aria-modal"]));
  assert.ok(textOf(tree).includes("Nguyễn An"));
  assert.ok(textOf(tree).includes("Chất lượng công việc"));
  assert.ok(textOf(tree).includes("01/2026") && textOf(tree).includes("03/2026"));
  assert.ok(textOf(tree).includes("Trần Bình") && textOf(tree).includes("3,83/5"));
  assert.ok(textOf(tree).includes("Lê Chi") && textOf(tree).includes("3/5"));
  assert.ok(!textOf(tree).includes("Sản phẩm đúng, ít lỗi"));
  button(tree, "Trần Bình").props.onClick(); tree = app.render();
  assert.equal(button(tree, "Trần Bình").props["aria-expanded"], true);
  const ballots = nodes(tree).filter(node => node.type === "section" && node.props["aria-label"]?.startsWith("Phiếu tháng"));
  assert.equal(ballots.length, 2);
  assert.ok(textOf(ballots[0]).includes("01/2026"));
  for (const expected of ["Sản phẩm đúng, ít lỗi5/5", "Nộp bài đúng hẹn4/5", "Phối hợp với mọi người3/5"]) assert.ok(textOf(ballots[0]).includes(expected));
  assert.ok(textOf(ballots[1]).includes("02/2026"));
  assert.ok(textOf(ballots[1]).includes("Sản phẩm đúng, ít lỗi2/5"));
  button(tree, "Trần Bình").props.onClick(); assert.ok(!textOf(app.render()).includes("Sản phẩm đúng, ít lỗi"));
  assert.ok(app.portals.every(target => target === app.body));
  app.unmount();
});

test("failed details can retry to empty without fabricated evaluator names", async () => {
  const app = mount({ peerReviewDetails: async () => { throw new Error("Không có kết nối"); } });
  app.render(); await flush(); let tree = app.render();
  assert.ok(textOf(find(tree, node => node.props?.role === "alert")).includes("Không có kết nối"));
  assert.ok(!textOf(tree).includes("Trần Bình"));
  app.api.peerReviewDetails = async () => ({ ...details, count: 0, evaluators: [] });
  await button(tree, "Thử lại").props.onClick(); tree = app.render();
  assert.ok(textOf(tree).includes("Chưa có phiếu"));
  assert.equal(find(tree, node => node.props?.role === "alert"), undefined);
  app.unmount();
});

test("changing selection immediately hides identities and earlier requests cannot overwrite the new category", async () => {
  const requests = [];
  const app = mount({ peerReviewDetails: (...args) => new Promise(resolve => requests.push({ args, resolve })) });
  app.render(); requests[0].resolve(details); await flush(); let tree = app.render();
  assert.ok(textOf(tree).includes("Trần Bình"));
  const pendingRefresh = app.refresh();
  app.props.kind = "TEAM"; app.props.evaluateeId = 10; app.props.evaluateeName = "Người mới"; app.props.fromMonth = "2026-04"; app.props.toMonth = "2026-06";
  tree = app.render(); assert.ok(!textOf(tree).includes("Trần Bình")); assert.ok(!textOf(tree).includes("Lê Chi"));
  requests.at(-1).resolve({ ...details, evaluatee_id: 10, kind: "TEAM", from_month: "2026-04", to_month: "2026-06", evaluators: [{ ...details.evaluators[1], evaluator_name: "Đỗ Dung" }] });
  await flush(); tree = app.render(); assert.ok(textOf(tree).includes("Đỗ Dung"));
  requests[1].resolve(details); await pendingRefresh;
  tree = app.render(); assert.ok(!textOf(tree).includes("Trần Bình")); assert.ok(textOf(tree).includes("Đỗ Dung"));
  button(tree, "Đỗ Dung").props.onClick(); tree = app.render();
  for (const label of ["Hòa đồng, thân thiện", "Tham gia hoạt động tập thể", "Tiếp thu góp ý"]) assert.ok(textOf(tree).includes(label));
  app.unmount();
});

test("evaluation refresh preserves expansion and newest response wins, close and Escape clean up the dialog", async () => {
  const app = mount(); app.render(); await flush(); let tree = app.render();
  button(tree, "Trần Bình").props.onClick(); tree = app.render();
  assert.ok(app.refreshOptions.topics.includes("evaluation"));
  const requests = []; app.api.peerReviewDetails = () => new Promise(resolve => requests.push(resolve));
  const old = app.refresh(), recent = app.refresh();
  requests[1]({ ...details, evaluators: [{ ...details.evaluators[0], avg: 4.5 }] }); await recent;
  tree = app.render(); assert.ok(textOf(tree).includes("4,5/5")); assert.equal(button(tree, "Trần Bình").props["aria-expanded"], true);
  requests[0](details); await old; assert.ok(textOf(app.render()).includes("4,5/5"));
  button(tree, "Đóng chi tiết đánh giá").props.onClick(); assert.equal(app.closed, 1);
  app.listeners.get("keydown")({ key: "Escape", preventDefault() {} }); assert.equal(app.closed, 2);
  assert.equal(app.body.style.overflow, "hidden");
  app.unmount(); assert.equal(app.body.style.overflow, "auto"); assert.equal(app.listeners.size, 0);
});
