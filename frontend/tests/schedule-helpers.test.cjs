const test = require("node:test");
const assert = require("node:assert/strict");
const { loadTypeScript } = require("./helpers/load-typescript.cjs");

test("resolveLatestApprovedLeave prioritizes the schedule approved most recently", () => {
  const { resolveLatestApprovedLeave, getApprovedLeavesForDate } = loadTypeScript("src/lib/schedule-helpers.ts");

  // Đơn 1: Đăng ký lịch sinh viên tuần trước (làm sáng nghỉ chiều -> leave_type="AFTERNOON")
  const studentWeeklySchedule = {
    id: 101,
    company_id: 1,
    user_id: 10,
    from_date: "2026-09-18",
    to_date: "2026-09-18",
    leave_type: "AFTERNOON",
    reason: "Đi học (Nghỉ chiều)",
    status: "APPROVED",
    source: "SCHEDULE",
    decided_at: "2026-09-15T08:00:00Z",
    created_at: "2026-09-15T08:00:00Z",
    days: 0.5,
  };

  // Đơn 2: Đơn xin nghỉ phép đột xuất sáng hôm qua được duyệt sau (nghỉ sáng -> leave_type="MORNING")
  const urgentLeaveRequest = {
    id: 108,
    company_id: 1,
    user_id: 10,
    from_date: "2026-09-18",
    to_date: "2026-09-18",
    leave_type: "MORNING",
    reason: "ĐI HỌC",
    status: "APPROVED",
    source: "LEAVE",
    decided_at: "2026-09-17T16:30:00Z",
    created_at: "2026-09-17T09:00:00Z",
    days: 0.5,
  };

  const leaves = [studentWeeklySchedule, urgentLeaveRequest];

  // Đơn được duyệt sau cùng (urgentLeaveRequest) phải hiện lên đầu
  const latest = resolveLatestApprovedLeave(leaves, 10, "2026-09-18");
  assert.equal(latest.id, 108);
  assert.equal(latest.leave_type, "MORNING");
  assert.equal(latest.reason, "ĐI HỌC");

  // Kiểm tra danh sách đầy đủ: đơn duyệt sau cùng đứng trước, đơn cũ đứng sau (lớp dưới)
  const allForDate = getApprovedLeavesForDate(leaves, 10, "2026-09-18");
  assert.equal(allForDate.length, 2);
  assert.equal(allForDate[0].id, 108);
  assert.equal(allForDate[1].id, 101);
});

test("resolveLatestApprovedLeave falls back to older schedule if the newer one is removed", () => {
  const { resolveLatestApprovedLeave } = loadTypeScript("src/lib/schedule-helpers.ts");

  const studentWeeklySchedule = {
    id: 101,
    company_id: 1,
    user_id: 10,
    from_date: "2026-09-18",
    to_date: "2026-09-18",
    leave_type: "AFTERNOON",
    reason: "Đi học (Nghỉ chiều)",
    status: "APPROVED",
    source: "SCHEDULE",
    decided_at: "2026-09-15T08:00:00Z",
    created_at: "2026-09-15T08:00:00Z",
    days: 0.5,
  };

  const leaves = [studentWeeklySchedule];
  const active = resolveLatestApprovedLeave(leaves, 10, "2026-09-18");
  assert.equal(active.id, 101);
  assert.equal(active.leave_type, "AFTERNOON");
});

test("resolveLatestApprovedLeave handles tie breaking by creation time and id", () => {
  const { resolveLatestApprovedLeave } = loadTypeScript("src/lib/schedule-helpers.ts");

  const leaveA = {
    id: 200,
    company_id: 1,
    user_id: 10,
    from_date: "2026-09-18",
    to_date: "2026-09-18",
    leave_type: "MORNING",
    reason: "Lý do A",
    status: "APPROVED",
    decided_at: null,
    created_at: "2026-09-17T10:00:00Z",
    days: 0.5,
  };

  const leaveB = {
    id: 205,
    company_id: 1,
    user_id: 10,
    from_date: "2026-09-18",
    to_date: "2026-09-18",
    leave_type: "FULL",
    reason: "Lý do B",
    status: "APPROVED",
    decided_at: null,
    created_at: "2026-09-17T10:00:00Z",
    days: 1.0,
  };

  const leaves = [leaveA, leaveB];
  const active = resolveLatestApprovedLeave(leaves, 10, "2026-09-18");
  assert.equal(active.id, 205);
});

test("weekStartOf returns the Monday of the week (Mon-Sun)", () => {
  const { weekStartOf } = loadTypeScript("src/lib/schedule-helpers.ts");
  assert.equal(weekStartOf("2026-10-26"), "2026-10-26"); // Thứ Hai
  assert.equal(weekStartOf("2026-10-28"), "2026-10-26"); // Thứ Tư
  assert.equal(weekStartOf("2026-11-01"), "2026-10-26"); // Chủ nhật vẫn thuộc tuần 26/10
  assert.equal(weekStartOf("2026-11-02"), "2026-11-02"); // Thứ Hai tuần sau
});

test("isStudentWeekLocked locks started weeks for everyone except ADMIN", () => {
  const { isStudentWeekLocked } = loadTypeScript("src/lib/schedule-helpers.ts");
  const today = "2026-10-28"; // Thứ Tư
  // Tuần hiện tại (đã bắt đầu) và tuần trước: khóa với nhân viên + quản lý + giám đốc.
  for (const role of ["FIELD_STAFF", "MANAGER_MID", "MANAGER", "DIRECTOR", undefined]) {
    assert.equal(isStudentWeekLocked("2026-10-30", role, today), true, `current week ${role}`);
    assert.equal(isStudentWeekLocked("2026-10-26", role, today), true, `monday of current week ${role}`);
    assert.equal(isStudentWeekLocked("2026-10-21", role, today), true, `last week ${role}`);
    // Tuần sau chưa bắt đầu -> vẫn đăng ký được.
    assert.equal(isStudentWeekLocked("2026-11-02", role, today), false, `next week ${role}`);
    assert.equal(isStudentWeekLocked("2026-11-07", role, today), false, `next saturday ${role}`);
  }
  // Chủ nhật 01/11 vẫn là tuần hiện tại -> khóa; nhưng ADMIN sửa được mọi tuần.
  assert.equal(isStudentWeekLocked("2026-11-01", "FIELD_STAFF", today), true);
  assert.equal(isStudentWeekLocked("2026-10-26", "ADMIN", today), false);
  assert.equal(isStudentWeekLocked("2026-10-05", "ADMIN", today), false);
});
