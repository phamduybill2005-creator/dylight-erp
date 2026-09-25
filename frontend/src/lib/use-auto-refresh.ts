"use client";

import { useEffect, useRef } from "react";

/** Nhịp làm mới mặc định — bằng với nhịp sẵn có ở trang Chấm công / Dự án. */
export const AUTO_REFRESH_MS = 20_000;

type Options = {
  /** Tạm dừng khi chưa sẵn sàng (chưa đăng nhập xong) hoặc đang mở form sửa. */
  enabled?: boolean;
  intervalMs?: number;
};

/**
 * Tự làm mới dữ liệu để người dùng KHÔNG phải F5.
 *
 * Chạy lại hàm nạp khi:
 *  - hết mỗi `intervalMs` VÀ tab đang hiển thị — tab ẩn thì nghỉ, đỡ tốn mạng và pin;
 *  - người dùng quay lại tab / cửa sổ (visibilitychange, focus) — thấy dữ liệu mới
 *    NGAY, không phải chờ hết nhịp. Đây là lúc hay cần nhất: vừa chuyển sang app
 *    khác rồi quay lại, hoặc sếp vừa duyệt đơn ở máy bên cạnh.
 *
 * KHÔNG tự gọi lần đầu: trang vẫn tự nạp lần đầu theo luồng riêng của nó
 * (thường là sau khi biết mình là ai qua /auth/me).
 *
 * `reload` được giữ trong ref nên trang KHÔNG cần bọc useCallback, và hàm đổi
 * cũng không làm dựng lại bộ đếm.
 */
export function useAutoRefresh(reload: () => void, options: Options = {}) {
  const { enabled = true, intervalMs = AUTO_REFRESH_MS } = options;
  const fn = useRef(reload);
  fn.current = reload;

  useEffect(() => {
    if (!enabled) return;
    const run = () => {
      if (typeof document === "undefined" || document.visibilityState === "visible") {
        fn.current();
      }
    };
    const timer = setInterval(run, intervalMs);
    document.addEventListener("visibilitychange", run);
    window.addEventListener("focus", run);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", run);
      window.removeEventListener("focus", run);
    };
  }, [enabled, intervalMs]);
}
