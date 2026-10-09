const assert = require("node:assert/strict");
const test = require("node:test");
const { loadTypeScript } = require("./helpers/load-typescript.cjs");

test("announcement result reports accepted GMF separately from ERP recipients", () => {
  const { formatNotificationSendResult } = loadTypeScript("src/lib/notification-send-result.ts");
  assert.equal(formatNotificationSendResult({ sent: 8, zalo: { status: "sent" } }),
    "Đã gửi tới 8 người trong ERP. Zalo đã tiếp nhận 1 tin GMF.");
});

test("private delivery is explicit and skipped/failed does not suggest retrying ERP", () => {
  const { formatNotificationSendResult: format } = loadTypeScript("src/lib/notification-send-result.ts");
  assert.equal(format({ sent: 1, zalo: { status: "skipped", reason: "private_unavailable" } }),
    "Đã gửi tới 1 người trong ERP. Chưa hỗ trợ gửi Zalo riêng.");
  assert.match(format({ sent: 3, zalo: { status: "failed", reason: "send_failed" } }), /ERP\. Chưa xác nhận gửi Zalo thành công/);
  assert.match(format({ sent: 3, zalo: { status: "skipped", reason: "disabled" } }), /Zalo đang tắt/);
  assert.match(format({ sent: 3, zalo: { status: "skipped", reason: "group_not_configured" } }), /Chưa cấu hình nhóm Zalo/);
  assert.match(format({ sent: 3, zalo: { status: "skipped", reason: "company_not_configured" } }), /Công ty chưa được cấu hình gửi Zalo/);
});

test("older backend responses work and arbitrary provider error text is never displayed", () => {
  const { formatNotificationSendResult: format } = loadTypeScript("src/lib/notification-send-result.ts");
  assert.equal(format({ sent: 2 }), "Đã gửi tới 2 người trong ERP.");
  assert.doesNotMatch(format({ sent: 2, zalo: { status: "failed", reason: "access-token-secret" } }), /access-token-secret/);
});
