"use client";

// Nút chat nổi cạnh chuông thông báo — nhắn tin 1-1 và nhóm trong cùng công ty.
// 3 khung nhìn: (1) danh sách phòng; (2) tạo phòng mới; (3) hội thoại (tin nhắn + ô soạn).
// Tự làm mới định kỳ ~8s (KHÔNG WebSocket) — badge số tin chưa đọc + tin mới.
// Sinh động như Zalo: avatar màu, bong bóng mềm, chèn emoji, thả cảm xúc, quản lý nhóm.
// Style bám design token giống notifications-bell.tsx.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChatBubbleLeftRightIcon,
  XMarkIcon,
  PaperAirplaneIcon,
  ArrowLeftIcon,
  UserGroupIcon,
  PlusIcon,
  FaceSmileIcon,
  Cog6ToothIcon,
  TrashIcon,
  ArrowRightOnRectangleIcon,
} from "@heroicons/react/24/outline";
import { api } from "@/lib/api";
import { useNicknames } from "@/lib/nicknames";
import type { Conversation, ChatMessage, Colleague, User } from "@/lib/types";

const POLL_MS = 8000;

// Thanh cảm xúc nhanh (giống Zalo) — ĐÚNG 6, đúng thứ tự.
const REACT_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "😡"];

// Bảng emoji để CHÈN vào ô soạn (mảng cứng, không dùng thư viện ngoài).
const PICKER_EMOJIS = [
  "😀", "😁", "😂", "🤣", "😊", "😍", "😅", "😘",
  "😎", "🤔", "😳", "😇", "😢", "😭", "😡", "😱",
  "🥳", "🤗", "😴", "🙄", "😬", "🤩", "😜", "🤝",
  "👍", "👎", "👏", "🙏", "💪", "🔥", "✨", "🎉",
  "✅", "❌", "❤️", "💔", "💯", "⭐", "☕", "🍺",
  "🚀", "📌", "📎", "💡", "⏰", "📞", "💰", "⚠️",
];

