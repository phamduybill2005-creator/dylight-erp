// Bản đồ biệt danh RIÊNG của người đang đăng nhập ({user_id: biệt danh}).
// Tải MỘT LẦN, cache ở cấp module (nhiều component dùng chung 1 lần gọi mạng),
// rồi áp biệt danh ở mọi nơi hiển thị tên có kèm user_id.

import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

let cache: Record<string, string> | null = null;
let inflight: Promise<Record<string, string>> | null = null;

export function loadNicknames(): Promise<Record<string, string>> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = api
      .nicknameMap()
      .then((m) => {
        cache = m || {};
        return cache;
      })
      .catch(() => {
        inflight = null;
        return {};
      });
  }
  return inflight;
}

// Gọi sau khi người dùng đổi biệt danh để các trang khác lấy bản mới.
export function refreshNicknames() {
  cache = null;
  inflight = null;
}

/**
 * Hook trả về hàm nick(id, name): hiện BIỆT DANH nếu mình đã đặt cho người đó,
 * ngược lại hiện tên thật. Dùng: nick(sender_id, sender_name).
 */
export function useNicknames() {
  const [map, setMap] = useState<Record<string, string>>(cache || {});
  useEffect(() => {
    loadNicknames().then(setMap);
  }, []);
  const nick = useCallback(
    (id?: number | null, name?: string | null) => {
      if (id != null && map[String(id)]) return map[String(id)];
      return name || "";
    },
    [map]
  );
  return nick;
}
