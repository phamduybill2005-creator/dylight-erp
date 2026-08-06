"use client";

// Bảng NHÂN CÔNG theo ngày — CHẾ ĐỘ CHỈ ĐỌC.
// Tổng hợp giá trị real-time từ phần Tiến độ của từng Dự án (bảng timesheets).
// Tất cả tài khoản đều nhìn thấy dữ liệu nhưng không sửa/nhập được.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ClockIcon, ChevronLeftIcon, ChevronRightIcon, UserIcon, UsersIcon, BuildingOfficeIcon } from "@heroicons/react/24/outline";
import AppShell from "@/components/app-shell";
import { api } from "@/lib/api";
import { dateLocal, todayLocal } from "@/lib/format";
import { PRESET_DEPARTMENTS } from "@/lib/departments";
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
  const [weekStart, setWeekStart] = useState(() => mondayOf(todayLocal()));
  const [projects, setProjects] = useState<Project[]>([]);
  const [entries, setEntries] = useState<Timesheet[]>([]);
  const [viewPeriod, setViewPeriod] = useState<"week" | "month">("week");
  const [monthStr, setMonthStr] = useState(() => todayLocal().slice(0, 7)); // YYYY-MM
  const [viewScope, setViewScope] = useState<"all" | "personal">("all");
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedDept, setSelectedDept] = useState<string>("");

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

  // Danh sách phòng ban để lọc
  const deptOptions = useMemo(() => {
    const set = new Set<string>();
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
    if (set.size === 0) {
      PRESET_DEPARTMENTS.forEach((p) => set.add(p));
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

  // Lọc entries theo Scope (Toàn đội / Cá nhân) & Phòng ban
  const filteredEntries = useMemo(() => {
    return entries.filter((e) => {
      if (viewScope === "personal" && e.user_id !== me?.id) {
        return false;
      }
      if (selectedDept !== "") {
        const uDept = userDeptMap.get(e.user_id) || "";
        const isMatch = uDept
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .some((p) => p === selectedDept.toLowerCase() || p.includes(selectedDept.toLowerCase()));
        if (!isMatch) return false;
      }
      return true;
    });
  }, [entries, viewScope, me?.id, selectedDept, userDeptMap]);

  const key = (pid: number, d: string) => `${pid}:${d}`;

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

  // Hàng = dự án. Dự án có giờ trong đợt lên đầu.
  const rowProjects = useMemo(() => {
    const has = new Set(filteredEntries.map((e) => e.project_id));
    return [...projects].sort(
      (a, b) => (has.has(a.id) ? 0 : 1) - (has.has(b.id) ? 0 : 1) || a.name.localeCompare(b.name, "vi"),
    );
  }, [projects, filteredEntries]);

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
          <h1 className="text-base lg:text-xl font-bold">Nhân công theo ngày</h1>
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

      <p className="mt-3 rounded-xl2 border border-line bg-white p-3 text-[11px] text-muted shadow-card">
        Bảng tổng hợp <b className="text-ink">số giờ làm thực tế</b> từ mục Tiến độ của từng Dự án (chế độ chỉ đọc, dữ liệu tự động đồng bộ real-time từ Tiến độ Dự án).
      </p>

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

          {/* Bộ lọc chọn Phòng ban (dành cho Giám đốc, Quản trị & Quản lý cấp cao xem từng phòng) */}
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

      {/* Lưới Dự án × Ngày — CHỈ ĐỌC */}
      {(() => {
        const isMonth = viewPeriod === "month";
        const totalRightOffset = isMonth ? "right-[40px]" : "right-[50px]";
        const totalColClass = isMonth ? "w-[40px] min-w-[40px]" : "w-[50px] min-w-[50px]";
        return (
          <div className="mt-3 overflow-auto max-h-[calc(100vh-340px)] rounded-xl2 border border-line bg-white shadow-card">
            <table className={`w-full border-collapse text-[11px] table-fixed ${isMonth ? "min-w-0" : "min-w-[850px]"}`}>
              <colgroup>
                <col className={isMonth ? "w-[150px] lg:w-[180px]" : "w-[240px]"} />
                {days.map((d) => (
                  <col key={d} className={isMonth ? "w-auto" : "w-[54px]"} />
                ))}
                <col className={totalColClass} />
                <col className={totalColClass} />
              </colgroup>
              <thead>
                <tr className="bg-slate-700 text-[10px] uppercase tracking-wide text-white">
                  <th className={`${stickyLeft} sticky top-0 z-30 bg-slate-700 border border-slate-600 ${isMonth ? "px-1.5 py-1 text-[10px]" : "px-2 py-1.5 text-left"} font-semibold align-middle`}>
                    Dự án
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
                      Chưa có dự án nào.
                    </td>
                  </tr>
                ) : (
                  rowProjects.map((p) => {
                    const total = projTotal(p.id);
                    return (
                      <tr key={p.id} className="odd:bg-white even:bg-sky-50/60 hover:bg-sky-100/50 transition-colors">
                        <td className={`${stickyLeft} bg-inherit ${isMonth ? "px-1.5 py-0.5" : "px-2 py-1"}`}>
                          <span className="font-mono text-[9px] font-bold text-bad leading-none block">{p.code}</span>
                          <span
                            className={`block ${isMonth ? "max-w-[130px] lg:max-w-[160px] text-[10px]" : "max-w-[180px] text-[11px]"} truncate font-medium text-ink leading-tight`}
                            title={p.name}
                          >
                            {p.name}
                          </span>
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
