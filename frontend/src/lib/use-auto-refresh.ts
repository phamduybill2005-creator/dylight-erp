"use client";

import { useEffect, useRef } from "react";

import { isLiveConnected, onLiveChange } from "./live-channel";

/**
 * Nhịp HỎI LẠI DỰ PHÒNG. Đây KHÔNG phải cách cập nhật chính — cập nhật chính là
 * kênh trực tiếp (live-channel.ts), độ trễ vài chục mili-giây. Nhịp này chỉ để
 * vá những trường hợp kênh trực tiếp không tới được:
 *   - máy chủ chạy nhiều worker/nhiều máy (tin sinh ở worker khác);
 *   - proxy chặn hoặc đệm luồng;
 *   - chỗ sửa dữ liệu nào đó chưa gọi publish().
 * Kênh trực tiếp đang chạy thì giãn ra rất thưa cho đỡ tốn.
 */
export const FALLBACK_MS_LIVE = 120_000;
export const FALLBACK_MS_OFFLINE = 15_000;

type Options = {
  /** Tạm dừng khi chưa sẵn sàng (chưa đăng nhập xong) hoặc đang mở form sửa. */
  enabled?: boolean;
  /**
   * Chỉ nạp lại khi máy chủ báo đúng mục này đổi (vd ["leave", "schedule"]).
   * Bỏ trống = nạp lại với mọi thay đổi.
   */
  topics?: string[];
  /** Ép nhịp dự phòng riêng (hiếm khi cần). */
  intervalMs?: number;
};

/**
 * Tự cập nhật dữ liệu để người dùng KHÔNG phải F5.
 *
 * Ba đường, xếp theo thứ tự nhanh dần:
 *  1. KÊNH TRỰC TIẾP — máy chủ đẩy tin ngay khi có người sửa dữ liệu. Đây là
 *     đường chính, gần như tức thì.
 *  2. QUAY LẠI TAB — người dùng chuyển sang app khác rồi quay lại thì nạp ngay,
 *     không chờ gì cả.
 *  3. NHỊP DỰ PHÒNG — xem ghi chú ở trên.
 *
 * KHÔNG tự gọi lần đầu: trang vẫn tự nạp lần đầu theo luồng riêng của nó.
 * `reload` giữ trong ref nên trang KHÔNG cần bọc useCallback.
 */
export function useAutoRefresh(reload: () => void, options: Options = {}) {
  const { enabled = true, topics, intervalMs } = options;
  const fn = useRef(reload);
  fn.current = reload;

  // Mảng topics hay được viết trực tiếp trong lời gọi (tạo mảng mới mỗi lần
  // render) -> so sánh bằng chuỗi để không dựng lại kết nối sau mỗi render.
  const topicKey = topics ? topics.join(",") : "";

  useEffect(() => {
    if (!enabled) return;
    const wanted = topicKey ? new Set(topicKey.split(",")) : null;

    const run = () => {
      if (typeof document === "undefined" || document.visibilityState === "visible") {
        fn.current();
      }
    };

    // 1. Kênh trực tiếp. Gom nhiều tin sát nhau thành 1 lần nạp (vd sửa liền tay
    //    nhiều ô giờ) để không bắn hàng loạt request.
    let gom: ReturnType<typeof setTimeout> | undefined;
    const offLive = onLiveChange((topic) => {
      if (wanted && !wanted.has(topic)) return;
      clearTimeout(gom);
      gom = setTimeout(run, 150);
    });

    // 2. Quay lại tab / cửa sổ.
    document.addEventListener("visibilitychange", run);
    window.addEventListener("focus", run);

    // 3. Nhịp dự phòng, tự giãn ra khi kênh trực tiếp đang chạy.
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      run();
      timer = setTimeout(tick, intervalMs ?? (isLiveConnected() ? FALLBACK_MS_LIVE : FALLBACK_MS_OFFLINE));
    };
    timer = setTimeout(tick, intervalMs ?? FALLBACK_MS_OFFLINE);

    return () => {
      offLive();
      clearTimeout(gom);
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", run);
      window.removeEventListener("focus", run);
    };
  }, [enabled, topicKey, intervalMs]);
}
