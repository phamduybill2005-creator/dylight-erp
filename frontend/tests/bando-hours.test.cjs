// Run from frontend: node --test tests/bando-hours.test.cjs
// 9 cột giờ Phòng Bản đồ ở tab Doanh thu: khớp tên nhóm hạng mục của mẫu Sample với cột.
const assert = require("node:assert/strict");
const test = require("node:test");
const { loadTypeScript } = require("./helpers/load-typescript.cjs");

const { BANDO_HOUR_COLUMNS, normalizeGroupName, columnKeyForGroup, hoursByColumn, formatGroupHours } =
  loadTypeScript("src/lib/bando-hours.ts");

test("đúng 9 cột theo thứ tự mẫu Sample - Phòng Bản đồ", () => {
  assert.deepEqual(BANDO_HOUR_COLUMNS.map((c) => c.label), [
    "Ortho", "RIEGL", "QLCL", "DATA", "Ground", "Grid_XML", "HoverMaps", "トレース", "TD-TN",
  ]);
});

test("normalizeGroupName: hoa/thường, cách, gạch dưới, gạch ngang đều về một dạng", () => {
  assert.equal(normalizeGroupName("Grid_XML_Đường đồng mức"), "grid-xml-đường-đồng-mức");
  assert.equal(normalizeGroupName("  TD - TN "), "td-tn");
  assert.equal(normalizeGroupName("HoverMaps"), "hovermaps");
  assert.equal(normalizeGroupName(null), "");
});

test("columnKeyForGroup: mỗi tên nhóm trong mẫu về đúng cột của nó", () => {
  const sample = ["Ortho", "RIEGL", "QLCL", "DATA", "Ground", "Grid_XML_Đường đồng mức", "HoverMaps", "トレース", "TD-TN"];
  assert.deepEqual(sample.map(columnKeyForGroup), BANDO_HOUR_COLUMNS.map((c) => c.key));
});

test("columnKeyForGroup: chấp nhận biến thể tên thường gặp, từ chối nhóm ngoài mẫu", () => {
  assert.equal(columnKeyForGroup("ortho"), "ortho");
  assert.equal(columnKeyForGroup("Grid_XML"), "grid");
  assert.equal(columnKeyForGroup("Grid"), "grid");
  assert.equal(columnKeyForGroup("Trace"), "trace");
  assert.equal(columnKeyForGroup("TD_TN"), "tdtn");
  assert.equal(columnKeyForGroup("Hover Maps"), "hovermaps");
  assert.equal(columnKeyForGroup("Khảo sát hiện trường"), null);
  // "Database" không phải "DATA": chỉ khớp nguyên tên hoặc "<tên>-...".
  assert.equal(columnKeyForGroup("Database"), null);
  assert.equal(columnKeyForGroup(""), null);
});

test("hoursByColumn: đủ 9 key, cộng dồn nhóm trùng cột, bỏ nhóm lạ, làm tròn 0,1", () => {
  const out = hoursByColumn({
    "Ortho": 4, "ortho": 2.25, "RIEGL": 0, "Grid_XML_Đường đồng mức": 7.5, "トレース": 3, "Việc khác": 100,
  });
  assert.deepEqual(Object.keys(out), BANDO_HOUR_COLUMNS.map((c) => c.key));
  assert.equal(out.ortho, 6.3);
  assert.equal(out.riegl, 0);
  assert.equal(out.grid, 7.5);
  assert.equal(out.trace, 3);
  assert.equal(out.tdtn, 0);
  assert.deepEqual(hoursByColumn(undefined).ortho, 0);
});

test("formatGroupHours: 0 -> '—', số lẻ kiểu Việt", () => {
  assert.equal(formatGroupHours(0), "—");
  assert.equal(formatGroupHours(12.5), "12,5h");
  assert.equal(formatGroupHours(8), "8h");
});
