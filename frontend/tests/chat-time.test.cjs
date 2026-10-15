const assert = require("node:assert/strict");
const test = require("node:test");
const { loadTypeScript } = require("./helpers/load-typescript.cjs");

const format = (...args) => loadTypeScript("src/lib/chat-time.ts").formatChatTime(...args);

test("explicit UTC message time displays seven hours later in Vietnam", () => {
  assert.equal(format("2026-09-24T02:26:00Z"), "09:26 24/09");
  assert.equal(format("2026-09-24T02:26:00.123456Z"), "09:26 24/09");
});

test("explicit UTC and Vietnam offsets represent the same message without double conversion", () => {
  for (const input of ["2026-09-24T02:26:00Z", "2026-09-24T09:26:00+07:00", "2026-09-24T11:26:00+0900"]) {
    assert.equal(format(input), "09:26 24/09");
  }
});

test("unknown legacy wall times are preserved rather than globally shifted by seven hours", () => {
  assert.equal(format("2026-09-24T09:26:00"), "09:26 24/09");
  assert.equal(format("2026-09-24T02:26:00"), "02:26 24/09");
  assert.equal(format("2026-09-24T09:26:00", "vietnam"), "09:26 24/09");
  assert.equal(format("2026-09-24T02:26:00Z", "vietnam"), "09:26 24/09");
});

test("conversion rolls the displayed date across midnight and year end", () => {
  assert.equal(format("2026-12-31T18:05:00Z"), "01:05 01/01");
});

test("chat displays Vietnam time regardless of the device timezone", () => {
  const previous = process.env.TZ;
  try {
    for (const tz of ["UTC", "America/New_York", "Asia/Tokyo", "Asia/Ho_Chi_Minh"]) {
      process.env.TZ = tz;
      assert.equal(format("2026-09-24T02:26:00Z"), "09:26 24/09");
      assert.equal(format("2026-09-24T09:26:00", "vietnam"), "09:26 24/09");
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test("missing or malformed times do not show Invalid Date", () => {
  for (const input of [undefined, null, "", "not-a-date"]) assert.equal(format(input), "—");
});
