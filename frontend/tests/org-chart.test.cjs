const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { loadTypeScript } = require("./helpers/load-typescript.cjs");

function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  if (tree == null || typeof tree === "boolean") return "";
  if (typeof tree !== "object") return String(tree);
  if (Array.isArray(tree)) return tree.map(text).join("");
  return text(tree.props?.children);
}
const find = (tree, predicate) => nodes(tree).find(predicate);
const button = (tree, label) => find(tree, node => node.type === "button" && text(node) === label);
const flush = () => new Promise(resolve => setImmediate(resolve));

function mount({ canEdit = false, save, confirm = () => true } = {}) {
  const slots = [], effects = [], writes = [];
  let cursor = 0;
  function OrgChartViewer() {} function OrgChartDialog() {}
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
      return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }];
    },
    useEffect(fn, deps) {
      const i = cursor++;
      if (slots[i] && deps.every((value, j) => Object.is(value, slots[i][j]))) return;
      slots[i] = deps; effects.push(fn);
    },
  };
  const chart = { level1: [{ key: "An", name: "AN", deptLabel: "Thiết kế", jpDeptLabel: "", bgClass: "bg-cyan-400", borderColor: "border-cyan-500", textClass: "text-slate-900" }], level2: [], level3: [], level4Left: [], level4Right: [], level5Left: [], level5Right: [], level6Left: [], level6Right: [] };
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/components/company-org-chart.tsx"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, Error, window: { confirm, location: {} }, require(name) {
    if (name === "react") return react;
    if (name === "@/lib/api") return { api: {
      colleagues: async () => [{ id: 7, full_name: "An", role: "FIELD_STAFF", email: "an@example.test", department: "Thiết kế" }],
      orgChart: async () => ({ data: chart, can_edit: canEdit, updated_by_name: "Quản lý" }),
      saveOrgChart: async draft => { writes.push(draft); return save ? save(draft) : { data: draft }; },
    } };
    if (name === "@/lib/roles") return { roleTitle: () => "Nhân viên", isSeniorManagerUp: () => false };
    if (name === "./org-chart-viewer") return { default: OrgChartViewer, OrgChartDialog };
    return require(name);
  } });
  return { writes, OrgChartDialog,
    render() { cursor = 0; const tree = module.exports.default(); effects.splice(0).forEach(fn => fn()); return tree; },
    viewer(tree) { return find(tree, node => node.type === OrgChartViewer); },
    sheet(tree) { return find(tree, node => node.type === OrgChartDialog); },
  };
}

test("mobile summary opens the complete chart and closing it never writes chart data", async () => {
  const app = mount(); app.render(); await flush();
  let tree = app.render();
  assert.ok(button(tree, "Xem sơ đồ"), "the dashboard offers a compact viewer entry");
  assert.equal(app.viewer(tree), undefined);
  button(tree, "Xem sơ đồ").props.onClick();
  tree = app.render();
  const viewer = app.viewer(tree);
  assert.ok(viewer);
  assert.ok(find(viewer.props.children, node => node.props?.title === "Xem chi tiết nhân sự"));
  viewer.props.onClose();
  assert.equal(app.viewer(app.render()), undefined);
  assert.equal(app.writes.length, 0);
});

test("view-only users can open linked profiles but never receive editing actions", async () => {
  const app = mount(); app.render(); await flush();
  button(app.render(), "Xem sơ đồ").props.onClick();
  let tree = app.render(), viewer = app.viewer(tree);
  assert.equal(button(viewer.props.toolbar, "Sửa sơ đồ"), undefined);
  find(viewer.props.children, node => node.props?.title === "Xem chi tiết nhân sự").props.onClick();
  tree = app.render();
  assert.ok(app.sheet(tree), "profile opens in an isolated modal above the viewer");
  assert.match(text(app.sheet(tree)), /an@example\.test/);
  app.sheet(tree).props.onClose();
  assert.equal(app.sheet(app.render()), undefined);
  assert.ok(app.viewer(app.render()));
  assert.equal(app.writes.length, 0);
});

test("failed saves retain edits and declining discard keeps the full-screen draft open", async () => {
  const app = mount({ canEdit: true, confirm: () => false, save: async () => { throw new Error("Mất kết nối"); } });
  app.render(); await flush(); button(app.render(), "Xem sơ đồ").props.onClick();
  button(app.viewer(app.render()).props.toolbar, "Sửa sơ đồ").props.onClick();
  let viewer = app.viewer(app.render());
  find(viewer.props.children, node => node.props?.title === "Bấm để sửa ô này").props.onClick();
  let tree = app.render();
  const input = find(app.sheet(tree), node => node.type === "input" && node.props.placeholder === "VD: HÙNG");
  input.props.onChange({ target: { value: "AN MỚI" } });
  button(app.sheet(app.render()), "Cập nhật").props.onClick();
  await button(app.viewer(app.render()).props.toolbar, "Lưu sơ đồ").props.onClick();
  tree = app.render(); viewer = app.viewer(tree);
  assert.match(text(viewer.props.toolbar), /Mất kết nối/);
  assert.match(text(viewer.props.children), /AN MỚI/);
  viewer.props.onClose();
  assert.ok(app.viewer(app.render()));
  button(app.viewer(app.render()).props.toolbar, "Huỷ bỏ").props.onClick();
  app.viewer(app.render()).props.onClose();
  assert.equal(app.viewer(app.render()), undefined);
  assert.equal(app.writes.length, 1);
});

test("automatic fit respects both viewport axes, avoids upscaling, and stays finite before measurement", () => {
  const { fitOrgChart } = loadTypeScript("src/components/org-chart-viewer.tsx");
  assert.equal(fitOrgChart(1000, 800, 432, 900), 0.4);
  assert.equal(fitOrgChart(1000, 800, 1200, 432), 0.5);
  assert.equal(fitOrgChart(100, 80, 432, 900), 1);
  assert.equal(fitOrgChart(0, 0, 0, 0), 1);
});
