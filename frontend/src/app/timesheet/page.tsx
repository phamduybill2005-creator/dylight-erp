"use client";

// Bảng NHÂN CÔNG theo ngày — CHẾ ĐỘ CHỈ ĐỌC.
// Tổng hợp giá trị real-time từ phần Tiến độ của từng Dự án (bảng timesheets).
// Tất cả tài khoản đều nhìn thấy dữ liệu nhưng không sửa/nhập được.
// Bấm vào mã/tên dự án ở cột đầu để mở trang chi tiết dự án đó.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useStickyState } from "@/lib/use-sticky-state";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClockIcon, ChevronLeftIcon, ChevronRightIcon, UserIcon, UsersIcon, BuildingOfficeIcon, StarIcon as StarIconOutline } from "@heroicons/react/24/outline";
import { StarIcon as StarIconSolid } from "@heroicons/react/24/solid";
import AppShell from "@/components/app-shell";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import { api } from "@/lib/api";
import { dateLocal, todayLocal } from "@/lib/format";
import { PRESET_DEPARTMENTS } from "@/lib/departments";
import { getProjectDept } from "@/lib/groups";
import { isSeniorManagerUp } from "@/lib/roles";
import { summarizeTimesheetProject, timesheetCellKey } from "@/lib/mobile-view-models";
import type { Timesheet, Project, User, Department } from "@/lib/types";

