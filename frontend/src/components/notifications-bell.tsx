"use client";

// Nút lá thư nổi ở góc dưới — số tin chưa đọc + danh sách thông báo + ô soạn tin.
// Quyền gửi: Giám đốc → mọi người / các quản lý / nhân viên / 1 người;
//            Quản lý  → nhân viên / 1 người;  Nhân viên → chỉ nhận.

import { useCallback, useEffect, useState } from "react";
import { EnvelopeIcon, XMarkIcon, PaperAirplaneIcon } from "@heroicons/react/24/outline";
import { api } from "@/lib/api";
import { roleTier } from "@/lib/roles";
import { useNicknames } from "@/lib/nicknames";
import type { Notification, User } from "@/lib/types";

const TARGETS_DIRECTOR = [
  { value: "EVERYONE", label: "Tất cả mọi người" },
  { value: "MANAGERS", label: "Các quản lý" },
  { value: "STAFF", label: "Toàn bộ nhân viên" },
  { value: "USER", label: "Một người cụ thể" },
];
const TARGETS_MANAGER = [
  { value: "STAFF", label: "Toàn bộ nhân viên" },
  { value: "USER", label: "Một người cụ thể" },
];

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function NotificationsBell() {
  const [me, setMe] = useState<User | null>(null);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [compose, setCompose] = useState(false);

  const [target, setTarget] = useState("USER");
  const [targetUser, setTargetUser] = useState<number | "">("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [users, setUsers] = useState<User[]>([]);
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState("");

  const [lastNotificationIds, setLastNotificationIds] = useState<Set<number>>(new Set());

  const nick = useNicknames();
  const tier = me ? roleTier(me.role) : "STAFF";
  const canCompose = tier !== "STAFF";
  const targets = tier === "DIRECTOR" ? TARGETS_DIRECTOR : TARGETS_MANAGER;

  const showDesktopNotification = useCallback((titleStr: string, bodyStr: string) => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "granted") {
      new Notification(titleStr, { body: bodyStr });
    } else if (Notification.permission !== "denied") {
      Notification.requestPermission().then((permission) => {
        if (permission === "granted") {
          new Notification(titleStr, { body: bodyStr });
        }
      });
    }
  }, []);

  const refreshUnread = useCallback(() => {
    api.unreadCount().then((r) => setUnread(r.count)).catch(() => {});
  }, []);

  const refreshItems = useCallback(() => {
    api.notifications().then((newItems) => {
      setItems(newItems);
      setLastNotificationIds((prevIds) => {
        const nextIds = new Set(newItems.map((x) => x.id));
        if (prevIds.size > 0) {
          const newUnread = newItems.filter((x) => !x.is_read && !prevIds.has(x.id));
          if (newUnread.length > 0) {
            newUnread.forEach((n) => {
              showDesktopNotification(n.title, n.body || "");
            });
          }
        }
        return nextIds;
      });
    }).catch(() => {});
  }, [showDesktopNotification]);

  // Nạp thông tin người đăng nhập 1 lần khi mở app.
  useEffect(() => {
    api.me().then(setMe).catch(() => {});
    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission !== "granted" && Notification.permission !== "denied") {
        Notification.requestPermission();
      }
    }
  }, []);

  // Tự làm mới định kỳ (KHÔNG cần F5): số tin chưa đọc + danh sách thông báo cập nhật mỗi ~20s
  useEffect(() => {
    refreshUnread();
    refreshItems();
    const t = setInterval(() => {
      refreshUnread();
      refreshItems();
    }, 20000);
    return () => clearInterval(t);
  }, [refreshUnread, refreshItems]);

  async function openPanel() {
    setOpen(true);
    try {
      setItems(await api.notifications());
    } catch {
      /* noop */
    }
  }

  async function markRead(n: Notification) {
    if (n.is_read) return;
    try {
      await api.markNotificationRead(n.id);
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
      setUnread((u) => Math.max(0, u - 1));
    } catch {
      /* noop */
    }
  }

  async function markAll() {
    try {
      await api.markAllNotificationsRead();
      setItems((prev) => prev.map((x) => ({ ...x, is_read: true })));
      setUnread(0);
    } catch {
      /* noop */
    }
  }

  function openCompose() {
    setCompose(true);
    setSendMsg("");
    setTarget(tier === "DIRECTOR" ? "EVERYONE" : "STAFF");
    if (users.length === 0) api.users().then(setUsers).catch(() => {});
  }

  async function send() {
    if (!title.trim()) return;
    if (target === "USER" && !targetUser) {
      setSendMsg("Chưa chọn người nhận.");
      return;
    }
    setSending(true);
    setSendMsg("");
    try {
      const res = await api.sendNotification({
        title: title.trim(),
        body: body.trim() || null,
        target,
        target_user_id: target === "USER" ? Number(targetUser) : null,
      });
      setSendMsg(`Đã gửi tới ${res.sent} người.`);
      setTitle("");
      setBody("");
      setTargetUser("");
    } catch (e: unknown) {
      setSendMsg(e instanceof Error ? e.message : "Gửi thất bại.");
    } finally {
      setSending(false);
    }
  }

  if (!me) return null;

  return (
    <>
      <button
        onClick={openPanel}
        aria-label="Thông báo"
        className="fixed bottom-24 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-ink text-white shadow-fab lg:bottom-6 lg:right-6"
      >
        <EnvelopeIcon className="h-6 w-6" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-bad px-1 text-[10px] font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-ink/40 backdrop-blur-sm"
          onClick={() => { setOpen(false); setCompose(false); }}
        >
          <div
            className="flex h-full w-full max-w-md flex-col bg-paper shadow-2xl animate-slide-in"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between border-b border-line bg-white px-4 py-3">
              <div className="flex items-center gap-2">
                <EnvelopeIcon className="h-5 w-5 text-steel" />
                <h2 className="text-sm font-bold text-ink">Thông báo</h2>
              </div>
              <div className="flex items-center gap-3">
                {items.some((x) => !x.is_read) && (
                  <button onClick={markAll} className="text-[11px] font-semibold text-steel hover:text-ink">
                    Đọc tất cả
                  </button>
                )}
                <button
                  onClick={() => { setOpen(false); setCompose(false); }}
                  className="rounded-full p-1.5 text-muted hover:bg-paper hover:text-ink"
                >
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>
            </header>

            {canCompose && (
              <div className="border-b border-line bg-white px-4 py-2">
                {!compose ? (
                  <button
                    onClick={openCompose}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl2 bg-ink py-2 text-xs font-semibold text-white hover:bg-steel"
                  >
                    <PaperAirplaneIcon className="h-4 w-4" /> Soạn thông báo
                  </button>
                ) : (
                  <div className="space-y-2">
                    <select
                      value={target}
                      onChange={(e) => setTarget(e.target.value)}
                      className="w-full rounded-lg border border-line bg-paper px-2 py-1.5 text-xs outline-none focus:border-steel"
                    >
                      {targets.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                    {target === "USER" && (
                      <select
                        value={targetUser}
                        onChange={(e) => setTargetUser(e.target.value ? Number(e.target.value) : "")}
                        className="w-full rounded-lg border border-line bg-paper px-2 py-1.5 text-xs outline-none focus:border-steel"
                      >
                        <option value="">— Chọn người nhận —</option>
                        {users.filter((u) => u.id !== me.id).map((u) => (
                          <option key={u.id} value={u.id}>{u.full_name}</option>
                        ))}
                      </select>
                    )}
                    <input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Tiêu đề *"
                      className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
                    />
                    <textarea
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      rows={3}
                      placeholder="Nội dung"
                      className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
                    />
                    {sendMsg && <p className="text-[11px] font-medium text-ink">{sendMsg}</p>}
                    <div className="flex gap-2">
                      <button onClick={() => setCompose(false)} className="flex-1 rounded-xl2 border border-line py-2 text-xs font-semibold text-muted hover:bg-paper">
                        Đóng
                      </button>
                      <button
                        onClick={send}
                        disabled={sending || !title.trim()}
                        className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl2 bg-ink py-2 text-xs font-semibold text-white hover:bg-steel disabled:opacity-50"
                      >
                        {sending ? "Đang gửi…" : <><PaperAirplaneIcon className="h-4 w-4" /> Gửi</>}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex-1 space-y-2 overflow-y-auto p-3">
              {items.length === 0 ? (
                <p className="rounded-xl2 bg-white p-4 text-center text-xs text-muted shadow-card">Chưa có thông báo nào.</p>
              ) : (
                items.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => markRead(n)}
                    className={`block w-full rounded-xl2 border-l-4 bg-white p-3 text-left shadow-card ${n.is_read ? "border-transparent" : "border-amber"}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-sm text-ink ${n.is_read ? "font-medium" : "font-bold"}`}>{n.title}</p>
                      {!n.is_read && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-amber" />}
                    </div>
                    {n.body && <p className="mt-1 whitespace-pre-line text-xs text-muted">{n.body}</p>}
                    <p className="mt-1 text-[10px] text-muted">{nick(n.sender_id, n.sender_name) || "Hệ thống"} · {fmt(n.created_at)}</p>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
