"use client";

// Trang Nghỉ phép — mọi vai trò xin nghỉ & xem đơn của mình.
// Quản lý trở lên (isManagerUp) thấy thêm danh sách đơn chờ duyệt toàn công ty,
// duyệt/từ chối trực tiếp. Không có màn chặn quyền: ai cũng vào được.

import { useEffect, useState, useCallback, useMemo } from "react";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import { useStickyState } from "@/lib/use-sticky-state";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  CalendarDaysIcon, PaperAirplaneIcon, CheckIcon, XMarkIcon, TableCellsIcon,
  ChevronLeftIcon, ChevronRightIcon, MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";
import AppShell from "@/components/app-shell";
import FilterBar, { NO_FILTERS, splitDepts, type Filters } from "@/components/filter-bar";
import { api } from "@/lib/api";
import { isManagerUp, isDirector } from "@/lib/roles";
import { formatDate, todayLocal } from "@/lib/format";
import type { LeaveRequest, LeaveStatus, User } from "@/lib/types";

// Danh sách LÝ DO nghỉ phép cố định — người xin nghỉ chỉ được chọn 1 trong các mục này.
// LƯU Ý: "ĐI HỌC" phải viết HOA — bên dưới có bộ lọc ẩn các đơn tự sinh từ
// lịch sinh viên có lý do bắt đầu bằng "Đi học" (viết thường). Đổi về "Đi học"
// là đơn người dùng gửi sẽ biến mất khỏi danh sách.
const LEAVE_REASONS = [
  "GIỖ TẾT", "HIẾU SỰ", "HỶ SỰ", "ỐM ĐAU", "NGỦ QUÊN", "TẮC ĐƯỜNG",
  "HỎNG XE", "SINH NHẬT", "THIÊN TAI", "BIA RƯỢU", "ĐI HỌC", "YÊU ĐƯƠNG",
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

function mondayOf(d: string): string {
  const dt = new Date(`${d}T00:00:00`);
  const day = dt.getDay();
  const diff = dt.getDate() - day + (day === 0 ? -6 : 1);
  dt.setDate(diff);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function addDays(d: string, n: number): string {
  const dt = new Date(`${d}T00:00:00`);
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function prevMonth(m: string): string {
  const [y, mon] = m.split("-").map(Number);
  const d = new Date(y, mon - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function nextMonth(m: string): string {
  const [y, mon] = m.split("-").map(Number);
  const d = new Date(y, mon, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function LeavePage() {
  const router = useRouter();
  const [me, setMe] = useState<User | null>(api.cachedUser());
  const [loading, setLoading] = useState(true);

  const [mine, setMine] = useState<LeaveRequest[]>([]);
  const [pending, setPending] = useState<LeaveRequest[]>([]);
  const [approvedByMe, setApprovedByMe] = useState<LeaveRequest[]>([]);   // đơn CHÍNH TÔI đã duyệt
  const [users, setUsers] = useState<User[]>([]);   // để ánh xạ nhân viên -> phòng ban khi lọc
  const [filters, setFilters] = useStickyState<Filters>("leave.filters", NO_FILTERS);

  // --- Quản lý xem tất cả đơn đã duyệt: theo Tuần hoặc Tháng ---
  const [approvedViewMode, setApprovedViewMode] = useStickyState<"week" | "month">("leave.approvedViewMode", "week");
  const [approvedWeekStart, setApprovedWeekStart] = useStickyState("leave.approvedWeekStart", mondayOf(todayLocal()));
  const [approvedMonthStr, setApprovedMonthStr] = useStickyState("leave.approvedMonth", todayLocal().slice(0, 7)); // YYYY-MM
  const [allApproved, setAllApproved] = useState<LeaveRequest[]>([]);
  const [loadingApproved, setLoadingApproved] = useState(false);

  // Bộ lọc cho mục tất cả đơn đã duyệt
  const [approvedSearch, setApprovedSearch] = useState("");
  const [approvedDept, setApprovedDept] = useState("");
  const [approvedScope, setApprovedScope] = useState<"all" | "mine">("all");

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [leaveType, setLeaveType] = useState("FULL");
  const [leaveCategory, setLeaveCategory] = useState<"LEAVE" | "LATE">("LEAVE");
  const [lateSlot, setLateSlot] = useState<"MORNING" | "AFTERNOON">("MORNING");
  const [reason, setReason] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);   // lỗi backend trả về (VD quá hạn 19h)
  const [saving, setSaving] = useState(false);
  const [deciding, setDeciding] = useState<number | null>(null);
  const [requestFormOpen, setRequestFormOpen] = useState(false);

  const loadApprovedLeaves = useCallback((quiet = false) => {
    if (!me || !isDirector(me.role)) return;
    // quiet = làm mới nền (tự động 20s): KHÔNG bật spinner, tránh nháy màn hình.
    if (!quiet) setLoadingApproved(true);
    const safeStart = approvedWeekStart && typeof approvedWeekStart === "string" && approvedWeekStart.includes("-")
      ? approvedWeekStart
      : mondayOf(todayLocal());
    const safeMonth = approvedMonthStr && typeof approvedMonthStr === "string" && approvedMonthStr.includes("-")
      ? approvedMonthStr
      : todayLocal().slice(0, 7);
    const params = approvedViewMode === "week"
      ? { from_date: safeStart, to_date: addDays(safeStart, 6) }
      : { month: safeMonth };
    api.approvedLeaves(params)
      .then((data) => setAllApproved(Array.isArray(data) ? data : []))
      .catch(() => setAllApproved([]))
      .finally(() => { if (!quiet) setLoadingApproved(false); });
  }, [me, approvedViewMode, approvedWeekStart, approvedMonthStr]);

  useEffect(() => {
    if (me && isDirector(me.role)) {
      loadApprovedLeaves();
    }
  }, [me, loadApprovedLeaves]);

  // Danh sách phòng ban duy nhất để lọc (phải đặt trước mọi lệnh return để tuân thủ Hook Rules của React)
  const distinctDepts = useMemo(() => {
    const set = new Set<string>();
    (users || []).forEach((u) => {
      splitDepts(u.department).forEach((d) => d && set.add(d));
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "vi"));
  }, [users]);

  useEffect(() => {
    api.me()
      .then((u) => {
        setMe(u);
        const tasks: Promise<unknown>[] = [
          api.myLeaves().then(setMine).catch(() => {}),
          api.users().then(setUsers).catch(() => {}),   // cho bộ lọc phòng ban
        ];
        if (isManagerUp(u.role)) {
          tasks.push(api.leaveList("PENDING").then(setPending).catch(() => {}));
          tasks.push(api.leavesDecidedByMe().then(setApprovedByMe).catch(() => {}));
        }
        Promise.all(tasks).finally(() => setLoading(false));
      })
      .catch(() => router.push("/login"));
  }, [router]);

  // TỰ LÀM MỚI — không phải F5 nữa. Sếp duyệt ở máy khác thì trạng thái đơn của
  // mình tự đổi sang "Đã duyệt"; có đơn mới thì bảng chờ duyệt tự hiện thêm.
  // Chỉ nạp lại DANH SÁCH, không đụng form đang gõ dở.
  useAutoRefresh(() => {
    if (!me) return;
    api.myLeaves().then(setMine).catch(() => {});
    if (isManagerUp(me.role)) {
      api.leaveList("PENDING").then(setPending).catch(() => {});
      api.leavesDecidedByMe().then(setApprovedByMe).catch(() => {});
    }
    loadApprovedLeaves(true);
  }, { enabled: !!me, topics: ["leave"] });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!fromDate || !toDate || !reason) return;   // bắt buộc chọn 1 lý do
    setSaving(true);
    setSubmitError(null);
    try {
      const finalType = leaveCategory === "LATE"
        ? (lateSlot === "AFTERNOON" ? "LATE_AFTERNOON" : "LATE_MORNING")
        : leaveType;
      await api.createLeave({ from_date: fromDate, to_date: toDate, leave_type: finalType, reason: reason || null });
      setFromDate(""); setToDate(""); setLeaveType("FULL"); setLeaveCategory("LEAVE"); setLateSlot("MORNING"); setReason("");
      setRequestFormOpen(false);
      const list = await api.myLeaves();
      setMine(list);
    } catch (err) {
      // Trước đây nuốt lỗi -> backend từ chối (VD quá hạn 19h) mà người gửi
      // không biết gì. Nay hiện đúng thông điệp backend trả về.
      setSubmitError(err instanceof Error ? err.message : "Gửi đơn thất bại, thử lại giúp mình.");
    } finally { setSaving(false); }
  }

  async function decide(id: number, status: "APPROVED" | "REJECTED") {
    setDeciding(id);
    try {
      await api.decideLeave(id, status);
      const [p, m, a] = await Promise.all([
        api.leaveList("PENDING").catch(() => pending),
        api.myLeaves().catch(() => mine),
        api.leavesDecidedByMe().catch(() => approvedByMe),   // vừa duyệt -> hiện ngay bên dưới
      ]);
      setPending(p); setMine(m); setApprovedByMe(a);
      loadApprovedLeaves();
    } catch { /* noop */ } finally { setDeciding(null); }
  }

  if (loading || !me) {
    return <AppShell><div className="flex min-h-[70vh] items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-steel border-t-amber" /></div></AppShell>;
  }

  // Quyền DUYỆT phải khớp backend: require_roles(MANAGER, DIRECTOR)
  // + ADMIN. KHÔNG gồm MANAGER_MID — trước đây dùng isManagerUp nên quản lý cấp
  // trung vẫn thấy nút Duyệt, bấm vào là backend trả 403.
  const canApprove =
    me.role === "ADMIN" || me.role === "DIRECTOR" ||
    me.role === "MANAGER";

  // Lọc đơn chờ duyệt theo PHÒNG BAN của người xin nghỉ (ánh xạ qua danh sách nhân sự).
  const deptOfUser = (uid: number) => (users || []).find((u) => u.id === uid)?.department;
  const shownPending = (pending || []).filter(
    (l) => (!filters.dept || splitDepts(deptOfUser(l.user_id)).includes(filters.dept)) &&
      l.source !== "SCHEDULE" && !l.reason?.startsWith("Đi học")
  );

  // Chỉ hiển thị đơn được tạo và gửi trong mục Nghỉ phép (loại bỏ đơn đăng ký lịch làm việc theo tuần của sinh viên)
  const shownMine = (mine || []).filter(
    (l) => l.source !== "SCHEDULE" && !l.reason?.startsWith("Đi học")
  );

  // Danh sách tất cả đơn đã duyệt sau khi lọc
  const safeWeekStart = approvedWeekStart && typeof approvedWeekStart === "string" && approvedWeekStart.includes("-")
    ? approvedWeekStart
    : mondayOf(todayLocal());
  const approvedWeekEnd = addDays(safeWeekStart, 6);
  const safeMonthStr = approvedMonthStr && typeof approvedMonthStr === "string" && approvedMonthStr.includes("-")
    ? approvedMonthStr
    : todayLocal().slice(0, 7);

  const shownApproved = (allApproved || []).filter((l) => {
    if (!l) return false;
    if (l.source === "SCHEDULE" || l.reason?.startsWith("Đi học")) return false;
    if (approvedScope === "mine" && l.decided_by_id !== me?.id) return false;
    const userDept = deptOfUser(l.user_id);
    if (approvedDept && !splitDepts(userDept).includes(approvedDept)) return false;
    if (approvedSearch && approvedSearch.trim()) {
      const q = approvedSearch.trim().toLowerCase();
      const matchName = (l.user_name || "").toLowerCase().includes(q);
      const matchReason = (l.reason || "").toLowerCase().includes(q);
      const matchApprover = (l.decided_by_name || "").toLowerCase().includes(q);
      if (!matchName && !matchReason && !matchApprover) return false;
    }
    return true;
  });

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

      <button type="button" onClick={() => setRequestFormOpen((open) => !open)} className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-steel px-4 text-sm font-bold text-white shadow-card lg:hidden" aria-expanded={requestFormOpen}>
        <PaperAirplaneIcon className="h-4 w-4" /> {requestFormOpen ? "Đóng biểu mẫu" : "Tạo đơn mới"}
      </button>

      {/* Form xin nghỉ / báo đi muộn */}
      <form onSubmit={submit} className={`${requestFormOpen ? "block" : "hidden"} mt-3 rounded-xl2 border border-line bg-white p-4 shadow-card lg:mt-4 lg:block`}>
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
                <option value="MORNING">Đi muộn sáng</option>
                <option value="AFTERNOON">Đi muộn chiều</option>
              </select>
            ) : (
              <select value={leaveType} onChange={(e) => setLeaveType(e.target.value)}
                className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel font-medium">
                <option value="FULL">Cả ngày</option>
                <option value="MORNING">Buổi sáng</option>
                <option value="AFTERNOON">Buổi chiều</option>
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
        {submitError && (
          <p className="mt-3 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-[11px] font-semibold text-bad">
            {submitError}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-muted">
            ⏰ Đơn phải gửi <b className="text-ink">trước 19h ngày hôm trước</b> ngày nghỉ — gửi sau
            sẽ không được xét duyệt.
          </p>
          <button type="submit" disabled={saving || !fromDate || !toDate || !reason}
            className="flex items-center gap-1.5 rounded-xl2 bg-ink px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50">
            <PaperAirplaneIcon className="h-4 w-4" /> {saving ? "Đang gửi…" : "Gửi đơn"}
          </button>
        </div>
      </form>

      {/* Đơn của tôi */}
      <h2 className="mt-6 mb-2 text-sm font-bold text-ink">Đơn của tôi</h2>
      <div className="space-y-2 lg:hidden">
        {shownMine.length === 0 ? <p className="rounded-xl border border-line bg-white p-4 text-center text-sm text-muted">Chưa có đơn nào.</p> : shownMine.map((leave) => {
          const approverName = leave.decided_by_name || (leave.decided_by_id ? users.find((u) => u.id === leave.decided_by_id)?.full_name : null);
          return (
            <article key={leave.id} className="rounded-xl border border-line bg-white p-3 shadow-card">
              <div className="flex items-start justify-between gap-2">
                <div><p className="text-sm font-bold text-ink">{formatDate(leave.from_date)} → {formatDate(leave.to_date)}</p><div className="mt-1 text-xs text-steel">{formatDaysDisplay(leave)}</div></div>
                <StatusBadge s={leave.status} />
              </div>
              <p className="mt-3 text-sm text-slate-700">{leave.reason || "Không ghi lý do"}</p>
              <p className="mt-2 text-[11px] text-muted">{approverName ? `Người duyệt: ${approverName}` : leave.status === "PENDING" ? "Đang chờ duyệt" : "Chưa có thông tin người duyệt"}</p>
            </article>
          );
        })}
      </div>
      <div className="hidden overflow-x-auto rounded-xl2 border border-line bg-white shadow-card lg:block">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="bg-paper text-left text-[11px] uppercase tracking-wide text-muted">
              <th className="border border-line px-3 py-2">Từ ngày</th>
              <th className="border border-line px-3 py-2">Đến ngày</th>
              <th className="border border-line px-3 py-2 text-right">Lịch làm / Số ngày</th>
              <th className="border border-line px-3 py-2">Lý do</th>
              <th className="border border-line px-3 py-2 text-center">Trạng thái</th>
              <th className="border border-line px-3 py-2">Người duyệt</th>
            </tr>
          </thead>
          <tbody>
            {shownMine.length === 0 && (
              <tr><td colSpan={6} className="border border-line px-3 py-6 text-center text-muted">Chưa có đơn nào.</td></tr>
            )}
            {shownMine.map((l) => {
              const approverName = l.decided_by_name || (l.decided_by_id ? users.find((u) => u.id === l.decided_by_id)?.full_name : null);
              return (
                <tr key={l.id} className="odd:bg-white even:bg-paper/40 hover:bg-amber/10">
                  <td className="border border-line px-3 py-2 whitespace-nowrap">{formatDate(l.from_date)}</td>
                  <td className="border border-line px-3 py-2 whitespace-nowrap">{formatDate(l.to_date)}</td>
                  <td className="border border-line px-3 py-2 text-right tnum">{formatDaysDisplay(l)}</td>
                  <td className="border border-line px-3 py-2 text-muted">{l.reason || "—"}</td>
                  <td className="border border-line px-3 py-2 text-center"><StatusBadge s={l.status} /></td>
                  <td className="border border-line px-3 py-2">
                    {l.status === "APPROVED" ? (
                      approverName ? (
                        <span className="font-semibold text-slate-800 text-xs">{approverName}</span>
                      ) : (
                        <span className="text-xs text-muted italic">Đã duyệt</span>
                      )
                    ) : l.status === "REJECTED" ? (
                      approverName ? (
                        <span className="text-xs text-rose-600 font-semibold">{approverName} (Từ chối)</span>
                      ) : (
                        <span className="text-xs text-rose-500 italic">Từ chối</span>
                      )
                    ) : (
                      <span className="text-xs text-muted italic">Đang chờ duyệt</span>
                    )}
                  </td>
                </tr>
              );
            })}
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
          <div className="space-y-2 lg:hidden">
            {shownPending.length === 0 ? <p className="rounded-xl border border-line bg-white p-4 text-center text-sm text-muted">{pending.length === 0 ? "Không có đơn nào chờ duyệt." : "Không có đơn khớp bộ lọc."}</p> : shownPending.map((leave) => (
              <article key={leave.id} className="rounded-xl border border-line bg-white p-3 shadow-card">
                <div className="flex items-start justify-between gap-2"><div><p className="text-sm font-bold text-ink">{leave.user_name || "—"}</p><p className="mt-1 text-xs text-muted">{formatDate(leave.from_date)} → {formatDate(leave.to_date)}</p></div><div className="text-xs font-semibold text-steel">{formatDaysDisplay(leave)}</div></div>
                <p className="mt-3 text-sm text-slate-700">{leave.reason || "Không ghi lý do"}</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button onClick={() => decide(leave.id, "APPROVED")} disabled={deciding === leave.id} className="min-h-11 rounded-lg bg-ok/10 px-3 text-xs font-bold text-ok disabled:opacity-50">Duyệt</button>
                  <button onClick={() => decide(leave.id, "REJECTED")} disabled={deciding === leave.id} className="min-h-11 rounded-lg bg-bad/10 px-3 text-xs font-bold text-bad disabled:opacity-50">Từ chối</button>
                </div>
              </article>
            ))}
          </div>
          <div className="hidden overflow-x-auto rounded-xl2 border border-line bg-white shadow-card lg:block">
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

      {/* ========================================================================= */}
      {/* TẤT CẢ CÁC ĐƠN ĐÃ DUYỆT (CHỈ HIỂN THỊ CHO GIÁM ĐỐC / ADMIN)              */}
      {/* ========================================================================= */}
      {isDirector(me.role) && (
        <section className="mt-8 rounded-xl2 border border-line bg-white p-4 shadow-card lg:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-sm">
              <CheckIcon className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm lg:text-base font-bold text-ink">Tất cả các đơn đã duyệt</h2>
                <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 border border-emerald-200/60">
                  {shownApproved.length} đơn
                </span>
              </div>
              <p className="text-[11px] text-muted">
                {approvedViewMode === "week"
                  ? `Tuần từ ${formatDate(safeWeekStart)} đến ${formatDate(approvedWeekEnd)}`
                  : `Tháng ${safeMonthStr.slice(5, 7)}/${safeMonthStr.slice(0, 4)}`}
              </p>
            </div>
          </div>

          {/* Nút chuyển chế độ xem: Theo tuần / Theo tháng */}
          <div className="inline-flex items-center rounded-xl bg-slate-100 p-1 text-xs font-semibold shadow-inner self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setApprovedViewMode("week")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-all duration-150 ${
                approvedViewMode === "week"
                  ? "bg-white text-ink shadow-sm font-bold"
                  : "text-slate-500 hover:text-ink"
              }`}
            >
              <CalendarDaysIcon className="h-3.5 w-3.5 text-steel" />
              Theo tuần
            </button>
            <button
              type="button"
              onClick={() => setApprovedViewMode("month")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-all duration-150 ${
                approvedViewMode === "month"
                  ? "bg-white text-ink shadow-sm font-bold"
                  : "text-slate-500 hover:text-ink"
              }`}
            >
              <TableCellsIcon className="h-3.5 w-3.5 text-steel" />
              Theo tháng
            </button>
          </div>
        </div>

        {/* Thanh điều hướng thời gian và bộ lọc */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2.5 rounded-xl bg-slate-50/80 border border-slate-200/70 p-2.5">
          {approvedViewMode === "week" ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setApprovedWeekStart(addDays(safeWeekStart, -7))}
                className="flex items-center gap-1 rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition shadow-sm"
                title="Tuần trước"
              >
                <ChevronLeftIcon className="h-4 w-4 text-slate-500" />
                <span className="hidden sm:inline">Tuần trước</span>
              </button>
              <span className="rounded-lg bg-white border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-800 shadow-sm">
                Tuần {formatDate(safeWeekStart)} – {formatDate(approvedWeekEnd)}
              </span>
              <button
                type="button"
                onClick={() => setApprovedWeekStart(addDays(safeWeekStart, 7))}
                className="flex items-center gap-1 rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition shadow-sm"
                title="Tuần sau"
              >
                <span className="hidden sm:inline">Tuần sau</span>
                <ChevronRightIcon className="h-4 w-4 text-slate-500" />
              </button>
              <button
                type="button"
                onClick={() => setApprovedWeekStart(mondayOf(todayLocal()))}
                className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs font-semibold text-steel hover:bg-slate-50 transition shadow-sm"
              >
                Tuần này
              </button>
              <input
                type="date"
                value={safeWeekStart}
                onChange={(e) => e.target.value && setApprovedWeekStart(mondayOf(e.target.value))}
                className="rounded-lg border border-line bg-white px-2 py-1 text-xs text-slate-700 outline-none focus:border-steel shadow-sm"
                title="Chọn ngày để nhảy đến tuần đó"
              />
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setApprovedMonthStr(prevMonth(safeMonthStr))}
                className="flex items-center gap-1 rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition shadow-sm"
                title="Tháng trước"
              >
                <ChevronLeftIcon className="h-4 w-4 text-slate-500" />
                <span className="hidden sm:inline">Tháng trước</span>
              </button>
              <span className="rounded-lg bg-white border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-800 shadow-sm">
                Tháng {safeMonthStr.slice(5, 7)} / {safeMonthStr.slice(0, 4)}
              </span>
              <button
                type="button"
                onClick={() => setApprovedMonthStr(nextMonth(safeMonthStr))}
                className="flex items-center gap-1 rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition shadow-sm"
                title="Tháng sau"
              >
                <span className="hidden sm:inline">Tháng sau</span>
                <ChevronRightIcon className="h-4 w-4 text-slate-500" />
              </button>
              <button
                type="button"
                onClick={() => setApprovedMonthStr(todayLocal().slice(0, 7))}
                className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs font-semibold text-steel hover:bg-slate-50 transition shadow-sm"
              >
                Tháng này
              </button>
              <input
                type="month"
                value={safeMonthStr}
                onChange={(e) => e.target.value && setApprovedMonthStr(e.target.value)}
                className="rounded-lg border border-line bg-white px-2 py-1 text-xs text-slate-700 outline-none focus:border-steel shadow-sm"
                title="Chọn tháng"
              />
            </div>
          )}

          {/* Bộ lọc phòng ban & tìm kiếm */}
          <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
            <div className="relative flex-1 sm:w-56">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Tìm tên, lý do, người duyệt..."
                value={approvedSearch}
                onChange={(e) => setApprovedSearch(e.target.value)}
                className="w-full rounded-lg border border-line bg-white pl-8 pr-3 py-1.5 text-xs outline-none focus:border-steel shadow-sm placeholder:text-slate-400"
              />
            </div>
            {distinctDepts.length > 0 && (
              <select
                value={approvedDept}
                onChange={(e) => setApprovedDept(e.target.value)}
                className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs outline-none focus:border-steel font-medium text-slate-700 shadow-sm"
              >
                <option value="">Tất cả phòng ban</option>
                {distinctDepts.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            )}
            {canApprove && (
              <select
                value={approvedScope}
                onChange={(e) => setApprovedScope(e.target.value as "all" | "mine")}
                className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs outline-none focus:border-steel font-medium text-slate-700 shadow-sm"
              >
                <option value="all">Tất cả người duyệt</option>
                <option value="mine">Chính tôi duyệt</option>
              </select>
            )}
          </div>
        </div>

        {/* Nội dung danh sách đơn đã duyệt */}
        {loadingApproved ? (
          <div className="flex min-h-[160px] items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-steel border-t-amber" />
          </div>
        ) : shownApproved.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-8 text-center">
            <CalendarDaysIcon className="mx-auto h-8 w-8 text-slate-400" />
            <p className="mt-2 text-sm font-semibold text-slate-700">
              {allApproved.length === 0
                ? (approvedViewMode === "week"
                    ? `Không có đơn nghỉ phép nào đã duyệt trong tuần ${formatDate(safeWeekStart)} – ${formatDate(approvedWeekEnd)}.`
                    : `Không có đơn nghỉ phép nào đã duyệt trong tháng ${safeMonthStr.slice(5, 7)}/${safeMonthStr.slice(0, 4)}.`)
                : "Không tìm thấy đơn nghỉ phép nào khớp với bộ lọc."}
            </p>
            <p className="mt-1 text-xs text-muted">
              {allApproved.length === 0
                ? "Dùng các nút điều hướng hoặc chọn tuần/tháng khác để xem lịch sử."
                : "Thử xóa ô tìm kiếm hoặc chọn lại phòng ban."}
            </p>
          </div>
        ) : (
          <>
            {/* Mobile View: Cards */}
            <div className="mt-3 space-y-2 lg:hidden">
              {shownApproved.map((leave) => {
                const userDept = deptOfUser(leave.user_id);
                const approverName = leave.decided_by_name || (leave.decided_by_id ? users.find((u) => u.id === leave.decided_by_id)?.full_name : null);
                return (
                  <article key={leave.id} className="rounded-xl border border-line bg-white p-3.5 shadow-sm transition hover:shadow-md">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-bold text-ink">{leave.user_name || "—"}</p>
                          {userDept && (
                            <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                              {userDept}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-muted">
                          {formatDate(leave.from_date)} → {formatDate(leave.to_date)}
                        </p>
                      </div>
                      <div className="text-right">
                        <StatusBadge s={leave.status} />
                        <div className="mt-1 text-xs font-semibold text-steel">
                          {formatDaysDisplay(leave)}
                        </div>
                      </div>
                    </div>
                    {leave.reason && (
                      <p className="mt-2.5 rounded-md bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700">
                        <b className="font-semibold text-slate-900">Lý do:</b> {leave.reason}
                      </p>
                    )}
                    <div className="mt-2.5 flex items-center justify-between border-t border-line/60 pt-2 text-[11px] text-muted">
                      <span>Người duyệt: <b className="font-semibold text-slate-700">{approverName || "Đã duyệt"}</b></span>
                      <span>{leave.decided_at ? formatDate(leave.decided_at) : "—"}</span>
                    </div>
                  </article>
                );
              })}
            </div>

            {/* Desktop View: Table */}
            <div className="mt-4 hidden overflow-x-auto rounded-xl border border-line bg-white shadow-sm lg:block">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50/80 text-left text-[11px] uppercase tracking-wide text-slate-600 font-semibold border-b border-line">
                    <th className="px-3.5 py-2.5">Nhân viên</th>
                    <th className="px-3.5 py-2.5">Phòng ban</th>
                    <th className="px-3.5 py-2.5">Từ ngày</th>
                    <th className="px-3.5 py-2.5">Đến ngày</th>
                    <th className="px-3.5 py-2.5 text-right">Lịch làm / Ca nghỉ</th>
                    <th className="px-3.5 py-2.5">Lý do</th>
                    <th className="px-3.5 py-2.5">Người duyệt</th>
                    <th className="px-3.5 py-2.5">Thời gian duyệt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {shownApproved.map((l) => {
                    const userDept = deptOfUser(l.user_id);
                    const approverName = l.decided_by_name || (l.decided_by_id ? users.find((u) => u.id === l.decided_by_id)?.full_name : null);
                    return (
                      <tr key={l.id} className="text-xs transition-colors hover:bg-slate-50/70">
                        <td className="px-3.5 py-2.5 font-bold text-ink whitespace-nowrap">
                          {l.user_name || "—"}
                        </td>
                        <td className="px-3.5 py-2.5 text-slate-600 whitespace-nowrap">
                          {userDept ? (
                            <span className="inline-block rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                              {userDept}
                            </span>
                          ) : "—"}
                        </td>
                        <td className="px-3.5 py-2.5 text-slate-700 whitespace-nowrap font-medium">{formatDate(l.from_date)}</td>
                        <td className="px-3.5 py-2.5 text-slate-700 whitespace-nowrap font-medium">{formatDate(l.to_date)}</td>
                        <td className="px-3.5 py-2.5 text-right whitespace-nowrap font-semibold text-slate-800">
                          {formatDaysDisplay(l)}
                        </td>
                        <td className="px-3.5 py-2.5 text-slate-700 max-w-xs truncate">
                          {l.reason ? (
                            <span className="inline-block rounded bg-amber/10 px-2 py-0.5 text-[11px] font-semibold text-amber-deep">
                              {l.reason}
                            </span>
                          ) : "—"}
                        </td>
                        <td className="px-3.5 py-2.5 whitespace-nowrap">
                          {approverName ? (
                            <span className="font-semibold text-slate-800 text-xs">{approverName}</span>
                          ) : (
                            <span className="text-xs text-muted italic">Đã duyệt</span>
                          )}
                        </td>
                        <td className="px-3.5 py-2.5 text-muted whitespace-nowrap">
                          {l.decided_at ? formatDate(l.decided_at) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
        </section>
      )}

      {/* Đơn CHÍNH TÔI đã duyệt — chỉ hiện với người có quyền duyệt */}
      {canApprove && (
        <>
          <h2 className="mt-8 mb-2 text-sm font-bold text-ink">
            Đơn tôi đã duyệt{" "}
            <span className="font-normal text-muted">({approvedByMe.length})</span>
          </h2>
          <div className="space-y-2 lg:hidden">
            {approvedByMe.length === 0 ? <p className="rounded-xl border border-line bg-white p-4 text-center text-sm text-muted">Bạn chưa duyệt đơn nào.</p> : approvedByMe.map((leave) => (
              <article key={leave.id} className="rounded-xl border border-line bg-white p-3 shadow-card">
                <div className="flex items-start justify-between gap-2"><div><p className="text-sm font-bold text-ink">{leave.user_name || "—"}</p><p className="mt-1 text-xs text-muted">{formatDate(leave.from_date)} → {formatDate(leave.to_date)}</p></div><div className="text-xs font-semibold text-steel">{formatDaysDisplay(leave)}</div></div>
                <p className="mt-3 text-sm text-slate-700">{leave.reason || "Không ghi lý do"}</p>
                <p className="mt-2 text-[11px] text-muted">Duyệt lúc: {leave.decided_at ? formatDate(leave.decided_at) : "—"}</p>
              </article>
            ))}
          </div>
          <div className="hidden overflow-x-auto rounded-xl2 border border-line bg-white shadow-card lg:block">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="bg-paper text-left text-[11px] uppercase tracking-wide text-muted">
                  <th className="border border-line px-3 py-2">Nhân viên</th>
                  <th className="border border-line px-3 py-2">Từ ngày</th>
                  <th className="border border-line px-3 py-2">Đến ngày</th>
                  <th className="border border-line px-3 py-2 text-right">Lịch làm / Số ngày</th>
                  <th className="border border-line px-3 py-2">Lý do</th>
                  <th className="border border-line px-3 py-2">Duyệt lúc</th>
                </tr>
              </thead>
              <tbody>
                {approvedByMe.length === 0 ? (
                  <tr>
                    <td className="border border-line px-3 py-6 text-center text-xs text-muted" colSpan={6}>
                      Bạn chưa duyệt đơn nào.
                    </td>
                  </tr>
                ) : (
                  approvedByMe.map((l) => (
                    <tr key={l.id} className="text-xs hover:bg-paper/60">
                      <td className="border border-line px-3 py-2 font-semibold text-ink">{l.user_name || "—"}</td>
                      <td className="border border-line px-3 py-2 text-muted">{formatDate(l.from_date)}</td>
                      <td className="border border-line px-3 py-2 text-muted">{formatDate(l.to_date)}</td>
                      <td className="border border-line px-3 py-2 text-right">{formatDaysDisplay(l)}</td>
                      <td className="border border-line px-3 py-2 text-muted">{l.reason || "—"}</td>
                      <td className="border border-line px-3 py-2 text-muted">
                        {l.decided_at ? formatDate(l.decided_at) : "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </AppShell>
  );
}
