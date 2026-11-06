const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { loadTypeScript } = require("./helpers/load-typescript.cjs");

function client(status = 200) {
  const requests = [];
  const events = [];
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/lib/api.ts"), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, process, Headers, FormData, URLSearchParams, Event, console,
    localStorage: { getItem: () => "test-token" }, sessionStorage: { getItem: () => null },
    window: { dispatchEvent: event => events.push(event.type) },
    require: name => name === "./leave-links" ? loadTypeScript("src/lib/leave-links.ts") : require(name),
    fetch: async (url, init) => { requests.push({ url, ...init }); return { ok: status === 200, status, json: async () => status === 200 ? { rows: [], confirmations: [], confirmation_available: { AM: true, PM: false } } : { detail: "Chưa hết ca" } }; },
  });
  return { api: module.exports.api, requests, events };
}

test("reconciliation scopes reads to a date and optional personal user without mutations", async () => {
  const { api, requests, events } = client();
  await api.attendanceReconciliation("2026-11-06", "2026-11-06", 7);
  const url = new URL(requests[0].url);
  assert.equal(url.pathname, "/api/v1/attendance/reconciliation");
  assert.equal(url.searchParams.get("from_date"), "2026-11-06");
  assert.equal(url.searchParams.get("to_date"), "2026-11-06");
  assert.equal(url.searchParams.get("user_id"), "7");
  assert.equal(requests[0].headers.get("Authorization"), "Bearer test-token");
  assert.deepEqual(events, []);
});

test("permission, coverage and arrival-time writes retain the approved API payloads and trigger refresh", async () => {
  const { api, requests, events } = client();
  const permission = { user_id: 7, work_date: "2026-11-06", session: "PM", decision: null, reason: "Đặt lại", approved_by: "Giám đốc" };
  await api.setAttendancePermission(permission);
  await api.confirmAttendanceData({ work_date: "2026-11-06", session: "AM", reason: "Đã kiểm tra máy" });
  await api.createLeave({ from_date: "2026-11-07", to_date: "2026-11-07", leave_type: "LATE_MORNING", allowed_arrival_time: "09:00", reason: "ỐM ĐAU" });
  await api.updateAttendance(12, { check_in: "2026-11-06T08:40:00+07:00" });
  assert.equal(requests[0].method, "PUT");
  assert.equal(new URL(requests[0].url).pathname, "/api/v1/attendance/reconciliation/override");
  assert.deepEqual(JSON.parse(requests[0].body), permission);
  assert.equal(requests[1].method, "POST");
  assert.equal(new URL(requests[1].url).pathname, "/api/v1/attendance/reconciliation/confirm-data");
  assert.equal(JSON.parse(requests[2].body).allowed_arrival_time, "09:00");
  assert.equal(events.length, 4);
  assert.ok(events.every(event => event === "attendance-reconciliation-changed"));
});

test("rejected coverage is surfaced and never produces a successful mutation event", async () => {
  const { api, events } = client(400);
  await assert.rejects(api.confirmAttendanceData({ work_date: "2026-11-06", session: "PM", reason: "Kiểm tra" }), /Chưa hết ca/);
  assert.deepEqual(events, []);
});
