// Run from frontend: node --test tests/bando-view.test.cjs
// Điều kiện hiện BỐ CỤC PHÒNG BẢN ĐỒ — dùng chung cho bảng Dự án và tab Doanh thu.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");

const moduleExports = {};
vm.runInNewContext(ts.transpileModule(
  fs.readFileSync(path.join(__dirname, "../src/lib/groups.ts"), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText, { exports: moduleExports });
const { isBanDoUser, isBanDoView } = moduleExports;

test("isBanDoUser: theo cột phòng ban, nhận tên Nhật và tài khoản thuộc nhiều phòng", () => {
  assert.equal(isBanDoUser({ department: "Phòng Bản đồ" }), true);
  assert.equal(isBanDoUser({ department: "測量解析" }), true);
  assert.equal(isBanDoUser({ department: "Phòng AI, Phòng Bản đồ" }), true);
  assert.equal(isBanDoUser({ department: "Phòng AI" }), false);
  assert.equal(isBanDoUser({ department: "" }), false);
  assert.equal(isBanDoUser({ department: null }), false);
  assert.equal(isBanDoUser(null), false);
  assert.equal(isBanDoUser(undefined), false);
});

test("isBanDoView: đang lọc phòng Bản đồ (tên Việt hoặc Nhật) -> hiện với mọi người", () => {
  assert.equal(isBanDoView("Phòng Bản đồ", { department: "Phòng AI" }), true);
  assert.equal(isBanDoView("測量解析", null), true);
});

test("isBanDoView: chưa lọc -> chỉ hiện khi người xem thuộc phòng Bản đồ; lọc phòng khác -> ẩn", () => {
  assert.equal(isBanDoView("", { department: "Phòng Bản đồ" }), true);
  assert.equal(isBanDoView("", { department: "Phòng BIM" }), false);
  assert.equal(isBanDoView("", null), false);
  assert.equal(isBanDoView("Phòng AI", { department: "Phòng Bản đồ" }), false);
});
