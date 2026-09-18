const test = require("node:test");
const assert = require("node:assert/strict");
const { loadTypeScript } = require("./helpers/load-typescript.cjs");

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
