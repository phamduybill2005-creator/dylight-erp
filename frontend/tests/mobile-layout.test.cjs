// Run from frontend: node --test tests/mobile-layout.test.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = (file) => fs.readFileSync(path.join(__dirname, "../src", file), "utf8");
const timesheet = read("app/timesheet/page.tsx");
const workSchedule = read("app/work-schedule/page.tsx");
const attendanceMachine = read("app/attendance-machine/page.tsx");
const attendance = read("app/attendance/page.tsx");
const revenue = read("app/revenue/page.tsx");

test("bảng Tiến độ tháng giữ độ rộng ngày và cuộn ngang trên điện thoại", () => {
  assert.match(timesheet, /isMonth \? "min-w-\[1200px\]" : "min-w-\[850px\]"/);
  assert.match(timesheet, /isMonth \? "w-\[30px\] min-w-\[30px\]" : "w-\[54px\]"/);
});

test("bảng Lịch làm việc tháng không ép 31 cột vào màn hình nhỏ", () => {
  assert.match(workSchedule, /overflow-x-auto/);
  assert.match(workSchedule, /min-w-\[1120px\]/);
  assert.match(workSchedule, /w-\[30px\] min-w-\[30px\]/);
});

test("bảng ghép máy chấm công có thể cuộn ngang trên điện thoại", () => {
  assert.match(attendanceMachine, /overflow-x-auto rounded-lg border border-line/);
  assert.match(attendanceMachine, /table className="w-full min-w-\[520px\]/);
});

test("các thanh công cụ chấm công và thẻ doanh thu không tràn ngang", () => {
  assert.match(attendance, /<header className="flex flex-wrap items-center justify-between gap-3/);
  assert.match(revenue, /flex w-full min-w-0 max-w-full flex-wrap items-center/);
});
