// Run from frontend: node --test tests/revenue-access.test.cjs
// Ai được xem tab Doanh thu (lib/roles.canSeeRevenue): lãnh đạo + danh sách chỉ định theo tên.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");

const moduleExports = {};
vm.runInNewContext(ts.transpileModule(
  fs.readFileSync(path.join(__dirname, "../src/lib/roles.ts"), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText, { exports: moduleExports });
const { canSeeRevenue, normalizeName } = moduleExports;

const staff = (full_name) => ({ role: "FIELD_STAFF", full_name, manager_id: 3 });

test("normalizeName: bỏ dấu, khoảng trắng, dấu chấm; không phân biệt hoa thường", () => {
  assert.equal(normalizeName(" N. V. Cường "), "NVCUONG");
  assert.equal(normalizeName("n.v.cuong"), "NVCUONG");
  assert.equal(normalizeName("Đ.M.Quang"), "DMQUANG");
  assert.equal(normalizeName(""), "");
  assert.equal(normalizeName(null), "");
});

test("người trong danh sách chỉ định xem được dù tên lưu có dấu / khoảng trắng / chữ thường", () => {
  for (const name of ["N.V.CUONG", "n.v.cuong", "N.V.Cường", " N. V. CUONG ", "D.M.QUANG", "H.T.DUC", "L.M.HUNG"]) {
    assert.equal(canSeeRevenue(staff(name)), true, name);
  }
});

test("người ngoài danh sách và không phải lãnh đạo thì không xem được", () => {
  for (const name of ["N.V.CUONGX", "T.K.HOAN", "", null]) {
    assert.equal(canSeeRevenue(staff(name)), false, String(name));
  }
  assert.equal(canSeeRevenue(null), false);
  // Quản lý cấp trung (có sếp bên trên) không nằm trong danh sách -> không xem.
  assert.equal(canSeeRevenue({ role: "MANAGER_MID", full_name: "Ai đó", manager_id: 2 }), false);
});

test("lãnh đạo luôn xem được, không cần nằm trong danh sách", () => {
  assert.equal(canSeeRevenue({ role: "DIRECTOR", full_name: "Ai đó" }), true);
  assert.equal(canSeeRevenue({ role: "ADMIN", full_name: "Ai đó" }), true);
  // Quản lý cấp cao = quản lý KHÔNG có ai quản lý bên trên.
  assert.equal(canSeeRevenue({ role: "MANAGER", full_name: "Ai đó", manager_id: null, manager_ids: null }), true);
});
