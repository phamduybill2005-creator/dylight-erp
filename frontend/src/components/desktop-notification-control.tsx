"use client";

import { useEffect, useState } from "react";
import {
  desktopPermission, requestDesktopPermission, showDesktopNotification, type DesktopPermission,
} from "@/lib/desktop-notifications";

export default function DesktopNotificationControl() {
  const [permission, setPermission] = useState<DesktopPermission>("unsupported");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const refresh = () => setPermission(desktopPermission());
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  async function enableAndTest() {
    setBusy(true);
    setMessage("");
    try {
      const next = await requestDesktopPermission();
      setPermission(next);
      if (next === "granted") {
        const sent = showDesktopNotification("DOSCO — Thông báo desktop đã bật", {
          body: "Giữ một tab DOSCO mở để nhận thông báo khi đang dùng ứng dụng khác.",
          tag: "dosco-desktop-test",
        });
        setMessage(sent
          ? "Đã gửi thông báo thử. Nếu chưa thấy, kiểm tra banner thông báo Chrome/Edge và chế độ Không làm phiền của Windows."
          : "Trình duyệt chưa hiển thị được thông báo desktop. Hãy thử trên Chrome/Edge máy tính.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 border-b border-line bg-paper px-4 py-3 text-[11px]">
      <p className="font-semibold text-ink">
        {permission === "granted" ? "Thông báo desktop đang bật" : "Nhận thông báo ở góc màn hình"}
      </p>
      <p className="text-muted">
        {permission === "denied"
          ? "Thông báo đang bị chặn. Mở cài đặt trang bên trái thanh địa chỉ, chọn Thông báo → Cho phép, rồi quay lại đây."
          : permission === "unsupported"
          ? "Hãy mở DOSCO bằng HTTPS trên trình duyệt máy tính có hỗ trợ thông báo, như Chrome/Edge."
          : "Giữ một tab DOSCO mở để nhận tin nhắn, thông báo nội bộ và nhắc hạn nộp khi dùng ứng dụng khác."}
      </p>
      {permission !== "denied" && permission !== "unsupported" && (
        <button onClick={enableAndTest} disabled={busy} className="rounded-lg bg-ink px-3 py-2 font-semibold text-white hover:bg-steel disabled:opacity-50">
          {busy ? "Đang bật…" : permission === "granted" ? "Gửi thông báo thử" : "Bật thông báo desktop"}
        </button>
      )}
      {message && <p role="status" className="text-steel">{message}</p>}
    </div>
  );
}
