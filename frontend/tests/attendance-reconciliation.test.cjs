const assert = require("node:assert/strict");
const test = require("node:test");
const { loadTypeScript } = require("./helpers/load-typescript.cjs");

function model() { return loadTypeScript("src/lib/attendance-reconciliation.ts"); }
const session = (status, extras = {}) => ({ session: "AM", status, late_minutes: 0, explanation: "Căn cứ máy chấm công", leave_id: null, permission_source: null, override: null, data_confirmed: false, ...extras });
const rows = [
  { user_id: 1, department: "BIM, AI", morning: session("WAITING_DATA"), afternoon: session("NOT_FINISHED"), needs_attention: true },
  { user_id: 2, department: "AI", morning: session("PRESENT"), afternoon: session("EXCUSED_LATE"), needs_attention: false },
  { user_id: 3, department: "QS", morning: session("UNEXCUSED_ABSENCE"), afternoon: session("NEEDS_REVIEW"), needs_attention: true },
];

test("filters match either session, exact department membership, and attention together", () => {
  const { filterReconciliationRows } = model();
  assert.deepEqual(filterReconciliationRows(rows, { department: "AI", status: "WAITING_DATA", attentionOnly: true }).map(r => r.user_id), [1]);
  assert.deepEqual(filterReconciliationRows(rows, { department: "AI", status: "EXCUSED_LATE", attentionOnly: false }).map(r => r.user_id), [2]);
  assert.equal(filterReconciliationRows(rows, { department: "A", status: "", attentionOnly: false }).length, 0);
});

test("status and permission basis keep uncertainty distinct and link the actual request parameter", () => {
  const { RECONCILIATION_LABELS, sessionBasis, reconciliationLeavePath } = model();
  assert.equal(RECONCILIATION_LABELS.WAITING_DATA, "Chờ đủ dữ liệu");
  assert.equal(RECONCILIATION_LABELS.NEEDS_REVIEW, "Cần kiểm tra");
  assert.equal(sessionBasis(session("EXCUSED_LATE", { permission_source: "LEAVE" })), "Đơn đã duyệt");
  assert.equal(sessionBasis(session("EXCUSED_LATE", { permission_source: "ADMIN" })), "Xác nhận của quản trị");
  assert.equal(sessionBasis(session("PENDING_APPROVAL", { leave_id: 42 })), "Đơn chờ duyệt");
  assert.equal(reconciliationLeavePath(42), "/leave?request_id=42");
});

test("permission and reset both require a reason and authorizer and trim the submitted draft", () => {
  const { permissionPayload } = model();
  const target = { user_id: 7, work_date: "2026-11-06", session: "AM" };
  assert.throws(() => permissionPayload(target, { decision: "", reason: "", approved_by: "" }), /lý do/i);
  assert.throws(() => permissionPayload(target, { decision: "EXCUSED_LATE", reason: "Có phép", approved_by: " " }), /người cho phép/i);
  assert.deepEqual(permissionPayload(target, { decision: "", reason: "  Hủy xác nhận  ", approved_by: "  Giám đốc  " }), { ...target, decision: null, reason: "Hủy xác nhận", approved_by: "Giám đốc" });
});

test("new late requests require a valid arrival time while old request displays stay valid", () => {
  const { validateArrivalTime, lateArrivalLabel } = model();
  assert.equal(validateArrivalTime("LATE", ""), false);
  assert.equal(validateArrivalTime("LATE", "24:00"), false);
  assert.equal(validateArrivalTime("LATE", "08:45"), true);
  assert.equal(validateArrivalTime("LEAVE", ""), true);
  assert.equal(lateArrivalLabel({ leave_type: "LATE_MORNING" }), "Chưa ghi giờ đến (đơn cũ)");
  assert.equal(lateArrivalLabel({ leave_type: "LATE_AFTERNOON", allowed_arrival_time: "14:15" }), "Được đến muộn đến 14:15");
  assert.equal(lateArrivalLabel({ leave_type: "FULL" }), "");
});

test("reconciliation timestamps interpret naive backend values as Vietnam time and retain explicit offsets", () => {
  const { parseReconciliationTimestamp } = model();
  assert.equal(parseReconciliationTimestamp("2026-11-06T08:40:00").toISOString(), "2026-11-06T01:40:00.000Z");
  assert.equal(parseReconciliationTimestamp("2026-11-06 08:40:00.123456").toISOString(), "2026-11-06T01:40:00.123Z");
  assert.equal(parseReconciliationTimestamp("2026-11-06T01:40:00Z").toISOString(), "2026-11-06T01:40:00.000Z");
  assert.equal(parseReconciliationTimestamp("2026-11-06T03:40:00+02:00").toISOString(), "2026-11-06T01:40:00.000Z");
  assert.equal(parseReconciliationTimestamp(null), null);
  assert.equal(parseReconciliationTimestamp("invalid"), null);
});

test("punch and audit timestamps display Vietnam wall time on UTC devices", () => {
  const { execFileSync } = require("node:child_process");
  const output = execFileSync(process.execPath, ["-e", `
    const lib = require('./tests/helpers/load-typescript.cjs').loadTypeScript('src/lib/attendance-reconciliation.ts');
    process.stdout.write(JSON.stringify([
      lib.formatReconciliationTime('2026-11-06T08:40:00'),
      lib.formatReconciliationTime('2026-11-06T01:40:00Z'),
      lib.formatReconciliationDateTime('2026-11-06T08:40:00'),
      lib.formatReconciliationTime(null)
    ]));
  `], { cwd: require("node:path").resolve(__dirname, ".."), env: { ...process.env, TZ: "UTC" }, encoding: "utf8" });
  const [naive, explicit, audit, missing] = JSON.parse(output);
  assert.equal(naive, "08:40");
  assert.equal(explicit, "08:40");
  assert.match(audit, /08:40/);
  assert.match(audit, /06\/11\/2026/);
  assert.equal(missing, "—");
});
