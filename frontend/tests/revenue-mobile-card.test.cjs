const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { loadTypeScript } = require("./helpers/load-typescript.cjs");

const project = {
  id: 17, code: "5139-0257", name: "Dự án Bản đồ", total_hours: 32, manual_hours: "16",
  evaluation: JSON.stringify({ vung: "滋賀県", ortho: "125", riegl: "12", qlcl: "6", analysis: "28,5 ha", hovermaps: "1", section: "7" }),
};

function render(props = {}) {
  const filename = path.join(__dirname, "../src/components/revenue-mobile-card.tsx");
  assert.ok(fs.existsSync(filename), "mobile revenue card must expose the desktop details");
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, require: name => name.startsWith("@/lib/") ? loadTypeScript(`src/lib/${name.slice(6)}.ts`) : require(name) });
  return renderToStaticMarkup(React.createElement(module.exports.default, {
    project, index: 1, pinned: false, onTogglePin() {}, revenue: 1728000, jpyUnitPrice: 900, exchangeRate: 160,
    revenuePeriodLabel: "Toàn bộ", monthLabel: "T11/2026", monthActualHours: 2.5, monthClientHours: 4, totalClientHours: 12,
    isBanDoMode: true, groupHoursPeriodLabel: "Toàn bộ",
    groupHours: { Ortho: 4.25, RIEGL: 1, DATA: 8, Ground: 2, Grid_XML: 3, HoverMaps: 4, Trace: 5, "TD-TN": 2.5 },
    ...props,
  }));
}

const plain = html => html.replace(/<[^>]+>/g, "");
function metric(html, key) {
  const value = html.match(new RegExp(`<div[^>]*data-revenue-metric="${key}"[^>]*>([\\s\\S]*?)<\\/div>`));
  assert.ok(value, `missing desktop detail ${key}`);
  return plain(value[1]);
}

test("mapping revenue cards expose all nine desktop columns, project values, region and actual hours", () => {
  const html = render();
  assert.match(plain(html), /滋賀県/);
  for (const key of ["ortho", "riegl", "qlcl", "data", "ground", "grid", "hovermaps", "trace", "tdtn"]) metric(html, key);
  assert.match(metric(html, "ortho"), /125/);
  assert.match(metric(html, "ortho"), /4,3h/);
  for (const key of ["data", "ground", "grid", "trace"]) assert.match(metric(html, key), /28\.5 ha/);
  assert.match(metric(html, "tdtn"), /7/);
  assert.match(metric(html, "tdtn"), /2,5h/);
  assert.match(metric(html, "hovermaps"), /Đã tích/);
  assert.match(metric(html, "hovermaps"), /4h/);
});

test("monthly, overall, manual hours and price remain distinct and available without tooltips", () => {
  const html = render();
  const text = plain(html);
  assert.match(text, /Manual time2 ngày.*16h/);
  assert.match(text, /T11\/20262,5h4h/);
  assert.match(text, /Toàn bộ32h12h/);
  assert.match(text, /900.*¥\/h/);
  assert.match(text, /160.*₫/);
  assert.match(html, /href="\/projects\/17"/);
});

test("non-mapping cards omit mapping-only fields and customer editing appears only when provided", () => {
  const readonly = render({ isBanDoMode: false });
  assert.doesNotMatch(readonly, /data-revenue-metric=/);
  assert.doesNotMatch(readonly, /<input/);
  const editable = render({ clientMonthEditor: React.createElement("input", { "aria-label": "Giờ khách hàng tháng", defaultValue: "9.5" }) });
  assert.match(editable, /aria-label="Giờ khách hàng tháng"/);
  assert.match(editable, /value="9.5"/);
});

test("empty mapping metadata and unticked HoverMaps show honest placeholders instead of fabricated values", () => {
  const html = render({ project: { ...project, evaluation: "", manual_hours: null }, groupHours: {} });
  assert.match(metric(html, "hovermaps"), /Chưa tích/);
  assert.doesNotMatch(metric(html, "hovermaps"), /Đã tích/);
  assert.match(metric(html, "ortho"), /—/);
  assert.doesNotMatch(metric(html, "ortho"), /undefined|NaN/);
});

test("customer-hour monthly breakdown is readable on touch screens without desktop hover", () => {
  const text = plain(render({ clientHoursByMonth: { "2026-11": 4, "2026-10": 8 } }));
  assert.match(text, /Khách hàng theo tháng/);
  assert.match(text, /10\/20268h/);
  assert.match(text, /11\/20264h/);
  assert.ok(text.indexOf("10/20268h") < text.indexOf("11/20264h"));
});
