const assert = require("node:assert/strict");
const test = require("node:test");
const { loadTypeScript } = require("./helpers/load-typescript.cjs");

test("leave starts at most three calendar days ahead in Vietnam", () => {
  const { latestLeaveStartDate, validateLeaveStartDate } = loadTypeScript("src/lib/leave-submission.ts");
  const now = new Date("2026-11-25T03:00:00Z");
  assert.equal(latestLeaveStartDate(now), "2026-11-28");
  for (const day of ["2026-11-26", "2026-11-27", "2026-11-28"]) {
    assert.equal(validateLeaveStartDate(day, now), null);
  }
  assert.match(validateLeaveStartDate("2026-11-29", now), /3 ngày/);
});

test("window rolls over at Vietnam midnight and crosses month and year boundaries", () => {
  const { latestLeaveStartDate } = loadTypeScript("src/lib/leave-submission.ts");
  assert.equal(latestLeaveStartDate(new Date("2026-11-25T16:59:59Z")), "2026-11-28");
  assert.equal(latestLeaveStartDate(new Date("2026-11-25T17:00:00Z")), "2026-11-29");
  assert.equal(latestLeaveStartDate(new Date("2026-11-29T03:00:00Z")), "2026-12-02");
  assert.equal(latestLeaveStartDate(new Date("2026-12-30T03:00:00Z")), "2027-01-02");
});