/** Thứ 2 của tuần chứa ngày d (YYYY-MM-DD), giờ địa phương. */
function mondayOf(d: string): string {
  const [y, m, dd] = d.split("-").map(Number);
  const x = new Date(y, m - 1, dd);
  const wd = x.getDay();               // CN=0 … T7=6
  x.setDate(x.getDate() + (wd === 0 ? -6 : 1 - wd));
  return dateLocal(x);
}
function addDays(d: string, n: number): string {
  const [y, m, dd] = d.split("-").map(Number);
  return dateLocal(new Date(y, m - 1, dd + n));
}
const fmtDay = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`;
const num1 = (n: number) => (Math.round(n * 10) / 10).toString();

export default function TimesheetPage() {
  const router = useRouter();
  const [me, setMe] = useState<User | null>(api.cachedUser());
  const [loading, setLoading] = useState(true);
  // Kỳ đang xem, Tuần/Tháng, Toàn đội/Cá nhân, phòng ban: NHỚ qua F5 (useStickyState).
  const [weekStart, setWeekStart] = useStickyState("timesheet.weekStart", mondayOf(todayLocal()));
  const [projects, setProjects] = useState<Project[]>([]);
  const [entries, setEntries] = useState<Timesheet[]>([]);
  const [viewPeriod, setViewPeriod] = useStickyState<"week" | "month">("timesheet.period", "week");
  const [monthStr, setMonthStr] = useStickyState("timesheet.month", todayLocal().slice(0, 7)); // YYYY-MM
  const [viewScope, setViewScope] = useStickyState<"all" | "personal">("timesheet.scope", "all");
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedDept, setSelectedDept] = useStickyState("timesheet.dept", "");
  // Mặc định ẨN dự án chưa nhập giờ trong kỳ đang xem (bật "Hiện tất cả" để xem cả).
  const [showEmpty, setShowEmpty] = useStickyState("timesheet.showEmpty", false);
  const [pinnedIds, setPinnedIds] = useState<number[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const saved = localStorage.getItem("timesheet_pinned_projects");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [expandedMobileProject, setExpandedMobileProject] = useState<number | null>(null);

  useEffect(() => {
    const syncPinned = () => {
      try {
        const saved = localStorage.getItem("timesheet_pinned_projects");
        setPinnedIds(saved ? JSON.parse(saved) : []);
      } catch {}
    };
    syncPinned();

    window.addEventListener("storage", syncPinned);
    window.addEventListener("focus", syncPinned);
    window.addEventListener("pinned_projects_changed", syncPinned);
    return () => {
      window.removeEventListener("storage", syncPinned);
      window.removeEventListener("focus", syncPinned);
      window.removeEventListener("pinned_projects_changed", syncPinned);
    };
  }, []);

  const togglePin = useCallback((pid: number) => {
    setPinnedIds((prev) => {
      const next = prev.includes(pid) ? prev.filter((id) => id !== pid) : [...prev, pid];
      try {
        localStorage.setItem("timesheet_pinned_projects", JSON.stringify(next));
        window.dispatchEvent(new Event("storage"));
        window.dispatchEvent(new CustomEvent("pinned_projects_changed", { detail: next }));
      } catch {}
      return next;
    });
  }, []);

  const days = useMemo(() => {
    if (viewPeriod === "week") {
      return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    } else {
      const [y, m] = monthStr.split("-").map(Number);
      const count = new Date(y, m, 0).getDate();
      return Array.from({ length: count }, (_, i) => {
        const dd = String(i + 1).padStart(2, "0");
        const mm = String(m).padStart(2, "0");
        return `${y}-${mm}-${dd}`;
      });
    }
  }, [viewPeriod, weekStart, monthStr]);

  const weekEnd = days[days.length - 1];
  const today = todayLocal();

  const rangeFrom = days[0];
  const rangeTo = days[days.length - 1];

  // Lấy TẤT CẢ entries trong khoảng ngày — tổng hợp từ Tiến độ Dự án
  const loadEntries = useCallback(() => {
    if (!me) return;
    api.timesheets({ from: rangeFrom, to: rangeTo }).then(setEntries).catch(() => setEntries([]));
  }, [me, rangeFrom, rangeTo]);

  useEffect(() => {
    api.me()
      .then((u) => {
        setMe(u);
        api.projects().then(setProjects).catch(() => {});
        api.users().then(setAllUsers).catch(() => {});
        api.departments().then(setDepartments).catch(() => {});
        setLoading(false);
      })
      .catch(() => router.push("/login"));
  }, [router]);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  // Tự làm mới: người khác vừa khai giờ ở tab Tiến độ dự án thì bảng này tự cộng thêm.
  useAutoRefresh(loadEntries, { enabled: !!me, topics: ["timesheet"] });

  // Danh sách phòng ban để lọc
  const deptOptions = useMemo(() => {
    const set = new Set<string>(PRESET_DEPARTMENTS);
    for (const d of departments) {
      if (d.name) set.add(d.name.trim());
    }
    for (const u of allUsers) {
      if (u.department) {
        u.department.split(",").forEach((s) => {
          const trimmed = s.trim();
          if (trimmed) set.add(trimmed);
        });
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "vi"));
  }, [departments, allUsers]);

  const userDeptMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const u of allUsers) {
      if (u.department) map.set(u.id, u.department);
    }
    return map;
  }, [allUsers]);

  // Lọc entries theo Scope (Toàn đội / Cá nhân) & Phòng ban (chỉ tính dự án thuộc phòng ban được chọn)
  const filteredEntries = useMemo(() => {
    return entries.filter((e) => {
      if (viewScope === "personal" && e.user_id !== me?.id) {
        return false;
      }
      if (selectedDept !== "") {
        const proj = projects.find((p) => p.id === e.project_id);
        const isProjMatch = proj ? getProjectDept(proj) === selectedDept : false;
        if (!isProjMatch) return false;
      }
      return true;
    });
  }, [entries, viewScope, me?.id, selectedDept, projects]);

  // Khóa ô dùng CHUNG với thẻ điện thoại (summarizeTimesheetProject) — không tự định nghĩa riêng.
  const key = timesheetCellKey;

  // Tính tổng giờ cho mỗi ô (project × day)
  const cellHours = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of filteredEntries) {
      const k = key(e.project_id, e.work_date);
      map.set(k, (map.get(k) ?? 0) + Number(e.hours));
    }
    return map;
  }, [filteredEntries]);

  // Tổng giờ cá nhân & tổng giờ toàn đội/phòng ban trong khoảng thời gian đang chọn
  const personalTotal = useMemo(() => {
    return entries
      .filter((e) => e.user_id === me?.id && days.includes(e.work_date))
      .reduce((s, e) => s + Number(e.hours), 0);
  }, [entries, me?.id, days]);

  const teamTotal = useMemo(() => {
    return filteredEntries
      .filter((e) => days.includes(e.work_date))
      .reduce((s, e) => s + Number(e.hours), 0);
  }, [filteredEntries, days]);

  // Dự án CÓ GIỜ trong kỳ đang xem (đã lọc Toàn đội/Cá nhân + Phòng ban).
  const projectsWithHours = useMemo(() => {
    const s = new Set<number>();
    for (const e of filteredEntries) if (Number(e.hours) > 0) s.add(e.project_id);
    return s;
  }, [filteredEntries]);

  // Dự án thuộc phòng ban đang chọn (chưa xét có giờ hay không).
  const deptProjects = useMemo(
    () => (selectedDept !== "" ? projects.filter((p) => getProjectDept(p) === selectedDept) : projects),
    [projects, selectedDept],
  );
  // Số dự án đang bị ẩn vì chưa nhập giờ trong kỳ.
  const hiddenEmptyCount = useMemo(
    () => deptProjects.filter((p) => !projectsWithHours.has(p.id)).length,
    [deptProjects, projectsWithHours],
  );

  // Hàng = dự án. Khi chọn Phòng ban, chỉ hiển thị đúng các dự án thuộc phòng ban đó.
  // Mặc định CHỈ hiện dự án đã nhập giờ trong kỳ — nhập giờ ở Tiến độ dự án là tự hiện lại;
  // bật "Hiện tất cả" mới thấy cả dự án trống.
  // Thứ tự sắp xếp: 1. Dự án GHIM (Pinned) -> 2. Dự án có giờ -> 3. Tên A-Z.
  const rowProjects = useMemo(() => {
    const list = showEmpty ? deptProjects : deptProjects.filter((p) => projectsWithHours.has(p.id));
    const has = projectsWithHours;
    const pinnedSet = new Set(pinnedIds);

    return [...list].sort((a, b) => {
      const aPin = pinnedSet.has(a.id) ? 1 : 0;
      const bPin = pinnedSet.has(b.id) ? 1 : 0;
      if (aPin !== bPin) return bPin - aPin;

      const aHas = has.has(a.id) ? 1 : 0;
      const bHas = has.has(b.id) ? 1 : 0;
      if (aHas !== bHas) return bHas - aHas;

      const da = a.start_date ? a.start_date.trim() : "";
      const db = b.start_date ? b.start_date.trim() : "";
      if (da && db && da !== db) return da.localeCompare(db);
      if (da && !db) return -1;
      if (!da && db) return 1;

      return a.name.localeCompare(b.name, "vi");
    });
  }, [deptProjects, projectsWithHours, pinnedIds, showEmpty]);

  const projTotal = (pid: number) => days.reduce((s, d) => s + (cellHours.get(key(pid, d)) ?? 0), 0);
  const dayTotal = (d: string) => rowProjects.reduce((s, p) => s + (cellHours.get(key(p.id, d)) ?? 0), 0);
  const grandTotal = days.reduce((s, d) => s + dayTotal(d), 0);

  if (loading || !me) {
    return (
      <AppShell><div className="flex min-h-[70vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-steel border-t-amber" />
      </div></AppShell>
    );
  }

  const stickyLeft = "sticky left-0 z-10 border border-line";

  return (
    <AppShell maxWidthClass="max-w-md lg:max-w-none lg:px-4">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl2 bg-ink p-4 lg:p-6 text-white shadow-card">
        <div className="flex items-center gap-2">
          <ClockIcon className="h-5 w-5 text-amber" />
          <h1 className="text-base lg:text-xl font-bold">Thời gian thực hiện dự án</h1>
        </div>
        
        {/* Badge thống kê giờ nhanh */}
        <div className="flex items-center gap-2 text-xs">
          <div className="rounded-lg bg-teal-900/60 border border-teal-500/40 px-3 py-1.5 text-slate-200">
            <span>{selectedDept ? selectedDept : "Toàn đội"}: </span>
            <b className="text-amber">{num1(teamTotal)}h</b> ({num1(teamTotal / 8)} công)
          </div>
          <div className="rounded-lg bg-slate-800 border border-slate-700 px-3 py-1.5 text-slate-200">
            <span>Cá nhân: </span>
            <b className="text-emerald-400">{num1(personalTotal)}h</b> ({num1(personalTotal / 8)} công)
          </div>
        </div>
      </header>

      {/* Thanh điều khiển: chế độ xem Toàn đội / Cá nhân / Chọn phòng ban & Tuần / Tháng */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl2 border border-line bg-white p-2 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          {/* Tab chọn phạm vi: Toàn đội / Cá nhân */}
          <div className="flex items-center gap-1 rounded-lg border border-line bg-slate-100/70 p-0.5 text-xs mr-1">
            <button
              onClick={() => setViewScope("all")}
              className={`flex items-center gap-1.5 rounded px-3 py-1 font-semibold transition-all duration-200 ${
                viewScope === "all"
                  ? "bg-teal-700 text-white shadow"
                  : "text-slate-600 hover:bg-white/80"
              }`}
            >
              <UsersIcon className="h-3.5 w-3.5" />
              Toàn đội
            </button>
            <button
              onClick={() => setViewScope("personal")}
              className={`flex items-center gap-1.5 rounded px-3 py-1 font-semibold transition-all duration-200 ${
                viewScope === "personal"
                  ? "bg-teal-700 text-white shadow"
                  : "text-slate-600 hover:bg-white/80"
              }`}
            >
              <UserIcon className="h-3.5 w-3.5" />
              Cá nhân ({me.full_name?.split(" ").pop() ?? "Tôi"})
            </button>
          </div>

          {/* Bộ lọc chọn Phòng ban (CHỈ HIỆN với Giám đốc, Quản trị & Quản lý cấp cao xem từng phòng) */}
          {isSeniorManagerUp(me) && (
            <div className="flex items-center gap-1.5 rounded-lg border border-line bg-slate-100/70 px-2.5 py-1 text-xs mr-2">
              <BuildingOfficeIcon className="h-4 w-4 text-steel shrink-0" />
              <span className="text-[11px] font-semibold text-slate-700 whitespace-nowrap">Phòng ban:</span>
              <select
                value={selectedDept}
                onChange={(e) => setSelectedDept(e.target.value)}
                className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-xs font-bold text-ink outline-none focus:border-steel cursor-pointer transition-all hover:border-slate-400"
              >
                <option value="">— Tất cả phòng ban —</option>
                {deptOptions.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Toggle Tuần / Tháng */}
          <div className="flex items-center gap-1 rounded-lg border border-line p-0.5 text-xs mr-1">
            <button
              onClick={() => setViewPeriod("week")}
              className={`rounded px-2.5 py-1 font-semibold transition-colors duration-200 ${viewPeriod === "week" ? "bg-steel text-white" : "text-muted hover:bg-paper"}`}
            >
              Tuần
            </button>
            <button
              onClick={() => setViewPeriod("month")}
              className={`rounded px-2.5 py-1 font-semibold transition-colors duration-200 ${viewPeriod === "month" ? "bg-steel text-white" : "text-muted hover:bg-paper"}`}
            >
              Tháng
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {viewPeriod === "week" ? (
            <>
              <button onClick={() => setWeekStart(addDays(weekStart, -7))} className="rounded-lg border border-line p-1.5 text-muted hover:bg-paper" title="Tuần trước">
                <ChevronLeftIcon className="h-4 w-4" />
              </button>
              <span className="text-xs font-semibold text-ink">
                Tuần {fmtDay(weekStart)} – {fmtDay(weekEnd)}
              </span>
              <button onClick={() => setWeekStart(addDays(weekStart, 7))} className="rounded-lg border border-line p-1.5 text-muted hover:bg-paper" title="Tuần sau">
                <ChevronRightIcon className="h-4 w-4" />
              </button>
              <input
                type="date"
                value={weekStart}
                onChange={(e) => e.target.value && setWeekStart(mondayOf(e.target.value))}
                className="rounded-lg border border-line bg-white px-2 py-1.5 text-xs outline-none focus:border-steel"
              />
              <button onClick={() => setWeekStart(mondayOf(today))} className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-steel hover:bg-paper">
                Tuần này
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => {
                  const [y, m] = monthStr.split("-").map(Number);
                  const prev = new Date(y, m - 2, 1);
                  setMonthStr(`${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`);
                }}
                className="rounded-lg border border-line p-1.5 text-muted hover:bg-paper"
                title="Tháng trước"
              >
                <ChevronLeftIcon className="h-4 w-4" />
              </button>
              <span className="text-xs font-semibold text-ink">
                Tháng {Number(monthStr.slice(5, 7))}/{monthStr.slice(0, 4)}
              </span>
              <button
                onClick={() => {
                  const [y, m] = monthStr.split("-").map(Number);
                  const next = new Date(y, m, 1);
                  setMonthStr(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`);
                }}
                className="rounded-lg border border-line p-1.5 text-muted hover:bg-paper"
                title="Tháng sau"
              >
                <ChevronRightIcon className="h-4 w-4" />
              </button>
              <input
                type="month"
                value={monthStr}
                onChange={(e) => e.target.value && setMonthStr(e.target.value)}
                className="rounded-lg border border-line bg-white px-2 py-1.5 text-xs outline-none focus:border-steel"
              />
              <button onClick={() => setMonthStr(today.slice(0, 7))} className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-steel hover:bg-paper">
                Tháng này
              </button>
            </>
          )}
        </div>
      </div>

      {/* Dự án chưa nhập giờ trong kỳ được ẩn cho gọn; báo số lượng + nút xem cả */}
      {(hiddenEmptyCount > 0 || showEmpty) && (
        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
          {showEmpty ? (
            <span>Đang hiện cả <b className="text-ink">{hiddenEmptyCount}</b> dự án chưa nhập giờ trong {viewPeriod === "week" ? "tuần" : "tháng"} này.</span>
          ) : (
            <span>Đang ẩn <b className="text-ink">{hiddenEmptyCount}</b> dự án chưa nhập giờ trong {viewPeriod === "week" ? "tuần" : "tháng"} này — nhập giờ ở Tiến độ dự án là tự hiện lại.</span>
          )}
          <button
            type="button"
            onClick={() => setShowEmpty(!showEmpty)}
            className="rounded-full border border-line bg-white px-2.5 py-0.5 font-semibold text-steel hover:bg-paper"
          >
            {showEmpty ? "Chỉ hiện dự án có giờ" : "Hiện tất cả"}
          </button>
        </p>
      )}

      {/* Điện thoại: ưu tiên tổng giờ/công, chạm để xem chi tiết từng ngày. */}
      <section className="mt-3 space-y-2 lg:hidden" aria-label="Tiến độ dự án trên điện thoại">
        {rowProjects.length === 0 ? (
          <p className="rounded-xl2 border border-line bg-white px-4 py-8 text-center text-sm text-muted shadow-card">
            {hiddenEmptyCount > 0
              ? `Chưa có dự án nào được nhập giờ trong ${viewPeriod === "week" ? "tuần" : "tháng"} này.`
              : "Chưa có dự án nào."}
          </p>
        ) : rowProjects.map((project, index) => {
          const summary = summarizeTimesheetProject(project.id, days, cellHours);
          const open = expandedMobileProject === project.id;
          const pinned = pinnedIds.includes(project.id);
          return (
            <article key={project.id} className={`overflow-hidden rounded-xl border bg-white shadow-card ${pinned ? "border-amber/60" : "border-line"}`}>
              <div className="flex items-start gap-2 p-3">
                <span className="pt-1 font-mono text-xs font-bold text-slate-400">{index + 1}</span>
                <button type="button" onClick={() => togglePin(project.id)} className="flex h-11 w-9 shrink-0 items-start justify-center pt-1" aria-label={pinned ? "Bỏ ghim dự án" : "Ghim dự án"}>
                  {pinned ? <StarIconSolid className="h-5 w-5 text-amber" /> : <StarIconOutline className="h-5 w-5 text-slate-300" />}
                </button>
                <Link href={`/projects/${project.id}`} className="min-w-0 flex-1 py-0.5">
                  <span className="block font-mono text-xs font-bold text-bad">{project.code}</span>
                  <span className="mt-0.5 line-clamp-2 text-sm font-semibold leading-snug text-ink">{project.name}</span>
                </Link>
                <div className="shrink-0 text-right">
                  <p className="text-lg font-extrabold text-steel tnum">{num1(summary.totalHours)}h</p>
                  <p className="text-xs font-semibold text-muted tnum">{num1(summary.workDays)} công</p>
                </div>
              </div>
              <button type="button" onClick={() => setExpandedMobileProject(open ? null : project.id)} className="flex min-h-11 w-full items-center justify-between border-t border-line bg-paper/60 px-3 text-xs font-semibold text-steel" aria-expanded={open}>
                <span>{open ? "Ẩn chi tiết" : `Xem ${summary.workedDays.length} ngày có giờ`}</span>
                <ChevronRightIcon className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`} />
              </button>
              {open && (
                <div className="divide-y divide-line px-3">
                  {summary.workedDays.length === 0 ? (
                    <p className="py-3 text-center text-xs text-muted">Dự án chưa có giờ trong kỳ này.</p>
                  ) : summary.workedDays.map((entry) => (
                    <div key={entry.date} className="flex min-h-11 items-center justify-between text-sm">
                      <span className="text-slate-600">{new Date(`${entry.date}T00:00:00`).toLocaleDateString("vi-VN", { weekday: "short", day: "2-digit", month: "2-digit" })}</span>
                      <span className="font-bold text-ink tnum">{num1(entry.hours)} giờ</span>
                    </div>
                  ))}
                </div>
              )}
            </article>
          );
        })}
        {rowProjects.length > 0 && (
          <div className="flex items-center justify-between rounded-xl bg-teal-700 px-4 py-3 text-white shadow-card">
            <span className="text-sm font-bold">Tổng trong kỳ</span>
            <span className="font-extrabold tnum">{num1(grandTotal)} giờ · {num1(grandTotal / 8)} công</span>
          </div>
        )}
      </section>

      {/* Lưới Dự án × Ngày — CHỈ ĐỌC */}
      {(() => {
        const isMonth = viewPeriod === "month";
        const totalRightOffset = isMonth ? "right-[40px]" : "right-[50px]";
        const totalColClass = isMonth ? "w-[40px] min-w-[40px]" : "w-[50px] min-w-[50px]";
        return (
          <div className="mt-3 hidden overflow-auto max-h-[calc(100vh-340px)] rounded-xl2 border border-line bg-white shadow-card lg:block">
            <table className={`w-full border-collapse text-[11px] table-fixed ${isMonth ? "min-w-[1200px]" : "min-w-[850px]"}`}>
              <colgroup>
                <col className={isMonth ? "w-[180px] lg:w-[210px]" : "w-[260px]"} />
                {days.map((d) => (
                  <col key={d} className={isMonth ? "w-[30px] min-w-[30px]" : "w-[54px]"} />
                ))}
                <col className={totalColClass} />
                <col className={totalColClass} />
              </colgroup>
              <thead>
                <tr className="bg-slate-700 text-[10px] uppercase tracking-wide text-white">
                  <th className={`${stickyLeft} sticky top-0 z-30 bg-slate-700 border border-slate-600 ${isMonth ? "px-1 py-1 text-[10px]" : "px-2 py-1.5 text-left"} font-semibold align-middle`}>
                    <div className="flex items-center gap-1.5">
                      <span className="w-5 shrink-0 text-center text-slate-300 font-mono" title="Số thứ tự">STT</span>
                      <span className="w-4 shrink-0 text-center text-amber" title="Ghim yêu thích lên đầu">★</span>
                      <span className="truncate">Dự án</span>
                    </div>
                  </th>
                  {days.map((d) => {
                    const [y, m, dd] = d.split("-").map(Number);
                    const dayIdx = new Date(y, m - 1, dd).getDay();
                    const dowName = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"][dayIdx];
                    const isWeekend = dayIdx === 0 || dayIdx === 6;
                    return (
                      <th
                        key={d}
                        className={`sticky top-0 z-20 border border-slate-600 text-center font-semibold align-middle overflow-hidden ${
                          isMonth ? "px-0 py-0.5 text-[8px]" : "px-0.5 py-1.5 text-[10px] whitespace-nowrap"
                        } ${
                          d === today
                            ? "bg-amber text-white font-bold"
                            : isWeekend
                            ? "bg-slate-800 text-slate-300"
                            : "bg-slate-700 text-slate-200"
                        }`}
                      >
                        <div className="leading-none">{dowName}</div>
                        <div className={`font-normal leading-tight ${isMonth ? "text-[8px]" : "text-[9px]"}`}>
                          {fmtDay(d)}
                        </div>
                      </th>
                    );
                  })}
                  <th className={`sticky top-0 ${totalRightOffset} z-30 bg-slate-700 border border-slate-600 px-0.5 py-1 text-center font-semibold whitespace-nowrap ${totalColClass} align-middle ${isMonth ? "text-[9px]" : "text-[10px]"}`}>
                    <div>Giờ</div>
                    <div className="text-[8px] font-normal opacity-0">–</div>
                  </th>
                  <th className={`sticky top-0 right-0 z-30 bg-slate-700 border border-slate-600 px-0.5 py-1 text-center font-semibold whitespace-nowrap ${totalColClass} align-middle ${isMonth ? "text-[9px]" : "text-[10px]"}`}>
                    <div>Công</div>
                    <div className="text-[8px] font-normal opacity-0">–</div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rowProjects.length === 0 ? (
                  <tr>
                    <td colSpan={days.length + 3} className="border border-line px-2 py-5 text-center text-muted">
                      {hiddenEmptyCount > 0
                        ? `Chưa có dự án nào được nhập giờ trong ${viewPeriod === "week" ? "tuần" : "tháng"} này.`
                        : "Chưa có dự án nào."}
                    </td>
                  </tr>
                ) : (
                  rowProjects.map((p, idx) => {
                    const total = projTotal(p.id);
                    const isPinned = pinnedIds.includes(p.id);
                    return (
                      <tr
                        key={p.id}
                        className={`transition-colors ${
                          isPinned
                            ? "bg-amber/10 hover:bg-amber/15 font-medium"
                            : "odd:bg-white even:bg-sky-50/60 hover:bg-sky-100/50"
                        }`}
                      >
                        <td className={`${stickyLeft} bg-inherit ${isMonth ? "px-1 py-0.5" : "px-2 py-1"}`}>
                          <div className="flex items-center gap-1.5">
                            {/* Cột STT */}
                            <span className="w-5 shrink-0 text-center font-mono text-[10px] font-bold text-slate-500">
                              {idx + 1}
                            </span>

                            {/* Cột Ghim (Yêu thích) */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                togglePin(p.id);
                              }}
                              className="shrink-0 p-0.5 transition-transform hover:scale-125 focus:outline-none"
                              title={isPinned ? "Bỏ ghim dự án" : "Ghim dự án lên đầu bảng"}
                            >
                              {isPinned ? (
                                <StarIconSolid className="h-4 w-4 text-amber" />
                              ) : (
                                <StarIconOutline className="h-4 w-4 text-slate-300 hover:text-amber" />
                              )}
                            </button>

                            {/* Mã + Tên dự án — bấm để mở trang chi tiết dự án */}
                            <Link
                              href={`/projects/${p.id}`}
                              className="group min-w-0 flex-1 rounded focus-visible:outline-steel"
                              title={`${p.name} — mở chi tiết dự án`}
                            >
                              <span className="font-mono text-[9px] font-bold text-bad leading-none block truncate">{p.code}</span>
                              <span
                                className={`block ${isMonth ? "max-w-[95px] lg:max-w-[125px] text-[10px]" : "max-w-[160px] text-[11px]"} truncate font-medium text-ink leading-tight group-hover:text-steel group-hover:underline`}
                              >
                                {p.name}
                              </span>
                            </Link>
                          </div>
                        </td>
                        {days.map((d) => {
                          const hrs = cellHours.get(key(p.id, d));
                          return (
                            <td
                              key={d}
                              className={`border border-line p-0 text-center ${
                                d === today ? "bg-amber/10" : d > today ? "bg-slate-100/70" : "bg-inherit"
                              }`}
                            >
                              <span
                                className={`block ${isMonth ? "px-0 py-0.5 text-[9px]" : "px-0.5 py-1 text-[11px]"} tnum ${
                                  hrs ? "font-semibold text-ink" : "text-slate-300"
                                }`}
                              >
                                {hrs ? num1(hrs) : "–"}
                              </span>
                            </td>
                          );
                        })}
                        <td
                          className={`sticky ${totalRightOffset} z-10 border border-line bg-inherit px-0.5 py-0.5 text-center font-bold tnum ${totalColClass} ${
                            isMonth ? "text-[10px]" : "text-xs"
                          } ${total > 0 ? "text-steel" : "text-muted"}`}
                        >
                          {total > 0 ? num1(total) : "–"}
                        </td>
                        <td
                          className={`sticky right-0 z-10 border border-line bg-inherit px-0.5 py-0.5 text-center font-bold tnum ${totalColClass} ${
                            isMonth ? "text-[10px]" : "text-xs"
                          } ${total > 0 ? "text-ink" : "text-muted"}`}
                        >
                          {total > 0 ? num1(total / 8) : "–"}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              <tfoot>
                <tr className="bg-gradient-to-r from-teal-600 to-teal-700 font-bold text-white">
                  <td
                    className={`${stickyLeft} bg-teal-600 ${isMonth ? "px-1.5 py-1 text-[10px]" : "px-2 py-1.5 text-[11px]"} text-right sticky bottom-0 z-30 border-t border-teal-500`}
                  >
                    Tổng ngày
                  </td>
                  {days.map((d) => {
                    const t = dayTotal(d);
                    return (
                      <td
                        key={d}
                        className={`border border-teal-500/50 bg-teal-600 ${isMonth ? "px-0 py-1 text-[9px]" : "px-0.5 py-1.5 text-[11px]"} text-center tnum sticky bottom-0 z-20 border-t border-teal-500`}
                      >
                        {t > 0 ? num1(t) : "–"}
                      </td>
                    );
                  })}
                  <td
                    className={`sticky bottom-0 ${totalRightOffset} z-30 bg-teal-600 border border-teal-500 px-0.5 py-1 text-center text-yellow-200 tnum ${totalColClass} ${
                      isMonth ? "text-[10px]" : "text-xs"
                    }`}
                  >
                    {grandTotal > 0 ? num1(grandTotal) : "–"}
                  </td>
                  <td
                    className={`sticky bottom-0 right-0 z-30 bg-teal-600 border border-teal-500 px-0.5 py-1 text-center text-yellow-100 font-extrabold tnum ${totalColClass} ${
                      isMonth ? "text-[10px]" : "text-xs"
                    }`}
                  >
                    {grandTotal > 0 ? num1(grandTotal / 8) : "–"}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        );
      })()}
    </AppShell>
  );
}
