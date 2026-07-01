"use client";

// Nút chat nổi cạnh chuông thông báo — nhắn tin 1-1 và nhóm trong cùng công ty.
// 2 khung nhìn: (1) danh sách phòng; (2) hội thoại (tin nhắn + ô soạn gửi).
// Tự làm mới định kỳ ~8s (KHÔNG WebSocket) — badge số tin chưa đọc + tin mới.
// Style bám design token giống notifications-bell.tsx.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChatBubbleLeftRightIcon,
  XMarkIcon,
  PaperAirplaneIcon,
  ArrowLeftIcon,
  UserGroupIcon,
  PlusIcon,
} from "@heroicons/react/24/outline";
import { api } from "@/lib/api";
import { useNicknames } from "@/lib/nicknames";
import type { Conversation, ChatMessage, Colleague, User } from "@/lib/types";

const POLL_MS = 8000;

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

// Nhãn phòng: DIRECT -> tên người kia; GROUP -> title (fallback ghép tên thành viên).
function convTitle(
  conv: Conversation,
  meId: number | undefined,
  nick: (id?: number | null, name?: string | null) => string,
): string {
  if (conv.type === "GROUP") {
    if (conv.title) return conv.title;
    const others = conv.members.filter((m) => m.user_id !== meId);
    return others.map((m) => nick(m.user_id, m.user_name)).join(", ") || "Nhóm";
  }
  const other = conv.members.find((m) => m.user_id !== meId);
  return other ? nick(other.user_id, other.user_name) || "Người dùng" : "Trò chuyện";
}

