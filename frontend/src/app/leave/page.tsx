"use client";

// Trang Nghỉ phép — mọi vai trò xin nghỉ & xem đơn của mình.
// Quản lý trở lên (isManagerUp) thấy thêm danh sách đơn chờ duyệt toàn công ty,
// duyệt/từ chối trực tiếp. Không có màn chặn quyền: ai cũng vào được.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDaysIcon, PaperAirplaneIcon, CheckIcon, XMarkIcon,
} from "@heroicons/react/24/outline";
import AppShell from "@/components/app-shell";
import { api } from "@/lib/api";
import { isManagerUp } from "@/lib/roles";
import { formatDate } from "@/lib/format";
import type { LeaveRequest, LeaveStatus, User } from "@/lib/types";

const STATUS_LABEL: Record<LeaveStatus, string> = {
  PENDING: "Chờ duyệt",
  APPROVED: "Đã duyệt",
  REJECTED: "Từ chối",
};
const STATUS_CLS: Record<LeaveStatus, string> = {
  PENDING: "bg-amber/15 text-amber-deep",
  APPROVED: "bg-ok/10 text-ok",
  REJECTED: "bg-bad/10 text-bad",
};

function StatusBadge({ s }: { s: LeaveStatus }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_CLS[s]}`}>
      {STATUS_LABEL[s]}
    </span>
  );
}

export default function LeavePage() {
  const router = useRouter();
  const [me, setMe] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const [mine, setMine] = useState<LeaveRequest[]>([]);
  const [pending, setPending] = useState<LeaveRequest[]>([]);

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [deciding, setDeciding] = useState<number | null>(null);

  useEffect(() => {
    api.me()
      .then((u) => {
        setMe(u);
        const tasks: Promise<unknown>[] = [
          api.myLeaves().then(setMine).catch(() => {}),
        ];
        if (isManagerUp(u.role)) {
          tasks.push(api.leaveList("PENDING").then(setPending).catch(() => {}));
        }
        Promise.all(tasks).finally(() => setLoading(false));
      })
      .catch(() => router.push("/login"));
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!fromDate || !toDate) return;
    setSaving(true);
    try {
      await api.createLeave({ from_date: fromDate, to_date: toDate, reason: reason || null });
      setFromDate(""); setToDate(""); setReason("");
      const list = await api.myLeaves();
      setMine(list);
    } catch { /* noop */ } finally { setSaving(false); }
  }

  async function decide(id: number, status: "APPROVED" | "REJECTED") {
    setDeciding(id);
    try {
      await api.decideLeave(id, status);
      const [p, m] = await Promise.all([
        api.leaveList("PENDING").catch(() => pending),
        api.myLeaves().catch(() => mine),
      ]);
      setPending(p); setMine(m);
    } catch { /* noop */ } finally { setDeciding(null); }
  }

  if (loading || !me) {
    return <div className="flex min-h-screen items-center justify-center bg-paper"><div className="h-8 w-8 animate-spin rounded-full border-4 border-steel border-t-amber" /></div>;
  }

  const canApprove = isManagerUp(me.role);

  return (
    <AppShell>
      <header className="flex items-center gap-2 rounded-xl2 bg-ink p-4 lg:p-6 text-white shadow-card">
        <CalendarDaysIcon className="h-5 w-5 text-amber" />
        <h1 className="text-base lg:text-xl font-bold">Nghỉ phép</h1>
      </header>

      {/* Form xin nghỉ */}
      <form onSubmit={submit} className="mt-4 rounded-xl2 border border-line bg-white p-4 shadow-card">
        <h2 className="text-sm font-bold text-ink">Gửi đơn xin nghỉ</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-[11px] font-semibold text-muted">Từ ngày *</label>
            <input type="date" required value={fromDate} onChange={(e) => setFromDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-muted">Đến ngày *</label>
            <input type="date" required value={toDate} onChange={(e) => setToDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel" />
          </div>
        </div>
        <div className="mt-3">
          <label className="block text-[11px] font-semibold text-muted">Lý do</label>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
            className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel"
            placeholder="Nêu lý do xin nghỉ…" />
        </div>
        <div className="mt-3 flex justify-end">
          <button type="submit" disabled={saving || !fromDate || !toDate}
            className="flex items-center gap-1.5 rounded-xl2 bg-ink px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50">
            <PaperAirplaneIcon className="h-4 w-4" /> {saving ? "Đang gửi…" : "Gửi đơn"}
          </button>
        </div>
      </form>

      {/* Đơn của tôi */}
      <h2 className="mt-6 mb-2 text-sm font-bold text-ink">Đơn của tôi</h2>
      <div className="overflow-x-auto rounded-xl2 border border-line bg-white shadow-card">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="bg-paper text-left text-[11px] uppercase tracking-wide text-muted">
              <th className="border border-line px-3 py-2">Từ ngày</th>
              <th className="border border-line px-3 py-2">Đến ngày</th>
              <th className="border border-line px-3 py-2 text-right">Số ngày</th>
              <th className="border border-line px-3 py-2">Lý do</th>
              <th className="border border-line px-3 py-2">Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {mine.length === 0 && (
              <tr><td colSpan={5} className="border border-line px-3 py-6 text-center text-muted">Chưa có đơn nghỉ nào.</td></tr>
            )}
            {mine.map((l) => (
              <tr key={l.id} className="odd:bg-white even:bg-paper/40 hover:bg-amber/10">
                <td className="border border-line px-3 py-2 whitespace-nowrap">{formatDate(l.from_date)}</td>
                <td className="border border-line px-3 py-2 whitespace-nowrap">{formatDate(l.to_date)}</td>
                <td className="border border-line px-3 py-2 text-right tnum">{l.days}</td>
                <td className="border border-line px-3 py-2 text-muted">{l.reason || "—"}</td>
                <td className="border border-line px-3 py-2"><StatusBadge s={l.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Đơn chờ duyệt toàn công ty — Quản lý trở lên */}
      {canApprove && (
        <>
          <h2 className="mt-6 mb-2 text-sm font-bold text-ink">Đơn chờ duyệt toàn công ty</h2>
          <div className="overflow-x-auto rounded-xl2 border border-line bg-white shadow-card">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="bg-paper text-left text-[11px] uppercase tracking-wide text-muted">
                  <th className="border border-line px-3 py-2">Nhân viên</th>
                  <th className="border border-line px-3 py-2">Từ ngày</th>
                  <th className="border border-line px-3 py-2">Đến ngày</th>
                  <th className="border border-line px-3 py-2 text-right">Số ngày</th>
                  <th className="border border-line px-3 py-2">Lý do</th>
                  <th className="border border-line px-3 py-2 text-center w-32">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {pending.length === 0 && (
                  <tr><td colSpan={6} className="border border-line px-3 py-6 text-center text-muted">Không có đơn nào chờ duyệt.</td></tr>
                )}
                {pending.map((l) => (
                  <tr key={l.id} className="odd:bg-white even:bg-paper/40 hover:bg-amber/10">
                    <td className="border border-line px-3 py-2 font-semibold text-ink">{l.user_name || "—"}</td>
                    <td className="border border-line px-3 py-2 whitespace-nowrap">{formatDate(l.from_date)}</td>
                    <td className="border border-line px-3 py-2 whitespace-nowrap">{formatDate(l.to_date)}</td>
                    <td className="border border-line px-3 py-2 text-right tnum">{l.days}</td>
                    <td className="border border-line px-3 py-2 text-muted">{l.reason || "—"}</td>
                    <td className="border border-line px-3 py-2">
                      <div className="flex items-center justify-center gap-2">
                        <button onClick={() => decide(l.id, "APPROVED")} disabled={deciding === l.id}
                          className="flex items-center gap-1 rounded-lg bg-ok/10 px-2 py-1 text-[11px] font-semibold text-ok disabled:opacity-50">
                          <CheckIcon className="h-3.5 w-3.5" /> Duyệt
                        </button>
                        <button onClick={() => decide(l.id, "REJECTED")} disabled={deciding === l.id}
                          className="flex items-center gap-1 rounded-lg bg-bad/10 px-2 py-1 text-[11px] font-semibold text-bad disabled:opacity-50">
                          <XMarkIcon className="h-3.5 w-3.5" /> Từ chối
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </AppShell>
  );
}
