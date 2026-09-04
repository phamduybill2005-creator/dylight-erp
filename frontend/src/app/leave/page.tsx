"use client";

// Trang Nghỉ phép — mọi vai trò xin nghỉ & xem đơn của mình.
// Quản lý trở lên (isManagerUp) thấy thêm danh sách đơn chờ duyệt toàn công ty,
// duyệt/từ chối trực tiếp. Không có màn chặn quyền: ai cũng vào được.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  CalendarDaysIcon, PaperAirplaneIcon, CheckIcon, XMarkIcon, TableCellsIcon,
} from "@heroicons/react/24/outline";
import AppShell from "@/components/app-shell";
import FilterBar, { NO_FILTERS, splitDepts, type Filters } from "@/components/filter-bar";
import { api } from "@/lib/api";
import { isManagerUp } from "@/lib/roles";
import { formatDate } from "@/lib/format";
import type { LeaveRequest, LeaveStatus, User } from "@/lib/types";

// Danh sách LÝ DO nghỉ phép cố định — người xin nghỉ chỉ được chọn 1 trong các mục này.
const LEAVE_REASONS = [
  "GIỖ TẾT", "HIẾU SỰ", "HỶ SỰ", "ỐM ĐAU", "NGỦ QUÊN", "TẮC ĐƯỜNG",
  "HỎNG XE", "SINH NHẬT", "THIÊN TAI", "BIA RƯỢU", "HỌC HÀNH", "YÊU ĐƯƠNG",
  "GIA ĐÌNH",
];

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
  const [me, setMe] = useState<User | null>(api.cachedUser());
  const [loading, setLoading] = useState(true);

  const [mine, setMine] = useState<LeaveRequest[]>([]);
  const [pending, setPending] = useState<LeaveRequest[]>([]);
  const [users, setUsers] = useState<User[]>([]);   // để ánh xạ nhân viên -> phòng ban khi lọc
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [leaveType, setLeaveType] = useState("FULL");
  const [leaveCategory, setLeaveCategory] = useState<"LEAVE" | "LATE">("LEAVE");
  const [lateSlot, setLateSlot] = useState<"MORNING" | "AFTERNOON">("MORNING");
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
          api.users().then(setUsers).catch(() => {});   // cho bộ lọc phòng ban
        }
        Promise.all(tasks).finally(() => setLoading(false));
      })
      .catch(() => router.push("/login"));
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!fromDate || !toDate || !reason) return;   // bắt buộc chọn 1 lý do
    setSaving(true);
    try {
      const finalType = leaveCategory === "LATE"
        ? (lateSlot === "AFTERNOON" ? "LATE_AFTERNOON" : "LATE_MORNING")
        : leaveType;
      await api.createLeave({ from_date: fromDate, to_date: toDate, leave_type: finalType, reason: reason || null });
      setFromDate(""); setToDate(""); setLeaveType("FULL"); setLeaveCategory("LEAVE"); setLateSlot("MORNING"); setReason("");
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
    return <AppShell><div className="flex min-h-[70vh] items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-steel border-t-amber" /></div></AppShell>;
  }

  const canApprove = isManagerUp(me.role);

  // Lọc đơn chờ duyệt theo PHÒNG BAN của người xin nghỉ (ánh xạ qua danh sách nhân sự).
  const deptOfUser = (uid: number) => users.find((u) => u.id === uid)?.department;
  const shownPending = pending.filter(
    (l) => !filters.dept || splitDepts(deptOfUser(l.user_id)).includes(filters.dept)
  );

  const formatDaysDisplay = (l: LeaveRequest) => {
    if (l.leave_type === "LATE_MORNING" || l.leave_type === "LATE") {
      return <span className="inline-flex items-center rounded-md bg-[#0284c7]/15 px-2 py-0.5 text-[11px] font-semibold text-[#0284c7] border border-[#0284c7]/30">Đi muộn sáng</span>;
    }
    if (l.leave_type === "LATE_AFTERNOON") {
      return <span className="inline-flex items-center rounded-md bg-[#0d9488]/15 px-2 py-0.5 text-[11px] font-semibold text-[#0d9488] border border-[#0d9488]/30">Đi muộn chiều</span>;
    }
    if (l.leave_type === "MORNING") return `${l.days} (Sáng)`;
    if (l.leave_type === "AFTERNOON") return `${l.days} (Chiều)`;
    return `${l.days} ngày`;
  };

  return (
    <AppShell>
      <header className="flex flex-col gap-3 rounded-xl2 bg-ink p-4 lg:p-6 text-white shadow-card sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <CalendarDaysIcon className="h-5 w-5 text-amber" />
          <h1 className="text-base lg:text-xl font-bold">Nghỉ phép</h1>
        </div>
        <Link
          href="/work-schedule"
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20"
        >
          <TableCellsIcon className="h-4 w-4 text-amber" />
          <span>Xem Lịch làm việc</span>
        </Link>
      </header>

      {/* Form xin nghỉ / báo đi muộn */}
      <form onSubmit={submit} className="mt-4 rounded-xl2 border border-line bg-white p-4 shadow-card">
        <h2 className="text-sm font-bold text-ink">Gửi đơn xin nghỉ</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <label className="block text-[11px] font-semibold text-muted">Từ ngày *</label>
            <input type="date" required value={fromDate} onChange={(e) => {
              setFromDate(e.target.value);
              if (!toDate) setToDate(e.target.value);
            }}
              className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-muted">Đến ngày *</label>
            <input type="date" required value={toDate} onChange={(e) => setToDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-muted">
              {leaveCategory === "LATE" ? "Buổi đi muộn *" : "Thời gian nghỉ *"}
            </label>
            {leaveCategory === "LATE" ? (
              <select value={lateSlot} onChange={(e) => setLateSlot(e.target.value as "MORNING" | "AFTERNOON")}
                className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel font-medium">
                <option value="MORNING">Đi muộn sáng (Xanh biển)</option>
                <option value="AFTERNOON">Đi muộn chiều (Xanh ngọc)</option>
              </select>
            ) : (
              <select value={leaveType} onChange={(e) => setLeaveType(e.target.value)}
                className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel font-medium">
                <option value="FULL">Cả ngày (Đỏ trầm)</option>
                <option value="MORNING">Buổi sáng (Vàng hổ phách)</option>
                <option value="AFTERNOON">Buổi chiều (Tím)</option>
              </select>
            )}
          </div>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-[11px] font-semibold text-muted">1. Lý do * <span className="font-normal text-muted/70">(chọn 1)</span></label>
            <select required value={reason} onChange={(e) => setReason(e.target.value)}
              className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel">
              <option value="">— Chọn lý do —</option>
              {LEAVE_REASONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-muted">2. Nghỉ phép *</label>
            <select value={leaveCategory} onChange={(e) => setLeaveCategory(e.target.value as "LEAVE" | "LATE")}
              className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel font-medium">
              <option value="LATE">Đi muộn</option>
              <option value="LEAVE">Nghỉ</option>
            </select>
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <button type="submit" disabled={saving || !fromDate || !toDate || !reason}
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
              <th className="border border-line px-3 py-2 text-right">Lịch làm / Số ngày</th>
              <th className="border border-line px-3 py-2">Lý do</th>
              <th className="border border-line px-3 py-2">Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {mine.length === 0 && (
              <tr><td colSpan={5} className="border border-line px-3 py-6 text-center text-muted">Chưa có đơn nào.</td></tr>
            )}
            {mine.map((l) => (
              <tr key={l.id} className="odd:bg-white even:bg-paper/40 hover:bg-amber/10">
                <td className="border border-line px-3 py-2 whitespace-nowrap">{formatDate(l.from_date)}</td>
                <td className="border border-line px-3 py-2 whitespace-nowrap">{formatDate(l.to_date)}</td>
                <td className="border border-line px-3 py-2 text-right tnum">{formatDaysDisplay(l)}</td>
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
          <div className="mb-3">
            <FilterBar show={{ dept: true }} value={filters} onChange={setFilters} />
          </div>
          <div className="overflow-x-auto rounded-xl2 border border-line bg-white shadow-card">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="bg-paper text-left text-[11px] uppercase tracking-wide text-muted">
                  <th className="border border-line px-3 py-2">Nhân viên</th>
                  <th className="border border-line px-3 py-2">Từ ngày</th>
                  <th className="border border-line px-3 py-2">Đến ngày</th>
                  <th className="border border-line px-3 py-2 text-right">Lịch làm / Số ngày</th>
                  <th className="border border-line px-3 py-2">Lý do</th>
                  <th className="border border-line px-3 py-2 text-center w-32">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {shownPending.length === 0 && (
                  <tr><td colSpan={6} className="border border-line px-3 py-6 text-center text-muted">
                    {pending.length === 0 ? "Không có đơn nào chờ duyệt." : "Không có đơn khớp bộ lọc."}
                  </td></tr>
                )}
                {shownPending.map((l) => (
                  <tr key={l.id} className="odd:bg-white even:bg-paper/40 hover:bg-amber/10">
                    <td className="border border-line px-3 py-2 font-semibold text-ink">{l.user_name || "—"}</td>
                    <td className="border border-line px-3 py-2 whitespace-nowrap">{formatDate(l.from_date)}</td>
                    <td className="border border-line px-3 py-2 whitespace-nowrap">{formatDate(l.to_date)}</td>
                    <td className="border border-line px-3 py-2 text-right tnum">{formatDaysDisplay(l)}</td>
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