export default function ChatWidget() {
  const [me, setMe] = useState<User | null>(null);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  const [list, setList] = useState<Conversation[]>([]);
  const [active, setActive] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  // Tạo phòng mới: chọn 1 người (DIRECT) hoặc nhiều người + tên nhóm (GROUP).
  const [creating, setCreating] = useState(false);
  const [colleagues, setColleagues] = useState<Colleague[]>([]);
  const [groupMode, setGroupMode] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const [groupName, setGroupName] = useState("");
  const [createMsg, setCreateMsg] = useState("");

  const nick = useNicknames();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const activeId = active?.id ?? null;

  const refreshUnread = useCallback(() => {
    api.chatUnreadCount().then((r) => setUnread(r.count)).catch(() => {});
  }, []);

  const refreshList = useCallback(() => {
    api.chatConversations().then(setList).catch(() => {});
  }, []);

  const refreshMessages = useCallback((id: number) => {
    api.chatMessages(id).then(setMessages).catch(() => {});
  }, []);

  // Nạp người đăng nhập 1 lần.
  useEffect(() => {
    api.me().then(setMe).catch(() => {});
  }, []);

  // Cho phép các trang khác mở nhóm chat của 1 dự án qua sự kiện toàn cục
  // (vd nút "Chat dự án" ở trang chi tiết dự án). detail.projectId = id dự án.
  useEffect(() => {
    async function onOpenProject(e: Event) {
      const projectId = (e as CustomEvent<{ projectId: number }>).detail?.projectId;
      if (!projectId) return;
      setOpen(true);
      refreshList();
      try {
        const conv = await api.projectConversation(projectId);
        await openConversation(conv);
      } catch {
        /* noop — không mở được nhóm dự án (không thuộc dự án) */
      }
    }
    window.addEventListener("open-project-chat", onOpenProject as EventListener);
    return () => window.removeEventListener("open-project-chat", onOpenProject as EventListener);
    // openConversation/refreshList ổn định trong vòng đời component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tự làm mới định kỳ ~8s: badge; nếu mở panel làm mới danh sách; nếu đang trong 1
  // phòng thì làm mới cả tin nhắn phòng đó (poll-based, không WebSocket).
  useEffect(() => {
    refreshUnread();
    if (open) refreshList();
    if (open && activeId) refreshMessages(activeId);
    const t = setInterval(() => {
      refreshUnread();
      if (open) refreshList();
      if (open && activeId) refreshMessages(activeId);
    }, POLL_MS);
    return () => clearInterval(t);
  }, [open, activeId, refreshUnread, refreshList, refreshMessages]);

  // Tự cuộn xuống tin mới nhất khi danh sách tin đổi.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, activeId]);

  function openPanel() {
    setOpen(true);
    refreshList();
  }

  function closePanel() {
    setOpen(false);
    setActive(null);
    setCreating(false);
    resetCreate();
  }

  async function openConversation(conv: Conversation) {
    setActive(conv);
    setCreating(false);
    setMessages([]);
    try {
      setMessages(await api.chatMessages(conv.id));
      await api.markConversationRead(conv.id);
      // Cập nhật lạc quan: xóa badge chưa đọc của phòng vừa mở.
      setList((prev) => prev.map((c) => (c.id === conv.id ? { ...c, unread: 0 } : c)));
      refreshUnread();
    } catch {
      /* noop */
    }
  }

  async function send() {
    if (!active) return;
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    try {
      const msg = await api.sendChatMessage(active.id, body);
      setMessages((prev) => [...prev, msg]);
      setDraft("");
      refreshList();
    } catch {
      /* noop */
    } finally {
      setSending(false);
    }
  }

  function onDraftKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  function resetCreate() {
    setGroupMode(false);
    setPicked([]);
    setGroupName("");
    setCreateMsg("");
  }

  function openCreate() {
    setCreating(true);
    setActive(null);
    resetCreate();
    if (colleagues.length === 0) api.colleagues().then(setColleagues).catch(() => {});
  }

  function togglePick(id: number) {
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function startDirect(userId: number) {
    setCreateMsg("");
    try {
      const conv = await api.createConversation({ type: "DIRECT", member_ids: [userId] });
      setCreating(false);
      refreshList();
      await openConversation(conv);
    } catch (e: unknown) {
      setCreateMsg(e instanceof Error ? e.message : "Không tạo được cuộc trò chuyện.");
    }
  }

  async function createGroup() {
    if (!groupName.trim()) {
      setCreateMsg("Nhóm cần có tên.");
      return;
    }
    if (picked.length < 2) {
      setCreateMsg("Nhóm cần ít nhất 2 người (ngoài bạn).");
      return;
    }
    setCreateMsg("");
    try {
      const conv = await api.createConversation({
        type: "GROUP",
        member_ids: picked,
        title: groupName.trim(),
      });
      setCreating(false);
      refreshList();
      await openConversation(conv);
    } catch (e: unknown) {
      setCreateMsg(e instanceof Error ? e.message : "Không tạo được nhóm.");
    }
  }

  if (!me) return null;

  return (
    <>
      <button
        onClick={openPanel}
        aria-label="Tin nhắn"
        className="fixed bottom-40 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-steel text-white shadow-fab lg:bottom-24 lg:right-6"
      >
        <ChatBubbleLeftRightIcon className="h-6 w-6" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-bad px-1 text-[10px] font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-ink/40 backdrop-blur-sm"
          onClick={closePanel}
        >
          <div
            className="flex h-full w-full max-w-md flex-col bg-paper shadow-2xl animate-slide-in"
            onClick={(e) => e.stopPropagation()}
          >
            {/* ---------- Header (đổi theo khung nhìn) ---------- */}
            <header className="flex items-center justify-between border-b border-line bg-white px-4 py-3">
              <div className="flex items-center gap-2">
                {active || creating ? (
                  <button
                    onClick={() => { setActive(null); setCreating(false); }}
                    className="rounded-full p-1 text-steel hover:bg-paper hover:text-ink"
                    aria-label="Quay lại"
                  >
                    <ArrowLeftIcon className="h-5 w-5" />
                  </button>
                ) : (
                  <ChatBubbleLeftRightIcon className="h-5 w-5 text-steel" />
                )}
                <h2 className="text-sm font-bold text-ink">
                  {active
                    ? convTitle(active, me.id, nick)
                    : creating
                    ? "Tin nhắn mới"
                    : "Tin nhắn"}
                </h2>
                {active?.type === "GROUP" && (
                  <span className="rounded-full bg-paper px-2 py-0.5 text-[10px] text-muted">
                    {active.members.length} người
                  </span>
                )}
              </div>
              <button
                onClick={closePanel}
                className="rounded-full p-1.5 text-muted hover:bg-paper hover:text-ink"
                aria-label="Đóng"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </header>

            {/* ---------- KHUNG 1: danh sách phòng ---------- */}
            {!active && !creating && (
              <>
                <div className="border-b border-line bg-white px-4 py-2">
                  <button
                    onClick={openCreate}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl2 bg-ink py-2 text-xs font-semibold text-white hover:bg-steel"
                  >
                    <PlusIcon className="h-4 w-4" /> Tin nhắn mới
                  </button>
                </div>
                <div className="flex-1 space-y-2 overflow-y-auto p-3">
                  {list.length === 0 ? (
                    <p className="rounded-xl2 bg-white p-4 text-center text-xs text-muted shadow-card">
                      Chưa có cuộc trò chuyện nào.
                    </p>
                  ) : (
                    list.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => openConversation(c)}
                        className="block w-full rounded-xl2 bg-white p-3 text-left shadow-card hover:bg-white/70"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            {c.type === "GROUP" && <UserGroupIcon className="h-4 w-4 shrink-0 text-steel" />}
                            <p className={`truncate text-sm text-ink ${c.unread > 0 ? "font-bold" : "font-medium"}`}>
                              {convTitle(c, me.id, nick)}
                            </p>
                          </div>
                          {c.unread > 0 && (
                            <span className="flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-bad px-1 text-[10px] font-bold text-white">
                              {c.unread > 99 ? "99+" : c.unread}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <p className="truncate text-xs text-muted">{c.last_message || "Chưa có tin nhắn."}</p>
                          {c.last_message_at && (
                            <span className="shrink-0 text-[10px] text-muted">{fmt(c.last_message_at)}</span>
                          )}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </>
            )}

            {/* ---------- KHUNG 2: tạo phòng mới ---------- */}
            {creating && (
              <div className="flex flex-1 flex-col overflow-hidden">
                <div className="border-b border-line bg-white px-4 py-2">
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setGroupMode(false); setCreateMsg(""); }}
                      className={`flex-1 rounded-xl2 py-1.5 text-xs font-semibold ${
                        !groupMode ? "bg-ink text-white" : "border border-line text-muted hover:bg-paper"
                      }`}
                    >
                      1-1
                    </button>
                    <button
                      onClick={() => { setGroupMode(true); setCreateMsg(""); }}
                      className={`flex-1 rounded-xl2 py-1.5 text-xs font-semibold ${
                        groupMode ? "bg-ink text-white" : "border border-line text-muted hover:bg-paper"
                      }`}
                    >
                      Nhóm
                    </button>
                  </div>
                  {groupMode && (
                    <input
                      value={groupName}
                      onChange={(e) => setGroupName(e.target.value)}
                      placeholder="Tên nhóm *"
                      className="mt-2 w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
                    />
                  )}
                  {createMsg && <p className="mt-2 text-[11px] font-medium text-bad">{createMsg}</p>}
                </div>

                <div className="flex-1 space-y-1.5 overflow-y-auto p-3">
                  {colleagues.filter((c) => c.id !== me.id).length === 0 ? (
                    <p className="rounded-xl2 bg-white p-4 text-center text-xs text-muted shadow-card">
                      Không có đồng nghiệp nào.
                    </p>
                  ) : (
                    colleagues
                      .filter((c) => c.id !== me.id)
                      .map((c) => {
                        const label = nick(c.id, c.full_name);
                        if (groupMode) {
                          const on = picked.includes(c.id);
                          return (
                            <button
                              key={c.id}
                              onClick={() => togglePick(c.id)}
                              className={`flex w-full items-center justify-between rounded-xl2 border p-3 text-left text-sm shadow-card ${
                                on ? "border-steel bg-white font-semibold text-ink" : "border-transparent bg-white text-ink"
                              }`}
                            >
                              <span className="truncate">{label}</span>
                              <span
                                className={`ml-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                                  on ? "border-steel bg-steel text-white" : "border-line text-transparent"
                                }`}
                              >
                                ✓
                              </span>
                            </button>
                          );
                        }
                        return (
                          <button
                            key={c.id}
                            onClick={() => startDirect(c.id)}
                            className="block w-full rounded-xl2 bg-white p-3 text-left text-sm text-ink shadow-card hover:bg-white/70"
                          >
                            {label}
                          </button>
                        );
                      })
                  )}
                </div>

                {groupMode && (
                  <div className="border-t border-line bg-white px-4 py-2">
                    <button
                      onClick={createGroup}
                      disabled={!groupName.trim() || picked.length < 2}
                      className="flex w-full items-center justify-center gap-1.5 rounded-xl2 bg-ink py-2 text-xs font-semibold text-white hover:bg-steel disabled:opacity-50"
                    >
                      <UserGroupIcon className="h-4 w-4" /> Tạo nhóm ({picked.length})
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ---------- KHUNG 3: hội thoại ---------- */}
            {active && (
              <>
                <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-3">
                  {messages.length === 0 ? (
                    <p className="rounded-xl2 bg-white p-4 text-center text-xs text-muted shadow-card">
                      Chưa có tin nhắn. Hãy gửi lời chào.
                    </p>
                  ) : (
                    messages.map((m) => {
                      const mine = m.sender_id === me.id;
                      return (
                        <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[80%] ${mine ? "items-end" : "items-start"}`}>
                            {!mine && active.type === "GROUP" && (
                              <p className="mb-0.5 px-1 text-[10px] font-semibold text-steel">
                                {nick(m.sender_id, m.sender_name)}
                              </p>
                            )}
                            <div
                              className={`whitespace-pre-line break-words rounded-xl2 px-3 py-2 text-sm shadow-card ${
                                mine ? "bg-ink text-white" : "bg-white text-ink"
                              }`}
                            >
                              {m.body}
                            </div>
                            <p className={`mt-0.5 px-1 text-[10px] text-muted ${mine ? "text-right" : ""}`}>
                              {fmt(m.created_at)}
                            </p>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="border-t border-line bg-white px-3 py-2">
                  <div className="flex items-end gap-2">
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={onDraftKeyDown}
                      rows={1}
                      placeholder="Nhập tin nhắn…"
                      className="max-h-28 flex-1 resize-none rounded-xl2 border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-steel"
                    />
                    <button
                      onClick={send}
                      disabled={sending || !draft.trim()}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-white hover:bg-steel disabled:opacity-50"
                      aria-label="Gửi"
                    >
                      <PaperAirplaneIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
