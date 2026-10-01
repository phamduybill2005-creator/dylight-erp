import type { Notification as AppNotification } from "./types";
import type { DeadlineAlertEntry } from "./deadline-alert";

export type DesktopPermission = NotificationPermission | "unsupported";
export const DESKTOP_CLICK_EVENT = "dosco-desktop-click";
export type DesktopClick =
  | { kind: "notification"; notification: AppNotification }
  | { kind: "chat"; conversationId: number }
  | { kind: "deadline"; entries: DeadlineAlertEntry[] };

/** Chuyển cú bấm tới widget của trang hiện tại, kể cả đã đổi trang từ lúc nhận tin. */
export function dispatchDesktopClick(detail: DesktopClick): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(DESKTOP_CLICK_EVENT, { detail }));
}

/** Gộp cập nhật đến trong lúc tải thành một lượt tiếp theo, không bỏ mất sự kiện mới. */
export function createRefreshQueue(run: () => Promise<void>): () => void {
  let running = false;
  let pending = false;
  return () => {
    if (running) { pending = true; return; }
    running = true;
    void (async () => {
      do {
        pending = false;
        try { await run(); } catch { /* Lượt cập nhật sau sẽ thử lại. */ }
      } while (pending);
      running = false;
    })();
  };
}

export function desktopPermission(): DesktopPermission {
  if (typeof window === "undefined" || !("Notification" in window) || window.isSecureContext === false) {
    return "unsupported";
  }
  return window.Notification.permission;
}

/** Chỉ gọi từ nút bấm của người dùng, không xin quyền khi nhận tin ở nền. */
export async function requestDesktopPermission(): Promise<DesktopPermission> {
  const permission = desktopPermission();
  if (permission !== "default") return permission;
  try {
    return await window.Notification.requestPermission();
  } catch {
    return desktopPermission();
  }
}

export function showDesktopNotification(
  title: string, options: NotificationOptions = {}, onClick?: () => void,
): boolean {
  if (desktopPermission() !== "granted") return false;
  try {
    const notification = new window.Notification(title, {
      icon: "/logo.png", badge: "/logo.png", ...options,
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
      onClick?.();
    };
    return true;
  } catch {
    return false;
  }
}

/** Lần nạp đầu làm mốc; chỉ báo tin mới, kể cả khi hộp thư ban đầu trống. */
export function createUnreadNotificationTracker() {
  let initialized = false;
  const seen = new Set<number>();
  return <T extends { id: number; is_read: boolean }>(items: T[]): T[] => {
    const fresh = initialized ? items.filter((n) => !n.is_read && !seen.has(n.id)) : [];
    items.forEach((n) => seen.add(n.id));
    initialized = true;
    return fresh;
  };
}

type ChatState = { id: number; unread: number; last_message_at?: string | null; last_message?: string | null };

export function createChatNotificationTracker() {
  let initialized = false;
  const seen = new Map<number, { unread: number; lastMessageAt?: string | null }>();
  return <T extends ChatState>(rooms: T[], activeId: number | null, visible: boolean): T[] => {
    const fresh = initialized ? rooms.filter((room) => {
      const previous = seen.get(room.id);
      const changed = !previous || room.unread > previous.unread || room.last_message_at !== previous.lastMessageAt;
      return room.unread > 0 && !!room.last_message && changed && !(visible && room.id === activeId);
    }) : [];
    rooms.forEach((room) => seen.set(room.id, { unread: room.unread, lastMessageAt: room.last_message_at }));
    initialized = true;
    return fresh;
  };
}