// Palette avatar cố định — hash id/tên -> chọn 1 lớp nền ổn định.
const AVATAR_BG = ["bg-steel", "bg-amber", "bg-ok", "bg-bad", "bg-ink"];

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function hashKey(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function avatarColor(id?: number | null, name?: string | null): string {
  const key = id != null ? String(id) : name || "?";
  return AVATAR_BG[hashKey(key) % AVATAR_BG.length];
}

function initials(name?: string | null): string {
  const s = (name || "").trim();
  if (!s) return "?";
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Vòng tròn avatar màu + initials. size = "sm" | "md" | "lg".
function Avatar({
  id,
  name,
  size = "md",
}: {
  id?: number | null;
  name?: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const cls =
    size === "sm" ? "h-6 w-6 text-[9px]" : size === "lg" ? "h-10 w-10 text-sm" : "h-9 w-9 text-xs";
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full font-bold text-white ${avatarColor(id, name)} ${cls}`}
    >
      {initials(name)}
    </span>
  );
}

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

// GROUP tự-do (không gắn dự án) mới cho sửa tên / thêm / xoá thành viên.
function isManageableGroup(conv: Conversation | null): boolean {
  return !!conv && conv.type === "GROUP" && (conv.project_id == null);
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

  // Bảng chèn emoji cho ô soạn.
  const [showEmoji, setShowEmoji] = useState(false);
  // id tin nhắn đang mở thanh cảm xúc (null = không mở).
  const [reactFor, setReactFor] = useState<number | null>(null);
  // Bật panel "Thông tin nhóm".
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [groupTitle, setGroupTitle] = useState("");
  const [addPicked, setAddPicked] = useState<number[]>([]);
  const [groupBusy, setGroupBusy] = useState(false);
  const [groupMsg, setGroupMsg] = useState("");

  // Tạo phòng mới: chọn 1 người (DIRECT) hoặc nhiều người + tên nhóm (GROUP).
  const [creating, setCreating] = useState(false);
  const [colleagues, setColleagues] = useState<Colleague[]>([]);
  const [groupMode, setGroupMode] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const [groupName, setGroupName] = useState("");
  const [createMsg, setCreateMsg] = useState("");

  const nick = useNicknames();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const draftRef = useRef<HTMLTextAreaElement | null>(null);
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

  // Đồng bộ 'active' mới nhất từ danh sách (sau thao tác nhóm poll cập nhật members/title).
  useEffect(() => {
    if (!activeId) return;
    const fresh = list.find((c) => c.id === activeId);
    if (fresh) setActive((prev) => (prev && prev.id === fresh.id ? fresh : prev));
  }, [list, activeId]);

  function openPanel() {
    setOpen(true);
    refreshList();
  }

  function closePanel() {
    setOpen(false);
    setActive(null);
    setCreating(false);
    resetCreate();
    closeConvExtras();
  }

  // Đóng mọi lớp phủ trong hội thoại (emoji picker, thanh react, panel nhóm).
  function closeConvExtras() {
    setShowEmoji(false);
    setReactFor(null);
    setShowGroupInfo(false);
    setGroupMsg("");
    setAddPicked([]);
  }

  async function openConversation(conv: Conversation) {
    setActive(conv);
    setCreating(false);
    setMessages([]);
    closeConvExtras();
    setGroupTitle(conv.title || "");
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
      setShowEmoji(false);
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

  // Chèn emoji tại vị trí con trỏ (fallback: cuối draft), giữ focus.
  function insertEmoji(emoji: string) {
    const el = draftRef.current;
    if (el) {
      const start = el.selectionStart ?? draft.length;
      const end = el.selectionEnd ?? draft.length;
      const next = draft.slice(0, start) + emoji + draft.slice(end);
      setDraft(next);
      requestAnimationFrame(() => {
        el.focus();
        const pos = start + emoji.length;
        el.setSelectionRange(pos, pos);
      });
    } else {
      setDraft((d) => d + emoji);
    }
  }

  // Cập nhật 1 tin tại chỗ bằng bản trả về (không refetch cả list).
  function patchMessage(msg: ChatMessage) {
    setMessages((prev) => prev.map((m) => (m.id === msg.id ? msg : m)));
  }

  // Thả / gỡ cảm xúc. Nếu emoji trùng cái mình đã thả -> toggle bỏ.
  async function toggleReaction(m: ChatMessage, emoji: string) {
    setReactFor(null);
    const mineSame = (m.reactions ?? []).some((r) => r.mine && r.emoji === emoji);
    try {
      const updated = mineSame
        ? await api.removeReaction(m.id)
        : await api.reactToMessage(m.id, emoji);
      patchMessage(updated);
    } catch {
      /* noop */
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

  // ----- Quản lý nhóm -----
  function openGroupInfo() {
    if (!active) return;
    setGroupTitle(active.title || "");
    setAddPicked([]);
    setGroupMsg("");
    setShowGroupInfo(true);
    if (colleagues.length === 0) api.colleagues().then(setColleagues).catch(() => {});
  }

  async function saveGroupTitle() {
    if (!active) return;
    const title = groupTitle.trim();
    if (!title || title === (active.title || "")) return;
    setGroupBusy(true);
    setGroupMsg("");
    try {
      const conv = await api.renameConversation(active.id, title);
      setActive(conv);
      refreshList();
      setGroupMsg("Đã đổi tên nhóm.");
    } catch (e: unknown) {
      setGroupMsg(e instanceof Error ? e.message : "Không đổi được tên nhóm.");
    } finally {
      setGroupBusy(false);
    }
  }

  async function addMembers() {
    if (!active || addPicked.length === 0) return;
    setGroupBusy(true);
    setGroupMsg("");
    try {
      const conv = await api.addConversationMembers(active.id, addPicked);
      setActive(conv);
      setAddPicked([]);
      refreshList();
      setGroupMsg("Đã thêm thành viên.");
    } catch (e: unknown) {
      setGroupMsg(e instanceof Error ? e.message : "Không thêm được thành viên.");
    } finally {
      setGroupBusy(false);
    }
  }

  async function removeMember(userId: number) {
    if (!active) return;
    setGroupBusy(true);
    setGroupMsg("");
    try {
      await api.removeConversationMember(active.id, userId);
      // Đồng bộ lại active từ server (endpoint trả 204).
      const all = await api.chatConversations();
      setList(all);
      const fresh = all.find((c) => c.id === active.id);
      if (fresh) setActive(fresh);
      setGroupMsg("Đã xoá thành viên.");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      setGroupMsg(msg || "Chỉ người tạo nhóm mới xoá được thành viên khác.");
    } finally {
      setGroupBusy(false);
    }
  }

  async function leaveGroup() {
    if (!active || !me) return;
    setGroupBusy(true);
    setGroupMsg("");
    try {
      await api.removeConversationMember(active.id, me.id);
      setActive(null);
      setShowGroupInfo(false);
      refreshList();
      refreshUnread();
    } catch (e: unknown) {
      setGroupMsg(e instanceof Error ? e.message : "Không rời được nhóm.");
    } finally {
      setGroupBusy(false);
    }
  }

  function toggleAddPick(id: number) {
    setAddPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  if (!me) return null;

  const manageable = isManageableGroup(active);

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
              <div className="flex min-w-0 items-center gap-2">
                {active || creating ? (
                  <button
                    onClick={() => { setActive(null); setCreating(false); closeConvExtras(); }}
                    className="rounded-full p-1 text-steel hover:bg-paper hover:text-ink"
                    aria-label="Quay lại"
                  >
                    <ArrowLeftIcon className="h-5 w-5" />
                  </button>
                ) : (
                  <ChatBubbleLeftRightIcon className="h-5 w-5 text-steel" />
                )}
                {active && (
                  active.type === "GROUP" ? (
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-steel text-white">
                      <UserGroupIcon className="h-5 w-5" />
                    </span>
                  ) : (
                    (() => {
                      const other = active.members.find((mm) => mm.user_id !== me.id);
                      return (
                        <Avatar
                          id={other?.user_id}
                          name={nick(other?.user_id, other?.user_name)}
                          size="md"
                        />
                      );
                    })()
                  )
                )}
                <h2 className="truncate text-sm font-bold text-ink">
                  {active
                    ? convTitle(active, me.id, nick)
                    : creating
                    ? "Tin nhắn mới"
                    : "Tin nhắn"}
                </h2>
                {active?.type === "GROUP" && (
                  <span className="shrink-0 rounded-full bg-paper px-2 py-0.5 text-[10px] text-muted">
                    {active.members.length} người
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {manageable && (
                  <button
                    onClick={() => (showGroupInfo ? setShowGroupInfo(false) : openGroupInfo())}
                    className={`rounded-full p-1.5 hover:bg-paper hover:text-ink ${
                      showGroupInfo ? "text-ink" : "text-muted"
                    }`}
                    aria-label="Thông tin nhóm"
                  >
                    <Cog6ToothIcon className="h-5 w-5" />
                  </button>
                )}
                <button
                  onClick={closePanel}
                  className="rounded-full p-1.5 text-muted hover:bg-paper hover:text-ink"
                  aria-label="Đóng"
                >
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>
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
                    list.map((c) => {
                      const other = c.members.find((mm) => mm.user_id !== me.id);
                      return (
                        <button
                          key={c.id}
                          onClick={() => openConversation(c)}
                          className="block w-full rounded-xl2 bg-white p-3 text-left shadow-card hover:bg-white/70"
                        >
                          <div className="flex items-start gap-3">
                            {c.type === "GROUP" ? (
                              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-steel text-white">
                                <UserGroupIcon className="h-5 w-5" />
                              </span>
                            ) : (
                              <Avatar
                                id={other?.user_id}
                                name={nick(other?.user_id, other?.user_name)}
                                size="md"
                              />
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-2">
                                <p className={`truncate text-sm text-ink ${c.unread > 0 ? "font-bold" : "font-medium"}`}>
                                  {convTitle(c, me.id, nick)}
                                </p>
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
                            </div>
                          </div>
                        </button>
                      );
                    })
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
                              className={`flex w-full items-center gap-3 rounded-xl2 border p-3 text-left text-sm shadow-card ${
                                on ? "border-steel bg-white font-semibold text-ink" : "border-transparent bg-white text-ink"
                              }`}
                            >
                              <Avatar id={c.id} name={label} size="sm" />
                              <span className="min-w-0 flex-1 truncate">{label}</span>
                              <span
                                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
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
                            className="flex w-full items-center gap-3 rounded-xl2 bg-white p-3 text-left text-sm text-ink shadow-card hover:bg-white/70"
                          >
                            <Avatar id={c.id} name={label} size="sm" />
                            <span className="min-w-0 flex-1 truncate">{label}</span>
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
            {active && !showGroupInfo && (
              <>
                <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-3">
                  {messages.length === 0 ? (
                    <p className="rounded-xl2 bg-white p-4 text-center text-xs text-muted shadow-card">
                      Chưa có tin nhắn. Hãy gửi lời chào.
                    </p>
                  ) : (
                    messages.map((m) => {
                      const mine = m.sender_id === me.id;
                      const reactions = m.reactions ?? [];
                      const senderLabel = nick(m.sender_id, m.sender_name);
                      return (
                        <div key={m.id} className={`group flex gap-2 ${mine ? "justify-end" : "justify-start"}`}>
                          {!mine && active.type === "GROUP" && (
                            <Avatar id={m.sender_id} name={senderLabel} size="sm" />
                          )}
                          <div className={`flex max-w-[80%] flex-col ${mine ? "items-end" : "items-start"}`}>
                            {!mine && active.type === "GROUP" && (
                              <p className="mb-0.5 px-1 text-[10px] font-semibold text-steel">
                                {senderLabel}
                              </p>
                            )}

                            {/* Bong bóng + nút react + thanh cảm xúc */}
                            <div className={`relative flex items-center gap-1 ${mine ? "flex-row-reverse" : "flex-row"}`}>
                              <div
                                className={`whitespace-pre-line break-words rounded-2xl px-3 py-2 text-sm shadow-card ${
                                  mine ? "bg-steel text-white" : "bg-white text-ink"
                                }`}
                              >
                                {m.body}
                              </div>

                              <button
                                onClick={() => setReactFor((cur) => (cur === m.id ? null : m.id))}
                                className="shrink-0 rounded-full p-1 text-muted opacity-40 hover:bg-paper hover:text-steel group-hover:opacity-100"
                                aria-label="Thả cảm xúc"
                              >
                                <FaceSmileIcon className="h-4 w-4" />
                              </button>

                              {reactFor === m.id && (
                                <div
                                  className={`absolute z-10 flex gap-0.5 rounded-full border border-line bg-white px-1.5 py-1 shadow-card ${
                                    mine ? "right-0 bottom-full mb-1" : "left-0 bottom-full mb-1"
                                  }`}
                                >
                                  {REACT_EMOJIS.map((emo) => (
                                    <button
                                      key={emo}
                                      onClick={() => toggleReaction(m, emo)}
                                      className="rounded-full px-1 text-lg leading-none transition-transform hover:scale-125"
                                    >
                                      {emo}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Pill cảm xúc đã thả */}
                            {reactions.length > 0 && (
                              <div className={`mt-0.5 flex flex-wrap gap-1 ${mine ? "justify-end" : "justify-start"}`}>
                                {reactions.map((r) => (
                                  <button
                                    key={r.emoji}
                                    onClick={() => toggleReaction(m, r.emoji)}
                                    className={`flex items-center gap-0.5 rounded-full border bg-white px-1.5 py-0.5 text-[11px] leading-none shadow-card ${
                                      r.mine ? "border-steel ring-1 ring-steel" : "border-line"
                                    }`}
                                  >
                                    <span>{r.emoji}</span>
                                    {r.count > 1 && <span className="text-muted">{r.count}</span>}
                                  </button>
                                ))}
                              </div>
                            )}

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
                  {showEmoji && (
                    <div className="mb-2 grid max-h-40 grid-cols-8 gap-1 overflow-y-auto rounded-xl2 border border-line bg-paper p-2">
                      {PICKER_EMOJIS.map((emo) => (
                        <button
                          key={emo}
                          onClick={() => insertEmoji(emo)}
                          className="rounded-lg p-1 text-lg leading-none hover:bg-white"
                        >
                          {emo}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex items-end gap-2">
                    <button
                      onClick={() => setShowEmoji((v) => !v)}
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-paper ${
                        showEmoji ? "text-steel" : "text-muted hover:text-steel"
                      }`}
                      aria-label="Chọn biểu tượng cảm xúc"
                    >
                      <FaceSmileIcon className="h-5 w-5" />
                    </button>
                    <textarea
                      ref={draftRef}
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

            {/* ---------- KHUNG 3b: Thông tin nhóm ---------- */}
            {active && showGroupInfo && manageable && (
              <div className="flex flex-1 flex-col overflow-y-auto p-3">
                {groupMsg && (
                  <p className="mb-2 rounded-xl2 bg-white px-3 py-2 text-[11px] font-medium text-steel shadow-card">
                    {groupMsg}
                  </p>
                )}

                {/* Đổi tên nhóm */}
                <div className="rounded-xl2 bg-white p-3 shadow-card">
                  <p className="mb-1.5 text-[11px] font-semibold text-muted">Tên nhóm</p>
                  <div className="flex gap-2">
                    <input
                      value={groupTitle}
                      onChange={(e) => setGroupTitle(e.target.value)}
                      placeholder="Tên nhóm"
                      maxLength={255}
                      className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
                    />
                    <button
                      onClick={saveGroupTitle}
                      disabled={groupBusy || !groupTitle.trim() || groupTitle.trim() === (active.title || "")}
                      className="shrink-0 rounded-lg bg-ink px-3 py-2 text-xs font-semibold text-white hover:bg-steel disabled:opacity-50"
                    >
                      Lưu
                    </button>
                  </div>
                </div>

                {/* Thành viên */}
                <div className="mt-3 rounded-xl2 bg-white p-3 shadow-card">
                  <p className="mb-2 text-[11px] font-semibold text-muted">
                    Thành viên ({active.members.length})
                  </p>
                  <div className="space-y-1.5">
                    {active.members.map((mm) => {
                      const label = nick(mm.user_id, mm.user_name);
                      const isMe = mm.user_id === me.id;
                      return (
                        <div key={mm.user_id} className="flex items-center gap-2">
                          <Avatar id={mm.user_id} name={label} size="sm" />
                          <span className="min-w-0 flex-1 truncate text-sm text-ink">
                            {label}
                            {isMe && <span className="ml-1 text-[10px] text-muted">(bạn)</span>}
                          </span>
                          {!isMe && (
                            <button
                              onClick={() => removeMember(mm.user_id)}
                              disabled={groupBusy}
                              className="shrink-0 rounded-full p-1 text-muted hover:bg-paper hover:text-bad disabled:opacity-50"
                              aria-label="Xoá thành viên"
                            >
                              <TrashIcon className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Thêm thành viên */}
                {(() => {
                  const memberIds = new Set(active.members.map((mm) => mm.user_id));
                  const candidates = colleagues.filter((c) => c.id !== me.id && !memberIds.has(c.id));
                  return (
                    <div className="mt-3 rounded-xl2 bg-white p-3 shadow-card">
                      <p className="mb-2 text-[11px] font-semibold text-muted">Thêm thành viên</p>
                      {candidates.length === 0 ? (
                        <p className="text-xs text-muted">Không còn ai để thêm.</p>
                      ) : (
                        <>
                          <div className="max-h-40 space-y-1.5 overflow-y-auto">
                            {candidates.map((c) => {
                              const label = nick(c.id, c.full_name);
                              const on = addPicked.includes(c.id);
                              return (
                                <button
                                  key={c.id}
                                  onClick={() => toggleAddPick(c.id)}
                                  className={`flex w-full items-center gap-2 rounded-lg border p-2 text-left text-sm ${
                                    on ? "border-steel bg-paper font-semibold text-ink" : "border-line bg-white text-ink"
                                  }`}
                                >
                                  <Avatar id={c.id} name={label} size="sm" />
                                  <span className="min-w-0 flex-1 truncate">{label}</span>
                                  <span
                                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                                      on ? "border-steel bg-steel text-white" : "border-line text-transparent"
                                    }`}
                                  >
                                    ✓
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                          <button
                            onClick={addMembers}
                            disabled={groupBusy || addPicked.length === 0}
                            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl2 bg-ink py-2 text-xs font-semibold text-white hover:bg-steel disabled:opacity-50"
                          >
                            <PlusIcon className="h-4 w-4" /> Thêm ({addPicked.length})
                          </button>
                        </>
                      )}
                    </div>
                  );
                })()}

                {/* Rời nhóm */}
                <button
                  onClick={leaveGroup}
                  disabled={groupBusy}
                  className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl2 border border-bad py-2 text-xs font-semibold text-bad hover:bg-bad hover:text-white disabled:opacity-50"
                >
                  <ArrowRightOnRectangleIcon className="h-4 w-4" /> Rời nhóm
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
