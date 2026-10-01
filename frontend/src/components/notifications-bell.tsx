"use client";

// Nút lá thư nổi ở góc dưới — số tin chưa đọc + danh sách thông báo + ô soạn tin.
// Quyền gửi: Giám đốc → mọi người / các quản lý / nhân viên / phòng ban / 1 người;
//            Quản lý  → nhân viên / phòng ban / 1 người;  Nhân viên → chỉ nhận.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { EnvelopeIcon, XMarkIcon, PaperAirplaneIcon, TrashIcon } from "@heroicons/react/24/outline";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import { api } from "@/lib/api";
import { roleTier } from "@/lib/roles";
import { PRESET_DEPARTMENTS } from "@/lib/departments";
import { useNicknames } from "@/lib/nicknames";
import { useEscapeKey } from "@/lib/use-escape-key";
import { createUnreadNotificationTracker, createRefreshQueue, dispatchDesktopClick, DESKTOP_CLICK_EVENT, showDesktopNotification, type DesktopClick } from "@/lib/desktop-notifications";
import type { Department, Notification, User } from "@/lib/types";

const TARGETS_DIRECTOR = [
  { value: "EVERYONE", label: "Tất cả mọi người" },
  { value: "MANAGERS", label: "Các quản lý" },
  { value: "STAFF", label: "Toàn bộ nhân viên" },
  { value: "DEPARTMENT", label: "Theo phòng ban" },
  { value: "USER", label: "Một người cụ thể" },
];
const TARGETS_MANAGER = [
  { value: "STAFF", label: "Toàn bộ nhân viên" },
  { value: "DEPARTMENT", label: "Theo phòng ban" },
  { value: "USER", label: "Một người cụ thể" },
];

