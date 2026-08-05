"use client";

import { useEffect } from "react";

/**
 * Hook giúp đóng modal/drawer khi nhấn phím Escape (ESC).
 * @param onEscape Hàm callback thực hiện đóng modal khi bấm ESC.
 * @param enabled Cờ bật/tắt listener (mặc định là true).
 */
export function useEscapeKey(onEscape: () => void, enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Esc") {
        onEscape();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onEscape, enabled]);
}
