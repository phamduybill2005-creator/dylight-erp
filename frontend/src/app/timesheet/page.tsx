"use client";

// Bảng NHÂN CÔNG theo ngày — mỗi người khai GIỜ LÀM THỰC TẾ cho từng dự án theo ngày
// (Dự án × Ngày = số giờ), để kiểm soát dự án từng ngày.
//  - "Của tôi": lưới nhập giờ của chính mình theo tuần (bấm ô gõ số giờ, tự lưu khi rời ô).
//  - Quản lý+: chọn xem/khai hộ 1 người, hoặc xem "Toàn đội" (tổng giờ mọi người, chỉ đọc).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ClockIcon, ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import AppShell from "@/components/app-shell";
import { api } from "@/lib/api";
import { roleTier } from "@/lib/roles";
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
const DOW = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
const fmtDay = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`;
const num1 = (n: number) => (Math.round(n * 10) / 10).toString();

export default function TimesheetPage() {
  const router = useRouter();
  const [me, setMe] = useState<User | null>(api.cachedUser());
  const [loading, setLoading] = useState(true);
  const [weekStart, setWeekStart] = useState(() => mondayOf(todayLocal()));
  const [projects, setProjects] = useState<Project[]>([]);
  const [entries, setEntries] = useState<Timesheet[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [mode, setMode] = useState<"me" | "team">("me");        // team = tổng hợp toàn đội (chỉ đọc)
  const [viewPeriod, setViewPeriod] = useState<"week" | "month">("week");
  const [monthStr, setMonthStr] = useState(() => todayLocal().slice(0, 7)); // YYYY-MM
  const [viewUserId, setViewUserId] = useState<number | null>(null); // quản lý: khai/xem hộ 1 người
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [dept, setDept] = useState<string>("");

  const isManager = me ? roleTier(me.role) !== "STAFF" : false;
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
  const targetUid = viewUserId ?? me?.id ?? 0;
  const editable = mode === "me";
  const today = todayLocal();

  // Trích xuất danh sách phòng ban duy nhất từ danh sách nhân viên
  const departments = useMemo(() => {
    const set = new Set<string>();
    for (const u of users) {
      if (u.department) {
        u.department.split(",").forEach((d) => {
          const trimmed = d.trim();
          if (trimmed) set.add(trimmed);
        });
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "vi"));
  }, [users]);

  // Bộ lọc danh sách nhân viên để chọn khai/xem hộ
  const filteredUsers = useMemo(() => {
    if (!dept) return users;
    return users.filter((u) => {
      const userDepts = (u.department || "").split(",").map((x) => x.trim());
      return userDepts.includes(dept);
    });
  }, [users, dept]);

  // Tự động reset viewUserId về null (Tôi) nếu đổi phòng ban mà nhân viên đang chọn không thuộc phòng ban đó
  useEffect(() => {
    if (!dept) return;
    if (viewUserId) {
      const selectedUser = users.find((u) => u.id === viewUserId);
      if (selectedUser) {
        const userDepts = (selectedUser.department || "").split(",").map((x) => x.trim());
        if (!userDepts.includes(dept)) {
          setViewUserId(null);
        }
      }
    }
  }, [dept, users, viewUserId]);

  // Danh sách ID người dùng thuộc phòng ban được chọn để tính tổng trong chế độ "team"
  const deptUserIds = useMemo(() => {
    if (!dept) return null;
    const ids = new Set<number>();
    for (const u of users) {
      const userDepts = (u.department || "").split(",").map((x) => x.trim());
      if (userDepts.includes(dept)) {
        ids.add(u.id);
      }
    }
    return ids;
  }, [users, dept]);

  const loadEntries = useCallback(() => {
    if (!me) return;
    const params: { from: string; to: string; userId?: number } = { from: weekStart, to: weekEnd };
    if (mode === "me") params.userId = targetUid;   // 1 người; team -> để trống = mọi người
    api.timesheets(params).then(setEntries).catch(() => setEntries([]));
  }, [me, weekStart, weekEnd, mode, targetUid]);

  useEffect(() => {
    api.me()
      .then((u) => {
        setMe(u);
        api.projects().then(setProjects).catch(() => {});
        if (roleTier(u.role) !== "STAFF") api.users().then(setUsers).catch(() => {});
        setLoading(false);
      })
      .catch(() => router.push("/login"));
  }, [router]);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  const key = (pid: number, d: string) => `${pid}:${d}`;

  // Giờ mỗi ô: "me" = giờ của targetUid; "team" = TỔNG giờ mọi người (có lọc phòng ban).
  const cellHours = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) {
      if (mode === "me") {
        if (e.user_id !== targetUid) continue;
      } else { // team mode
        if (deptUserIds && !deptUserIds.has(e.user_id)) continue;
      }
      const k = key(e.project_id, e.work_date);
      map.set(k, (map.get(k) ?? 0) + Number(e.hours));
    }
    return map;
  }, [entries, mode, targetUid, deptUserIds]);

  // Hàng = dự án. Chọn PHÒNG BAN -> chỉ hiện dự án của phòng đó (chủ trì HOẶC thành
  // viên thuộc phòng). Dự án có giờ trong tuần lên đầu.
  const rowProjects = useMemo(() => {
    const has = new Set(entries.map((e) => e.project_id));
    const inDept = (p: Project) => {
      if (!dept) return true;
      const leadDepts = (p.lead_department || "").split(",").map((s) => s.trim());
      if (leadDepts.includes(dept)) return true;
      return (p.members ?? []).some((m) =>
        (m.department || "").split(",").map((s) => s.trim()).includes(dept),
      );
    };
    return projects.filter(inDept).sort(
      (a, b) => (has.has(a.id) ? 0 : 1) - (has.has(b.id) ? 0 : 1) || a.name.localeCompare(b.name, "vi"),
    );
  }, [projects, entries, dept]);

  const cellValue = (pid: number, d: string) => {
    const k = key(pid, d);
    if (edits[k] !== undefined) return edits[k];
    const h = cellHours.get(k);
    return h ? num1(h) : "";
  };

  async function commitCell(pid: number, d: string) {
    const k = key(pid, d);
    if (edits[k] === undefined) return;
    const raw = edits[k].trim().replace(",", ".");
    const hours = raw === "" ? 0 : Number(raw);
    const cur = cellHours.get(k) ?? 0;
    setEdits((p) => { const n = { ...p }; delete n[k]; return n; });
    if (isNaN(hours) || hours < 0 || hours > 24 || hours === cur) return;
    try {
      await api.upsertTimesheet({ project_id: pid, work_date: d, hours, user_id: viewUserId ?? undefined });
      loadEntries();
    } catch { /* noop */ }
  }

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
  const stickyRight = "sticky right-0 z-10 border border-line";

  return (
    <AppShell maxWidthClass="max-w-md lg:max-w-none lg:px-4">
      <header className="flex items-center gap-2 rounded-xl2 bg-ink p-4 lg:p-6 text-white shadow-card">
        <ClockIcon className="h-5 w-5 text-amber" />
        <h1 className="text-base lg:text-xl font-bold">Nhân công theo ngày</h1>
      </header>

      <p className="mt-3 rounded-xl2 border border-line bg-white p-3 text-[11px] text-muted shadow-card">
        Mỗi ngày khai <b className="text-ink">số giờ thực tế</b> đã làm cho từng dự án. Bấm vào ô để gõ số giờ, tự lưu khi rời ô (để trống hoặc 0 = xóa).
        {isManager && <> Quản lý có thể chọn <b className="text-ink">xem/khai hộ 1 người</b> hoặc xem <b className="text-ink">Toàn đội</b> (tổng giờ, chỉ đọc).</>}
      </p>

      {/* Thanh điều khiển: tuần + chế độ + chọn người */}
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

        {isManager && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {/* Bộ lọc phòng ban */}
            <select
              value={dept}
              onChange={(e) => setDept(e.target.value)}
              className="rounded-lg border border-line bg-white px-2 py-1.5 text-xs outline-none focus:border-steel cursor-pointer"
            >
              <option value="">Tất cả phòng ban</option>
              {departments.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>

            <div className="flex items-center gap-1 rounded-lg border border-line p-0.5 text-xs">
              {(["me", "team"] as const).map((mo) => (
                <button
                  key={mo}
                  onClick={() => setMode(mo)}
                  className={`rounded px-2 py-1 font-semibold transition-colors duration-200 ${mode === mo ? "bg-ink text-white" : "text-muted hover:bg-paper"}`}
                >
                  {mo === "me" ? "Cá nhân" : "Toàn đội (tổng)"}
                </button>
              ))}
            </div>
            {mode === "me" && (
              <select
                value={viewUserId ?? me.id}
                onChange={(e) => setViewUserId(Number(e.target.value) === me.id ? null : Number(e.target.value))}
                className="rounded-lg border border-line bg-white px-2 py-1.5 text-xs outline-none focus:border-steel cursor-pointer"
              >
                <option value={me.id}>Tôi ({me.full_name})</option>
                {filteredUsers.filter((u) => u.id !== me.id).map((u) => (
                  <option key={u.id} value={u.id}>{u.full_name}</option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>

      {/* Lưới Dự án × Ngày */}
      <div className="mt-3 mr-14 overflow-auto max-h-[calc(100vh-340px)] rounded-xl2 border border-line bg-white shadow-card">
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="bg-slate-700 text-[10px] uppercase tracking-wide text-white">
              <th className={`${stickyLeft} sticky top-0 z-30 bg-slate-700 border border-slate-600 px-2 py-1.5 text-left font-semibold align-middle`}>Dự án</th>
              {days.map((d, i) => (
                <th key={d} className={`sticky top-0 z-20 border border-slate-600 px-0.5 py-1.5 text-center font-semibold whitespace-nowrap align-middle ${d === today ? "bg-amber text-white" : "bg-slate-700 text-slate-200"}`}>
                  <div>{DOW[i]}</div>
                  <div className="text-[9px] font-normal">{fmtDay(d)}</div>
                </th>
              ))}
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
              <tr><td colSpan={10} className="border border-line px-2 py-5 text-center text-muted">Chưa có dự án nào.</td></tr>
            ) : (
              rowProjects.map((p) => {
                const total = projTotal(p.id);
                return (
                  <tr key={p.id} className="odd:bg-white even:bg-sky-50/60 hover:bg-sky-100/50 transition-colors">
                    <td className={`${stickyLeft} bg-inherit px-2 py-1`}>
                      <span className="font-mono text-[9px] text-muted">{p.code}</span>
                      <span className="block max-w-[180px] truncate font-medium text-ink text-[11px]" title={p.name}>{p.name}</span>
                    </td>
                    {days.map((d) => (
                      <td key={d} className={`border border-line p-0 text-center ${d === today ? "bg-amber/10" : "bg-inherit"}`}>
                        {editable ? (
                          <input
                            type="text"
                            inputMode="decimal"
                            value={cellValue(p.id, d)}
                            onChange={(e) => setEdits((x) => ({ ...x, [key(p.id, d)]: e.target.value }))}
                            onBlur={() => commitCell(p.id, d)}
                            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                            placeholder="–"
                            className="h-7 w-full min-w-[32px] bg-transparent text-center text-[11px] text-ink outline-none placeholder:text-line focus:bg-steel/5"
                          />
                        ) : (
                          <span className={`block px-0.5 py-1 tnum ${cellHours.get(key(p.id, d)) ? "font-semibold text-ink" : "text-line"}`}>
                            {cellHours.get(key(p.id, d)) ? num1(cellHours.get(key(p.id, d))!) : "–"}
                          </span>
                        )}
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
