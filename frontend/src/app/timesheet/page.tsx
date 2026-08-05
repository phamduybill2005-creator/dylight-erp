"use client";

// Bảng NHÂN CÔNG theo ngày — CHẾ ĐỘ CHỈ ĐỌC.
// Tổng hợp giá trị real-time từ phần Tiến độ của từng Dự án (bảng timesheets).
// Tất cả tài khoản đều nhìn thấy dữ liệu nhưng không sửa/nhập được.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ClockIcon, ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import AppShell from "@/components/app-shell";
import { api } from "@/lib/api";
import { dateLocal, todayLocal } from "@/lib/format";
import type { Timesheet, Project, User } from "@/lib/types";

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

  // Luôn lấy TẤT CẢ entries (không lọc userId) — tổng hợp real-time từ Tiến độ Dự án
  const loadEntries = useCallback(() => {
    if (!me) return;
    api.timesheets({ from: rangeFrom, to: rangeTo }).then(setEntries).catch(() => setEntries([]));
  }, [me, rangeFrom, rangeTo]);

  useEffect(() => {
    api.me()
      .then((u) => {
        setMe(u);
        api.projects().then(setProjects).catch(() => {});
        setLoading(false);
      })
      .catch(() => router.push("/login"));
  }, [router]);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  const key = (pid: number, d: string) => `${pid}:${d}`;

  // Tổng hợp giờ MỌI NGƯỜI cho mỗi ô (project × day) — giá trị real-time từ Tiến độ Dự án
  const cellHours = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) {
      const k = key(e.project_id, e.work_date);
      map.set(k, (map.get(k) ?? 0) + Number(e.hours));
    }
    return map;
  }, [entries]);

  // Hàng = dự án. Dự án có giờ trong tuần lên đầu.
  const rowProjects = useMemo(() => {
    const has = new Set(entries.map((e) => e.project_id));
    return [...projects].sort(
      (a, b) => (has.has(a.id) ? 0 : 1) - (has.has(b.id) ? 0 : 1) || a.name.localeCompare(b.name, "vi"),
    );
  }, [projects, entries]);

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
      <header className="flex items-center gap-2 rounded-xl2 bg-ink p-4 lg:p-6 text-white shadow-card">
        <ClockIcon className="h-5 w-5 text-amber" />
        <h1 className="text-base lg:text-xl font-bold">Nhân công theo ngày</h1>
      </header>

      <p className="mt-3 rounded-xl2 border border-line bg-white p-3 text-[11px] text-muted shadow-card">
        Bảng tổng hợp <b className="text-ink">số giờ làm thực tế</b> từ mục Tiến độ của từng Dự án (chế độ chỉ đọc, dữ liệu tự động đồng bộ real-time từ Tiến độ Dự án).
      </p>

      {/* Thanh điều khiển: tuần/tháng */}
      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl2 border border-line bg-white p-2 shadow-card">
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

      {/* Lưới Dự án × Ngày — CHỈ ĐỌC */}
      <div className="mt-3 mr-14 overflow-auto max-h-[calc(100vh-340px)] rounded-xl2 border border-line bg-white shadow-card">
        <table className="w-full min-w-[850px] table-fixed border-collapse text-[11px]">
          <colgroup>
            <col className="w-[240px]" />
            {days.map((d) => (
              <col key={d} className="w-[54px]" />
            ))}
            <col className="w-[50px]" />
            <col className="w-[50px]" />
          </colgroup>
          <thead>
            <tr className="bg-slate-700 text-[10px] uppercase tracking-wide text-white">
              <th className={`${stickyLeft} sticky top-0 z-30 bg-slate-700 border border-slate-600 px-2 py-1.5 text-left font-semibold align-middle`}>Dự án</th>
              {days.map((d) => {
                const [y, m, dd] = d.split("-").map(Number);
                const dayIdx = new Date(y, m - 1, dd).getDay();
                const dowName = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"][dayIdx];
                return (
                  <th key={d} className={`sticky top-0 z-20 border border-slate-600 px-0.5 py-1.5 text-center font-semibold whitespace-nowrap align-middle ${d === today ? "bg-amber text-white" : "bg-slate-700 text-slate-200"}`}>
                    <div>{dowName}</div>
                    <div className="text-[9px] font-normal">{fmtDay(d)}</div>
                  </th>
                );
              })}
              <th className="sticky top-0 right-[50px] z-30 bg-slate-700 border border-slate-600 px-1 py-1.5 text-center font-semibold whitespace-nowrap w-[50px] min-w-[50px] align-middle">
                <div>Giờ</div>
                <div className="text-[9px] font-normal opacity-0">–</div>
              </th>
              <th className="sticky top-0 right-0 z-30 bg-slate-700 border border-slate-600 px-1 py-1.5 text-center font-semibold whitespace-nowrap w-[50px] min-w-[50px] align-middle">
                <div>Ngày</div>
                <div className="text-[9px] font-normal">công</div>
              </th>
            </tr>
          </thead>
          <tbody>
            {rowProjects.length === 0 ? (
              <tr><td colSpan={days.length + 3} className="border border-line px-2 py-5 text-center text-muted">Chưa có dự án nào.</td></tr>
            ) : (
              rowProjects.map((p) => {
                const total = projTotal(p.id);
                return (
                  <tr key={p.id} className="odd:bg-white even:bg-sky-50/60 hover:bg-sky-100/50 transition-colors">
                    <td className={`${stickyLeft} bg-inherit px-2 py-1`}>
                      <span className="font-mono text-[10px] font-bold text-bad">{p.code}</span>
                      <span className="block max-w-[180px] truncate font-medium text-ink text-[11px]" title={p.name}>{p.name}</span>
                    </td>
                    {days.map((d) => (
                      <td key={d} className={`border border-line p-0 text-center ${d === today ? "bg-amber/10" : d > today ? "bg-slate-100/70" : "bg-inherit"}`}>
                        <span className={`block px-0.5 py-1 tnum ${cellHours.get(key(p.id, d)) ? "font-semibold text-ink" : "text-line"}`}>
                          {cellHours.get(key(p.id, d)) ? num1(cellHours.get(key(p.id, d))!) : "–"}
                        </span>
                      </td>
                    ))}
                    <td className={`sticky right-[50px] z-10 border border-line bg-inherit px-1 py-1 text-center font-bold tnum w-[50px] min-w-[50px] ${total > 0 ? "text-steel" : "text-muted"}`}>
                      {total > 0 ? num1(total) : "–"}
                    </td>
                    <td className={`sticky right-0 z-10 border border-line bg-inherit px-1 py-1 text-center font-bold tnum w-[50px] min-w-[50px] ${total > 0 ? "text-ink" : "text-muted"}`}>
                      {total > 0 ? num1(total / 8) : "–"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          <tfoot>
            <tr className="bg-gradient-to-r from-teal-600 to-teal-700 font-bold text-white">
              <td className={`${stickyLeft} bg-teal-600 px-2 py-1.5 text-right sticky bottom-0 z-30 border-t border-teal-500 text-[11px]`}>Tổng ngày</td>
              {days.map((d) => {
                const t = dayTotal(d);
                return (
                  <td key={d} className="border border-teal-500/50 bg-teal-600 px-0.5 py-1.5 text-center tnum sticky bottom-0 z-20 border-t border-teal-500">
                    {t > 0 ? num1(t) : "–"}
                  </td>
                );
              })}
              <td className={`sticky bottom-0 right-[50px] z-30 bg-teal-600 border border-teal-500 px-1 py-1.5 text-center text-yellow-200 tnum w-[50px] min-w-[50px]`}>
                {grandTotal > 0 ? num1(grandTotal) : "–"}
              </td>
              <td className={`sticky bottom-0 right-0 z-30 bg-teal-600 border border-teal-500 px-1 py-1.5 text-center text-yellow-100 font-extrabold tnum w-[50px] min-w-[50px]`}>
                {grandTotal > 0 ? num1(grandTotal / 8) : "–"}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </AppShell>
  );
}
