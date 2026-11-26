const test = require("node:test");
const assert = require("node:assert/strict");
const { loadTypeScript } = require("./helpers/load-typescript.cjs");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

test("director navigation includes review and summary on desktop and mobile", () => {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync("src/components/app-shell.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(`${source}\nexports.deskNav = deskNav;`, {
    module, exports: module.exports,
    require: name => name === "@/lib/roles" ? loadTypeScript("src/lib/roles.ts") : {},
  });
  const items = module.exports.deskNav({ id: 7, role: "DIRECTOR" });
  for (const href of ["/peer-review", "/evaluations"]) {
    assert.equal(items.filter(item => item.href === href).length, 1);
  }
  const { buildMobileNavigation } = loadTypeScript("src/lib/mobile-navigation.ts");
  const mobile = buildMobileNavigation(items, "/peer-review");
  assert.ok([...mobile.primary, ...mobile.secondary].some(item => item.href === "/peer-review"));
  assert.equal(mobile.moreActive, true);
});

test("mobile navigation keeps four daily destinations visible", () => {
  const { buildMobileNavigation } = loadTypeScript("src/lib/mobile-navigation.ts");
  const items = [
    { href: "/", label: "Tổng quan" },
    { href: "/projects", label: "Dự án" },
    { href: "/timesheet", label: "Tiến độ" },
    { href: "/revenue", label: "Doanh thu" },
    { href: "/work-schedule", label: "Lịch làm việc" },
    { href: "/attendance", label: "Chấm công" },
  ];

  const result = buildMobileNavigation(items, "/timesheet");

  assert.deepEqual(result.primary.map((item) => item.href), ["/", "/projects", "/timesheet", "/work-schedule"]);
  assert.deepEqual(result.secondary.map((item) => item.href), ["/revenue", "/attendance"]);
  assert.equal(result.moreActive, false);
});

test("mobile navigation marks More active for a secondary destination", () => {
  const { buildMobileNavigation } = loadTypeScript("src/lib/mobile-navigation.ts");
  const items = [
    { href: "/", label: "Tổng quan" },
    { href: "/projects", label: "Dự án" },
    { href: "/timesheet", label: "Tiến độ" },
    { href: "/work-schedule", label: "Lịch làm việc" },
    { href: "/attendance", label: "Chấm công" },
  ];

  const result = buildMobileNavigation(items, "/attendance/summary");

  assert.equal(result.moreActive, true);
});
