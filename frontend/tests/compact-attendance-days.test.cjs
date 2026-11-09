const assert = require("node:assert/strict");
const test = require("node:test");
const { loadTypeScript } = require("./helpers/load-typescript.cjs");
const model = () => loadTypeScript("src/lib/compact-attendance-days.ts");
const session = (status, session = "AM", extra = {}) => ({ status, session, explanation: "Căn cứ đã kiểm tra", late_minutes: 0, leave_id: null, permission_source: null, override: null, data_confirmed: false, ...extra });
const result = (date, am, pm = am) => ({ user_id: 7, work_date: date, morning: session(am), afternoon: session(pm, "PM") });

test("early-only checkout opens the correct session and permission while actual lateness keeps priority", () => {
  const { buildCompactAttendanceDays, initialCompactPermission } = model();
  const record = { user_id: 7, work_date: "2026-11-02", check_in: "2026-11-02T08:00:00", check_out: "2026-11-02T16:00:00" };
  const dayFor = row => buildCompactAttendanceDays("2026-11", 7, [record], [row], "2026-11-06")[1];
  for (const target of ["AM", "PM"]) {
    const row = result(record.work_date, "PRESENT");
    Object.assign(target === "AM" ? row.morning : row.afternoon, { early_status: "UNEXCUSED_EARLY", early_minutes: 60 });
    assert.deepEqual(initialCompactPermission(dayFor(row)), { scope: target, decision: "EXCUSED_EARLY", reason: "", approved_by: "" });
    row.morning.status = "UNEXCUSED_LATE";
    assert.equal(initialCompactPermission(dayFor(row)).decision, target === "AM" ? "EXCUSED_LATE_EARLY" : "EXCUSED_LATE");
    assert.equal(initialCompactPermission(dayFor(row)).scope, "AM");
    row.afternoon.override = { decision: "EXCUSED_EARLY", reason: "Đã xác nhận", approved_by: "Chị Hà" };
    assert.deepEqual(initialCompactPermission(dayFor(row)), { scope: "PM", decision: "EXCUSED_EARLY", reason: "Đã xác nhận", approved_by: "Chị Hà" });
  }
});

test("combined permission preserves the existing override when both arrival and departure were excused", () => {
  const { buildCompactAttendanceDays, initialCompactPermission, compactPermissionPayload } = model();
  const row = result("2026-11-02", "EXCUSED_LATE");
  row.morning.override = { decision: "EXCUSED_LATE_EARLY", reason: "Có việc gia đình", approved_by: "Chị Hà" };
  row.morning.early_status = "EXCUSED_EARLY";
  const day = buildCompactAttendanceDays("2026-11", 7, [], [row], "2026-11-06")[1];
  const draft = initialCompactPermission(day);
  assert.equal(draft.decision, "EXCUSED_LATE_EARLY");
  assert.equal(draft.scope, "AM");
  assert.equal(compactPermissionPayload(7, row.work_date, draft).decision, "EXCUSED_LATE_EARLY");
});

test("calendar includes every real month date without manufacturing attendance records", () => {
  const { compactMonthRange, buildCompactAttendanceDays } = model();
  assert.deepEqual(compactMonthRange("2024-02"), { from: "2024-02-01", to: "2024-02-29" });
  assert.equal(buildCompactAttendanceDays("2026-11", 7, [], [], "2026-11-06").length, 30);
  const days = buildCompactAttendanceDays("2026-12", 7, [], [], "2026-11-06");
  assert.equal(days.length, 31);
  assert.equal(days[30].work_date, "2026-12-31");
  assert.ok(days.every(day => day.record === null));
  assert.ok(days.every(day => day.future));
  assert.equal(days[0].badges[0].label, "Chưa đến ngày");
});

