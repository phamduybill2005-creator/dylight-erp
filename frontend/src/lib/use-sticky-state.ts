"use client";

// GIỮ LỰA CHỌN CỦA NGƯỜI DÙNG KHI F5.
//
// Trước đây mọi bộ lọc (phòng ban, tháng, ô tìm kiếm, chế độ xem...) đều là
// useState thuần -> tải lại trang là mất sạch, phải chọn lại từ đầu.
//
// Dùng sessionStorage chứ KHÔNG dùng localStorage:
//   - Sống qua F5 và qua chuyển trang trong app  -> đúng thứ người dùng cần.
//   - Tự hết khi đóng trình duyệt                -> sáng hôm sau mở lại không bị
//     kẹt ở bộ lọc/tháng của hôm trước rồi tưởng mất dữ liệu.
//
// Khoá có kèm ID người dùng nên hai người dùng chung một máy (hoặc đăng xuất rồi
// đăng nhập tài khoản khác) KHÔNG thừa hưởng lựa chọn của nhau.

import { useEffect, useState } from "react";

/** ID người đang đăng nhập, đọc ĐỒNG BỘ (api.me() ghi lại lúc đăng nhập). */
function currentUid(): string {
  if (typeof window === "undefined") return "anon";
  try {
    return localStorage.getItem("dylight_uid") || "anon";
  } catch {
    return "anon";
  }
}

function storageKey(key: string): string {
  return `dylight:${currentUid()}:${key}`;
}

/**
 * Giống useState nhưng NHỚ giá trị qua lần tải lại trang, riêng theo từng người.
 *
 * @param key   tên riêng của giá trị, vd "projects.filterDept"
 * @param initial giá trị mặc định khi chưa từng lưu
 */
export function useStickyState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    try {
      const raw = sessionStorage.getItem(storageKey(key));
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      // Dữ liệu cũ hỏng / trình duyệt chặn -> dùng mặc định, đừng làm vỡ trang.
      return initial;
    }
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey(key), JSON.stringify(value));
    } catch {
      // Chế độ ẩn danh hoặc hết dung lượng -> bỏ qua, trang vẫn chạy bình thường.
    }
  }, [key, value]);

  return [value, setValue] as const;
}
