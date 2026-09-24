// Run from frontend: node --test tests/linkify.test.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");

const moduleExports = {};
vm.runInNewContext(ts.transpileModule(
  fs.readFileSync(path.join(__dirname, "../src/lib/linkify.ts"), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText, { exports: moduleExports });
const { splitLinks } = moduleExports;
// Mảng/object tạo trong vm mang prototype của realm khác -> dựng lại bằng Array.from + spread
// ở realm của test trước khi deepEqual (strict so cả prototype).
const plain = (parts) => Array.from(parts, (p) => ({ ...p }));

test("chữ thường không có link -> 1 phần text; chuỗi rỗng -> không có phần nào", () => {
  assert.deepEqual(plain(splitLinks("Cảm ơn anh đã hỗ trợ.")), [{ type: "text", value: "Cảm ơn anh đã hỗ trợ." }]);
  assert.deepEqual(plain(splitLinks("")), []);
});

test("tách URL giữa câu, giữ nguyên chữ hai bên", () => {
  assert.deepEqual(plain(splitLinks("xem https://maps.app.goo.gl/abc nhé")), [
    { type: "text", value: "xem " },
    { type: "link", value: "https://maps.app.goo.gl/abc" },
    { type: "text", value: " nhé" },
  ]);
});

test("URL dài kiểu Google Maps (có ! và ?) được giữ nguyên, dấu ? cuối câu bị đẩy ra ngoài", () => {
  const url = "https://www.google.com/maps/place/x/@36.5776,140.2164,148m/data=!3m1!1e3!4m4!3m3!8m2!3d36.5776!4d140.2164?entry=ttu";
  assert.deepEqual(plain(splitLinks(url)), [{ type: "link", value: url }]);
  assert.deepEqual(plain(splitLinks(`Link: ${url}?`)), [
    { type: "text", value: "Link: " },
    { type: "link", value: url },
    { type: "text", value: "?" },
  ]);
});

test("dấu câu và ngoặc đóng thừa ở cuối không dính vào link; ngoặc cân bằng thì giữ", () => {
  assert.deepEqual(plain(splitLinks("(xem https://a.b/c).")), [
    { type: "text", value: "(xem " },
    { type: "link", value: "https://a.b/c" },
    { type: "text", value: ")." },
  ]);
  assert.deepEqual(plain(splitLinks("https://vi.wikipedia.org/wiki/Hà_Nội_(thành_phố)")), [
    { type: "link", value: "https://vi.wikipedia.org/wiki/Hà_Nội_(thành_phố)" },
  ]);
});

test("nhiều link trên nhiều dòng", () => {
  const parts = splitLinks("a https://x.y/1\nb http://x.y/2");
  assert.deepEqual(Array.from(parts.filter((p) => p.type === "link"), (p) => p.value), ["https://x.y/1", "http://x.y/2"]);
  assert.equal(parts.map((p) => p.value).join(""), "a https://x.y/1\nb http://x.y/2");
});
