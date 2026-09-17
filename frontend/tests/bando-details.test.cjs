// Run from frontend: node --test tests/bando-details.test.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");

const moduleExports = {};
vm.runInNewContext(ts.transpileModule(
  fs.readFileSync(path.join(__dirname, "../src/lib/bando-details.ts"), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText, { exports: moduleExports });
const {
  EMPTY_BANDO, TICKED, parseBanDoDetails, stringifyBanDoDetails, isBanDoTicked, analysisNumber,
} = moduleExports;
// Object tạo trong vm mang prototype của realm khác -> trải ra object của test trước khi so sánh sâu.
const plain = (o) => ({ ...o });

test("parse: ghi chú thường -> tieu_de; rỗng -> toàn rỗng", () => {
  assert.deepEqual(plain(parseBanDoDetails("Tốt")), { ...EMPTY_BANDO, tieu_de: "Tốt" });
  assert.deepEqual(plain(parseBanDoDetails("")), plain(EMPTY_BANDO));
  assert.deepEqual(plain(parseBanDoDetails(null)), plain(EMPTY_BANDO));
});

test("parse: JSON cũ (chưa có 'vung') vẫn đọc được, vung rỗng, giữ nguyên analysis kèm 'ha'", () => {
  const old = JSON.stringify({
    riegl: "2", qlcl: "", data: "0", analysis: "28.5 ha", trace: "0", section: "", tieu_de: "DDM",
  });
  const d = parseBanDoDetails(old);
  assert.equal(d.vung, "");
  assert.equal(d.riegl, "2");
  assert.equal(d.data, "0");
  assert.equal(d.analysis, "28.5 ha");
  assert.equal(d.tieu_de, "DDM");
});

test("parse: JSON hỏng -> giữ nguyên chuỗi làm ghi chú", () => {
  assert.deepEqual(plain(parseBanDoDetails("{hỏng")), { ...EMPTY_BANDO, tieu_de: "{hỏng" });
});

test("stringify: trống hết -> ''; có dữ liệu -> JSON đọc lại đúng (kể cả vung)", () => {
  assert.equal(stringifyBanDoDetails({ ...EMPTY_BANDO }), "");
  assert.equal(stringifyBanDoDetails({ ...EMPTY_BANDO, vung: "  " }), "");
  const d = { ...EMPTY_BANDO, vung: "Kyushu", data: TICKED, analysis: "28.5" };
  assert.deepEqual(plain(parseBanDoDetails(stringifyBanDoDetails(d))), d);
});

test("isBanDoTicked: rỗng / 0 / false = chưa tích; '1' hoặc số cũ khác 0 = đã tích", () => {
  for (const v of ["", " ", "0", " 0 ", "false", null, undefined]) assert.equal(isBanDoTicked(v), false, `v=${v}`);
  for (const v of [TICKED, "12", "x", "true"]) assert.equal(isBanDoTicked(v), true, `v=${v}`);
});

test("analysisNumber: bỏ chữ 'ha' và khoảng trắng, phẩy -> chấm", () => {
  assert.equal(analysisNumber("28.5 ha"), "28.5");
  assert.equal(analysisNumber("36ha"), "36");
  assert.equal(analysisNumber("3,2ha"), "3.2");
  assert.equal(analysisNumber("14.4 ha"), "14.4");
  assert.equal(analysisNumber(""), "");
  assert.equal(analysisNumber("abc"), "");
  assert.equal(analysisNumber(null), "");
});