function getNotificationUrl(n: Notification): string | null {
  const text = `${n.title} ${n.body || ""}`.toLowerCase();
  if (
    text.includes("nghỉ phép") ||
    text.includes("xin nghỉ") ||
    text.includes("đi muộn") ||
    text.includes("đơn nghỉ") ||
    text.includes("duyệt đơn")
  ) {
    return "/leave";
  }
  if (text.includes("đánh giá")) {
    return "/evaluations";
  }
  if (text.includes("lịch làm việc")) {
    return "/work-schedule";
  }
  if (text.includes("chấm công")) {
    return "/attendance";
  }
  if (text.includes("giao việc") || text.includes("dự án")) {
    return "/projects";
  }
  return null;
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function NotificationsBell() {
  const router = useRouter();
  const [me, setMe] = useState<User | null>(null);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [compose, setCompose] = useState(false);

  const [target, setTarget] = useState("USER");
  const [targetUser, setTargetUser] = useState<number | "">("");
  const [targetDepartment, setTargetDepartment] = useState("");
  const [departments, setDepartments] = useState<Department[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [users, setUsers] = useState<User[]>([]);
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState("");

  const trackUnread = useRef(createUnreadNotificationTracker());

  const nick = useNicknames();
  const tier = me ? roleTier(me.role) : "STAFF";
  const canCompose = tier !== "STAFF";
  const targets = tier === "DIRECTOR" ? TARGETS_DIRECTOR : TARGETS_MANAGER;
  const departmentNames = departments.length ? departments.map((d) => d.name) : PRESET_DEPARTMENTS;

  // Đóng modal soạn thông báo hoặc khung danh sách thông báo khi nhấn phím ESC
  useEscapeKey(() => {
    if (compose) setCompose(false);
    else if (open) setOpen(false);
  }, Boolean(compose || open));

  const notifyDesktop = useCallback((n: Notification) => {
    showDesktopNotification(n.title, { body: n.body || "", tag: `dosco-notification-${n.id}` }, () => {
      dispatchDesktopClick({ kind: "notification", notification: n });
    });
  }, []);

  const refreshUnread = useCallback(() => {
    api.unreadCount().then((r) => setUnread(r.count)).catch(() => {});
  }, []);

  const refreshItems = useMemo(() => createRefreshQueue(async () => {
    const newItems = await api.notifications();
    setItems(newItems);
    trackUnread.current(newItems).forEach(notifyDesktop);
  }), [notifyDesktop]);

  useEffect(() => {
    const onDesktopClick = (event: Event) => {
      const detail = (event as CustomEvent<DesktopClick>).detail;
      if (detail?.kind !== "notification") return;
      handleNotificationClick(detail.notification);
      if (!getNotificationUrl(detail.notification)) setOpen(true);
    };
    window.addEventListener(DESKTOP_CLICK_EVENT, onDesktopClick);
    return () => window.removeEventListener(DESKTOP_CLICK_EVENT, onDesktopClick);
    // Chỉ router thay đổi giữa các trang; các setter React luôn ổn định.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // Nạp thông tin người đăng nhập 1 lần khi mở app.
  useEffect(() => {
    api.me().then(setMe).catch(() => {});
  }, []);

  // Nạp lần đầu, rồi để useAutoRefresh lo phần cập nhật: có thông báo mới là
  // máy chủ đẩy xuống ngay (kênh trực tiếp), chuông kêu tức thì.
  useEffect(() => {
    refreshUnread();
    refreshItems();
  }, [refreshUnread, refreshItems]);

  useAutoRefresh(() => {
    refreshUnread();
    refreshItems();
  }, { topics: ["notification"], background: true });

  async function openPanel() {
    setOpen(true);
    try {
      setItems(await api.notifications());
    } catch {
      /* noop */
    }
  }

  /** Xoá 1 thông báo khỏi chuông của mình (chỉ bản của mình, không ảnh hưởng người khác).
   *  Gỡ khỏi danh sách ngay cho mượt; lỗi thì nạp lại từ máy chủ. */
  async function removeNotification(n: Notification) {
    setItems((prev) => prev.filter((x) => x.id !== n.id));
    if (!n.is_read) setUnread((u) => Math.max(0, u - 1));
    try {
      await api.deleteNotification(n.id);
    } catch (err: any) {
      alert(err?.message || "Không xóa được thông báo.");
      api.notifications().then(setItems).catch(() => {});
      api.unreadCount().then((r) => setUnread(r.count)).catch(() => {});
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

  function handleNotificationClick(n: Notification) {
    void markRead(n);
    const targetUrl = getNotificationUrl(n);
    if (targetUrl) {
      setOpen(false);
      setCompose(false);
      router.push(targetUrl);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("focus"));
      }
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
    setTargetDepartment("");
    api.departments().then(setDepartments).catch(() => {});
    if (users.length === 0) api.users().then(setUsers).catch(() => {});
  }

  async function send() {
    if (!title.trim()) return;
    if (target === "USER" && !targetUser) {
      setSendMsg("Chưa chọn người nhận.");
      return;
    }
    if (target === "DEPARTMENT" && !targetDepartment) {
      setSendMsg("Chưa chọn phòng ban nhận thông báo.");
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
        target_department: target === "DEPARTMENT" ? targetDepartment : null,
      });
      setSendMsg(`Đã gửi tới ${res.sent} người.`);
      setTitle("");
      setBody("");
      setTargetUser("");
      setTargetDepartment("");
    } catch (e: unknown) {
      setSendMsg(e instanceof Error ? e.message : "Gửi thất bại.");
    } finally {
      setSending(false);
    }
  }

  if (!me) return null;

  return (
    <>
      {/* Nút mở: nằm trong thanh đầu trang. Điện thoại: giữ nguyên trên thanh (không nổi che dữ liệu).
          Máy tính (lg): tự thành nút NỔI góc dưới-phải như trước, dưới nút Tin nhắn. */}
      <button
        onClick={openPanel}
        aria-label="Thông báo"
        className="relative flex h-11 w-11 items-center justify-center rounded-full text-white/80 hover:bg-white/10 hover:text-white lg:fixed lg:bottom-6 lg:right-6 lg:z-40 lg:h-12 lg:w-12 lg:bg-ink lg:text-white lg:shadow-fab lg:hover:bg-ink/90 lg:hover:text-white"
      >
        <EnvelopeIcon className="h-5 w-5 lg:h-6 lg:w-6" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-bad px-1 text-[10px] font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {/* Panel đưa ra document.body (portal) để không kẹt trong lớp z-index của thanh đầu trang. */}
      {open && createPortal(
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
                    {target === "DEPARTMENT" && (
                      <select
                        aria-label="Phòng ban nhận thông báo"
                        value={targetDepartment}
                        onChange={(e) => setTargetDepartment(e.target.value)}
                        className="w-full rounded-lg border border-line bg-paper px-2 py-1.5 text-xs outline-none focus:border-steel"
                      >
                        <option value="">— Chọn phòng ban —</option>
                        {departmentNames.map((name) => (
                          <option key={name} value={name}>{name}</option>
                        ))}
                      </select>
                    )}
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
                items.map((n) => {
                  const targetUrl = getNotificationUrl(n);
                  return (
                    // Nút xoá đặt NGOÀI nút "đánh dấu đã đọc" (không lồng button trong button), neo góc phải.
                    <div key={n.id} className="group relative">
                      <button
                        onClick={() => handleNotificationClick(n)}
                        className={`block w-full rounded-xl2 border-l-4 bg-white p-3 pr-10 text-left shadow-card transition-colors hover:bg-slate-50 active:bg-slate-100 ${
                          n.is_read ? "border-transparent" : "border-amber"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className={`text-sm text-ink ${n.is_read ? "font-medium" : "font-bold"}`}>{n.title}</p>
                          {!n.is_read && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-amber" />}
                        </div>
                        {n.body && <p className="mt-1 whitespace-pre-line break-words [overflow-wrap:anywhere] text-xs text-muted">{n.body}</p>}
                        <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-muted">
                          <span>{nick(n.sender_id, n.sender_name) || "Hệ thống"} · {fmt(n.created_at)}</span>
                          {targetUrl && (
                            <span className="font-semibold text-steel/80 group-hover:text-amber transition-colors flex items-center gap-0.5">
                              {targetUrl === "/leave" ? "Xem đơn nghỉ phép" : "Xem chi tiết"} &rarr;
                            </span>
                          )}
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void removeNotification(n);
                        }}
                        title="Xóa thông báo này"
                        aria-label="Xóa thông báo"
                        className="absolute right-2 top-2 rounded-full p-1.5 text-slate-400 hover:bg-bad/10 hover:text-bad focus-visible:outline-steel"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
