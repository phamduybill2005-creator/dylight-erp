"use client";

// Trang Đồng nghiệp — danh bạ nội bộ:
//  - Mọi người: đặt BIỆT DANH riêng cho từng người (chỉ mình thấy).
//  - Quản lý/Giám đốc: thêm/bớt người vào TEAM của mình.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  UserGroupIcon,
  PencilSquareIcon,
  CheckIcon,
  XMarkIcon,
  UserPlusIcon,
  UserMinusIcon,
} from "@heroicons/react/24/outline";
import AppShell from "@/components/app-shell";
import { api } from "@/lib/api";
import { roleTitle } from "@/lib/roles";
import { refreshNicknames } from "@/lib/nicknames";
import type { Colleague, User } from "@/lib/types";

export default function ColleaguesPage() {
  const router = useRouter();
  const [me, setMe] = useState<User | null>(null);
  const [list, setList] = useState<Colleague[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.me().then(setMe).catch(() => router.push("/login"));
    api.colleagues().then(setList).catch(() => {}).finally(() => setLoading(false));
  }, [router]);

  const canTeam = me ? ["ADMIN", "DIRECTOR", "MANAGER"].includes(me.role) : false;

  function startEdit(c: Colleague) {
    setEditId(c.id);
    setDraft(c.my_nickname || "");
  }

  async function saveNick(c: Colleague) {
    setBusyId(c.id);
    try {
      const updated = await api.setNickname(c.id, draft.trim() || null);
      setList((xs) => xs.map((x) => (x.id === updated.id ? updated : x)));
      setEditId(null);
      refreshNicknames(); // các trang khác lấy biệt danh mới ở lần mở sau
    } catch {
      /* noop */
    } finally {
      setBusyId(null);
    }
  }

  async function toggleTeam(c: Colleague) {
    setBusyId(c.id);
    setErr("");
    try {
      const updated = c.in_my_team ? await api.removeFromTeam(c.id) : await api.addToTeam(c.id);
      setList((xs) => xs.map((x) => (x.id === updated.id ? updated : x)));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Không thực hiện được.");
    } finally {
      setBusyId(null);
    }
  }

  const filtered = list.filter(
    (c) =>
      c.full_name.toLowerCase().includes(q.toLowerCase()) ||
      (c.my_nickname || "").toLowerCase().includes(q.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-steel border-t-amber" />
      </div>
    );
  }

  return (
    <AppShell>
      <div className="space-y-4">
        <header className="flex items-center gap-2 rounded-xl2 bg-ink p-4 lg:p-6 text-white shadow-card">
          <UserGroupIcon className="h-5 w-5 text-amber" />
          <h1 className="text-base lg:text-xl font-bold">Đồng nghiệp</h1>
        </header>

        <p className="rounded-xl2 border border-line bg-white p-3 text-[11px] text-muted shadow-card">
          Đặt <b className="text-ink">biệt danh riêng</b> cho từng người — chỉ MÌNH bạn thấy.
          {canTeam && <> Là quản lý, bạn còn có thể <b className="text-ink">thêm người vào team</b> của mình.</>}
        </p>
        {err && <p className="text-xs font-medium text-bad">{err}</p>}

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tìm theo tên hoặc biệt danh…"
          className="w-full rounded-xl2 border border-line bg-white px-4 py-3 text-sm outline-none focus:border-steel"
        />

        <div className="space-y-2 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0">
          {filtered.length === 0 ? (
            <p className="rounded-xl2 bg-white p-4 text-center text-xs text-muted shadow-card lg:col-span-2">
              Không có đồng nghiệp nào.
            </p>
          ) : (
            filtered.map((c) => (
              <div key={c.id} className="rounded-xl2 bg-white p-4 shadow-card">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-steel/10 text-sm font-bold text-steel">
                      {(c.my_nickname || c.full_name).charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">
                        {c.my_nickname ? (
                          <>
                            {c.my_nickname} <span className="font-normal text-muted">({c.full_name})</span>
                          </>
                        ) : (
                          c.full_name
                        )}
                      </p>
                      <p className="truncate text-[11px] text-muted">
                        {roleTitle(c.role, c.has_subordinates)}
                        {c.department ? ` · ${c.department}` : ""}
                      </p>
                    </div>
                  </div>
                  {c.in_my_team && (
                    <span className="shrink-0 rounded-full bg-ok/10 px-2 py-0.5 text-[9px] font-semibold text-ok">Team tôi</span>
                  )}
                </div>

                {editId === c.id ? (
                  <div className="mt-3 flex items-center gap-2">
                    <input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && saveNick(c)}
                      placeholder="Nhập biệt danh (để trống = xóa)"
                      className="flex-1 rounded-lg border border-line bg-paper px-3 py-1.5 text-xs outline-none focus:border-steel"
                    />
                    <button onClick={() => saveNick(c)} disabled={busyId === c.id} className="rounded-lg bg-ink p-1.5 text-white disabled:opacity-50">
                      <CheckIcon className="h-4 w-4" />
                    </button>
                    <button onClick={() => setEditId(null)} className="rounded-lg border border-line p-1.5 text-muted">
                      <XMarkIcon className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => startEdit(c)}
                      className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[11px] font-semibold text-steel hover:bg-paper"
                    >
                      <PencilSquareIcon className="h-3.5 w-3.5" /> {c.my_nickname ? "Sửa biệt danh" : "Đặt biệt danh"}
                    </button>
                    {canTeam && c.role !== "ADMIN" && c.role !== "DIRECTOR" && (
                      <button
                        onClick={() => toggleTeam(c)}
                        disabled={busyId === c.id}
                        className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-50 ${
                          c.in_my_team ? "border border-line text-bad hover:bg-bad/5" : "bg-steel text-white hover:bg-ink"
                        }`}
                      >
                        {c.in_my_team ? (
                          <>
                            <UserMinusIcon className="h-3.5 w-3.5" /> Rời team
                          </>
                        ) : (
                          <>
                            <UserPlusIcon className="h-3.5 w-3.5" /> Vào team tôi
                          </>
                        )}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </AppShell>
  );
}
