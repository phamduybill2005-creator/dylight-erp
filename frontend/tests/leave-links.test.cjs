const assert = require("node:assert/strict");
const test = require("node:test");
const { loadTypeScript } = require("./helpers/load-typescript.cjs");

test("only one positive safe request ID can select a leave; URL action never decides it", () => {
  const { linkedLeaveId } = loadTypeScript("src/lib/leave-links.ts");
  assert.equal(linkedLeaveId("?request_id=42"), 42);
  assert.equal(linkedLeaveId("?request_id=42&action=approve"), 42);
  for (const query of ["", "?request_id=0", "?request_id=-1", "?request_id=1.5", "?request_id=abc", "?request_id=1&request_id=2", "?request_id=9007199254740992"]) {
    assert.equal(linkedLeaveId(query), null, query);
  }
});

test("login and expired sessions retain the exact leave and reject arbitrary return URLs", () => {
  const { leaveLoginPath, leaveLoginReturnPath } = loadTypeScript("src/lib/leave-links.ts");
  const login = leaveLoginPath("/leave", "?request_id=42");
  assert.equal(login, "/login?next=%2Fleave%3Frequest_id%3D42");
  assert.equal(leaveLoginReturnPath(login.slice(login.indexOf("?"))), "/leave?request_id=42");
  assert.equal(leaveLoginPath("/projects", "?request_id=42"), "/login");
  for (const value of ["https://evil.example/leave?request_id=42", "//evil.example/leave", "/leave?request_id=0", "/leave?request_id=42&action=approve", "/projects", "javascript:alert(1)"]) {
    assert.equal(leaveLoginReturnPath("?next=" + encodeURIComponent(value)), "/");
  }
  assert.equal(leaveLoginReturnPath("?next=%2Fleave%3Frequest_id%3D42&next=%2F"), "/");
});

test("only pending leaves and ERP approval roles show decision controls", () => {
  const { canDecideLinkedLeave } = loadTypeScript("src/lib/leave-links.ts");
  for (const role of ["ADMIN", "DIRECTOR", "MANAGER"]) assert.equal(canDecideLinkedLeave(role, "PENDING"), true);
  for (const role of ["FIELD_STAFF", "MANAGER_MID"]) assert.equal(canDecideLinkedLeave(role, "PENDING"), false);
  for (const status of ["APPROVED", "REJECTED"]) assert.equal(canDecideLinkedLeave("DIRECTOR", status), false);
});