test("approved no-punch absence is visible, mixed sessions stay separate, and unknown is never permission", () => {
  const { buildCompactAttendanceDays } = model();
  const days = buildCompactAttendanceDays("2026-11", 7, [], [result("2026-11-02", "EXCUSED_ABSENCE"), result("2026-11-03", "EXCUSED_ABSENCE", "PRESENT"), result("2026-11-04", "WAITING_DATA"), result("2026-11-01", "NOT_SCHEDULED")], "2026-11-06");
  assert.deepEqual(days[1].badges.map(b => b.label), ["Nghỉ có phép"]);
  assert.equal(days[1].record, null);
  assert.deepEqual(days[2].badges.map(b => b.label), ["Sáng: Nghỉ có phép", "Chiều: Có mặt"]);
  assert.equal(days[3].badges[0].label, "Chờ dữ liệu");
  assert.equal(days[4].badges[0].label, "Chưa có chấm công");
  assert.equal(days[0].badges[0].label, "Nghỉ theo lịch");
});

test("matching personal real punches and notes stay unchanged and other users cannot fill a day", () => {
  const { buildCompactAttendanceDays } = model();
  const record = { id: 12, user_id: 7, work_date: "2026-11-02", check_in: "2026-11-02T08:40:00", check_out: "2026-11-02T17:00:00", worked_minutes: 440, note: "Ghi chú" };
  const days = buildCompactAttendanceDays("2026-11", 7, [record, { ...record, user_id: 8, work_date: "2026-11-03" }], [result("2026-11-02", "EXCUSED_LATE", "PRESENT")], "2026-11-06");
  assert.equal(days[1].record, record);
  assert.equal(days[2].record, null);
  assert.equal(days[1].badges[0].label, "Sáng: Muộn có phép");
});

test("full-day permission uses one explicit payload; reset needs authorizer and reason", () => {
  const { compactPermissionPayload } = model();
  const draft = { scope: "ALL", decision: "EXCUSED_ABSENCE", reason: "  Zalo đã xin phép  ", approved_by: "  Giám đốc  " };
  assert.deepEqual(compactPermissionPayload(7, "2026-11-02", draft), { user_id: 7, work_date: "2026-11-02", sessions: ["AM", "PM"], decision: "EXCUSED_ABSENCE", reason: "Zalo đã xin phép", approved_by: "Giám đốc" });
  assert.deepEqual(compactPermissionPayload(7, "2026-11-02", { ...draft, scope: "PM", decision: "" }).sessions, ["PM"]);
  assert.equal(compactPermissionPayload(7, "2026-11-02", { ...draft, decision: "" }).decision, null);
  assert.throws(() => compactPermissionPayload(7, "2026-11-02", { ...draft, reason: " " }), /lý do/i);
  assert.throws(() => compactPermissionPayload(7, "2026-11-02", { ...draft, approved_by: " " }), /người cho phép/i);
});

test("opening a mixed day targets the exceptional session while matching prior overrides keep their scope", () => {
  const { buildCompactAttendanceDays, initialCompactPermission } = model();
  const days = buildCompactAttendanceDays("2026-11", 7, [], [result("2026-11-02", "EXCUSED_ABSENCE", "PRESENT"), result("2026-11-03", "PRESENT", "UNEXCUSED_LATE")], "2026-11-06");
  assert.equal(initialCompactPermission(days[1]).scope, "AM");
  assert.equal(initialCompactPermission(days[2]).scope, "PM");
  assert.equal(initialCompactPermission(days[0]).scope, "ALL");
});

test("late arrival takes priority over the other session's approved absence without granting that other session", () => {
  const { buildCompactAttendanceDays, initialCompactPermission } = model();
  const days = buildCompactAttendanceDays("2026-11", 7, [], [result("2026-11-02", "EXCUSED_ABSENCE", "UNEXCUSED_LATE"), result("2026-11-03", "UNEXCUSED_LATE", "PRESENT")], "2026-11-06");
  assert.deepEqual(initialCompactPermission(days[1]), { scope: "PM", decision: "EXCUSED_LATE", reason: "", approved_by: "" });
  assert.deepEqual(initialCompactPermission(days[2]), { scope: "AM", decision: "EXCUSED_LATE", reason: "", approved_by: "" });
});
