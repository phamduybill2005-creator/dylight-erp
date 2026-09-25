"use client";

// Kênh nhận tin TRỰC TIẾP từ máy chủ (Server-Sent Events) — giao diện đổi tức thì.
//
// Cả ứng dụng dùng CHUNG MỘT kết nối: trong 1 tab, dù bao nhiêu trang/ô đăng ký
// nghe cũng chỉ tốn 1 kết nối.
//
// Dùng fetch + đọc luồng chứ KHÔNG dùng EventSource, vì EventSource không gắn
// được header Authorization — mà nhét token vào URL thì token lọt vào log của
// máy chủ/proxy.
//
// GIỮ ĐÚNG MỘT KẾT NỐI là việc sống còn ở đây. Trình duyệt chỉ cho khoảng 6 kết
// nối đồng thời tới một máy chủ; rò vài kết nối SSE là mọi lệnh gọi API khác
// phải xếp hàng và cả web đứng hình. Vì vậy:
//   - mỗi vòng chạy mang một số hiệu (generation); start/stop tăng số hiệu để
//     vòng cũ tự thoát, không bao giờ có hai vòng cùng sống;
//   - dọn dẹp luôn kiểm tra "đúng kết nối của mình" trước khi xoá biến chung,
//     tránh vòng cũ đang tàn lại xoá nhầm kết nối của vòng mới;
//   - hết người nghe thì CHỜ VÀI GIÂY mới đóng, vì chuyển trang làm số người
//     nghe rơi về 0 trong chớp mắt rồi có lại ngay — đóng/mở liên tục chính là
//     nguồn gốc của rò kết nối.

import { API_BASE, tokenStore } from "./api";

type Listener = (topic: string) => void;

const listeners = new Set<Listener>();
const MAX_RETRY_MS = 30_000;
/** Chờ trước khi đóng kênh lúc không còn ai nghe (đủ để chuyển trang xong). */
const IDLE_CLOSE_MS = 5_000;

let generation = 0;            // số hiệu vòng chạy hiện hành
let running = false;           // đang có vòng chạy hay chưa
let activeController: AbortController | null = null;
let connected = false;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

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

/** Mở kết nối và đọc tới khi đứt. Trả về true nếu đã kết nối được ít nhất 1 lần. */
async function connect(gen: number): Promise<boolean> {
  const token = tokenStore.get();
  if (!token) return false;                 // chưa đăng nhập thì chưa mở kênh

  const ctrl = new AbortController();
  activeController = ctrl;
  let ok = false;
  try {
    const res = await fetch(`${API_BASE}/events/stream`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok || !res.body) throw new Error(String(res.status));

    ok = true;
    connected = true;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { value, done } = await reader.read();
      if (done || gen !== generation) break;
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
    /* mất kết nối -> vòng ngoài sẽ thử lại */
  } finally {
    // CHỈ dọn nếu biến chung vẫn đang trỏ đúng kết nối này.
    if (activeController === ctrl) {
      activeController = null;
      connected = false;
    }
    try {
      ctrl.abort();
    } catch {
      /* đóng hẳn socket kể cả khi đã đứt sẵn */
    }
  }
  return ok;
}

async function loop(gen: number) {
  let retryMs = 1000;
  while (gen === generation) {
    const ok = await connect(gen);
    if (gen !== generation) break;
    retryMs = ok ? 1000 : Math.min(retryMs * 2, MAX_RETRY_MS);
    await new Promise((r) => setTimeout(r, retryMs));
  }
  if (gen === generation) running = false;   // vòng hiện hành kết thúc tự nhiên
}

function start() {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (running) return;
  running = true;
  generation += 1;
  loop(generation);
}

function stop() {
  generation += 1;          // báo vòng đang chạy thoát
  running = false;
  connected = false;
  activeController?.abort();
  activeController = null;
}

/**
 * Đăng ký nghe tin đổi dữ liệu. Trả về hàm hủy đăng ký.
 * Có người nghe đầu tiên thì mở kết nối; hết người nghe thì đóng sau vài giây.
 */
export function onLiveChange(fn: Listener): () => void {
  listeners.add(fn);
  start();
  return () => {
    listeners.delete(fn);
    if (listeners.size > 0) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (listeners.size === 0) stop();
    }, IDLE_CLOSE_MS);
  };
}

// Đóng kênh khi đăng xuất / đóng tab để không bỏ lại kết nối treo trên máy chủ.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", stop);
}
