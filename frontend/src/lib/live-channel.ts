"use client";

// Kênh nhận tin TRỰC TIẾP từ máy chủ (Server-Sent Events) — giao diện đổi tức thì.
//
// Cả ứng dụng dùng CHUNG MỘT kết nối: mở nhiều tab thì mỗi tab 1 kết nối, nhưng
// trong 1 tab dù bao nhiêu trang/ô đăng ký nghe cũng chỉ tốn 1 kết nối.
//
// Dùng fetch + đọc luồng chứ KHÔNG dùng EventSource, vì EventSource không gắn
// được header Authorization — mà nhét token vào URL thì token lọt vào log của
// máy chủ/proxy.
//
// Mất mạng / máy chủ khởi động lại -> tự kết nối lại, giãn dần 1s → 2s → 4s …
// tối đa 30s. Trong lúc chưa kết nối lại được, các trang vẫn đúng dữ liệu nhờ
// NHỊP HỎI LẠI DỰ PHÒNG trong use-auto-refresh.ts.

import { API_BASE, tokenStore } from "./api";

type Listener = (topic: string) => void;

const listeners = new Set<Listener>();
let controller: AbortController | null = null;
let retryMs = 1000;
let connected = false;
let stopped = true;

const MAX_RETRY_MS = 30_000;

/** Kênh trực tiếp có đang chạy không — dùng để giãn nhịp hỏi lại dự phòng. */
export function isLiveConnected(): boolean {
  return connected;
}

function emit(topic: string) {
  listeners.forEach((fn) => {
    try {
      fn(topic);
    } catch {
      /* một người nghe lỗi không được làm hỏng những người còn lại */
    }
  });
}

async function run() {
  const token = tokenStore.get();
  if (!token) return;                       // chưa đăng nhập thì chưa mở kênh
  controller = new AbortController();
  try {
    const res = await fetch(`${API_BASE}/events/stream`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok || !res.body) throw new Error(String(res.status));

    connected = true;
    retryMs = 1000;                         // kết nối được -> đặt lại nhịp thử lại
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // Mỗi tin SSE kết thúc bằng 1 dòng trống.
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const frame of parts) {
        let event = "message";
        let data = "";
        for (const line of frame.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data = line.slice(5).trim();
          // dòng bắt đầu bằng ":" là ping giữ kết nối -> bỏ qua
        }
        if (event === "changed" && data) emit(data);
      }
    }
  } catch {
    /* mất kết nối -> thử lại bên dưới */
  } finally {
    connected = false;
    controller = null;
  }
}

function scheduleReconnect() {
  if (stopped) return;
  const wait = retryMs;
  retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
  setTimeout(() => {
    if (!stopped) loop();
  }, wait);
}

async function loop() {
  if (stopped || controller) return;
  await run();
  scheduleReconnect();
}

function start() {
  if (!stopped) return;
  stopped = false;
  retryMs = 1000;
  loop();
}

function stop() {
  stopped = true;
  connected = false;
  controller?.abort();
  controller = null;
}

/**
 * Đăng ký nghe tin đổi dữ liệu. Trả về hàm hủy đăng ký.
 * Có người nghe đầu tiên thì mở kết nối; hết người nghe thì đóng lại.
 */
export function onLiveChange(fn: Listener): () => void {
  listeners.add(fn);
  start();
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0) stop();
  };
}
