export interface NotificationSendResult {
  sent: number;
  // Optional while the frontend and backend are deployed separately.
  zalo?: { status: "sent" | "skipped" | "failed"; reason?: string };
}

export function formatNotificationSendResult(result: NotificationSendResult): string {
  const erp = `Đã gửi tới ${result.sent} người trong ERP.`;
  const delivery = result.zalo;
  if (!delivery) return erp;
  if (delivery.status === "sent") return `${erp} Zalo đã tiếp nhận 1 tin GMF.`;
  if (delivery.status === "skipped") {
    const reasons: Record<string, string> = {
      private_unavailable: "Chưa hỗ trợ gửi Zalo riêng.",
      disabled: "Zalo đang tắt; chỉ gửi trong ERP.",
      group_not_configured: "Chưa cấu hình nhóm Zalo; chỉ gửi trong ERP.",
      company_not_configured: "Công ty chưa được cấu hình gửi Zalo; chỉ gửi trong ERP.",
    };
    const explanation = reasons[delivery.reason || ""];
    if (explanation) return `${erp} ${explanation}`;
  }
  return `${erp} Chưa xác nhận gửi Zalo thành công. Không gửi lại thông báo ERP để tránh trùng tin.`;
}
