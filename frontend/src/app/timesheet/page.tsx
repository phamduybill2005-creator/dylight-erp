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
  const [viewUserId, setViewUserId] = useState<number | null>(null); // quản lý: khai/xem hộ 1 người
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [dept, setDept] = useState<string>("");

  const isManager = me ? roleTier(me.role) !== "STAFF" : false;
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const weekEnd = days[6];
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

  // Hàng = dự án; dự án có giờ trong tuần lên đầu.
  const rowProjects = useMemo(() => {
    const has = new Set(entries.map((e) => e.project_id));
    return [...projects].sort(
      (a, b) => (has.has(a.id) ? 0 : 1) - (has.has(b.id) ? 0 : 1) || a.name.localeCompare(b.name, "vi"),
    );
  }, [projects, entries]);

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
                  {mo === "me" ? "1 người" : "Toàn đội (tổng)"}
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
      <div className="mt-3 overflow-auto max-h-[calc(100vh-280px)] rounded-xl2 border border-line bg-white shadow-card">
        <table className="min-w-[720px] w-full border-collapse text-xs">
          <thead>
            <tr className="bg-paper text-[11px] uppercase tracking-wide text-muted">
              <th className={`${stickyLeft} sticky top-0 z-30 bg-paper px-3 py-2 text-left font-semibold`}>Dự án</th>
              {days.map((d, i) => (
                <th key={d} className={`sticky top-0 z-20 border border-line px-1 py-2 text-center font-semibold ${d === today ? "bg-amber text-white" : "bg-paper text-muted"}`}>
                  <div>{DOW[i]}</div>
                  <div className="text-[10px] font-normal">{fmtDay(d)}</div>
                </th>
              ))}
              <th className={`${stickyRight} sticky top-0 z-30 bg-paper px-2 py-2 text-center font-semibold`} style={{right: 60}}>人工<br />(giờ)</th>
              <th className={`${stickyRight} sticky top-0 z-30 bg-paper px-2 py-2 text-center font-semibold`}>Ngày<br />công</th>
            </tr>
          </thead>
          <tbody>
            {rowProjects.length === 0 ? (
              <tr><td colSpan={10} className="border border-line px-3 py-6 text-center text-muted">Chưa có dự án nào.</td></tr>
            ) : (
              rowProjects.map((p) => {
                const total = projTotal(p.id);
                return (
                  <tr key={p.id} className="odd:bg-white even:bg-slate-50">
                    <td className={`${stickyLeft} bg-inherit px-3 py-1.5`}>
                      <span className="font-mono text-[10px] text-muted">{p.code}</span>
                      <span className="block max-w-[220px] truncate font-medium text-ink" title={p.name}>{p.name}</span>
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
                            className="h-8 w-full min-w-[40px] bg-transparent text-center text-xs text-ink outline-none placeholder:text-line focus:bg-steel/5"
                          />
                        ) : (
                          <span className={`block px-1 py-1.5 tnum ${cellHours.get(key(p.id, d)) ? "font-semibold text-ink" : "text-line"}`}>
                            {cellHours.get(key(p.id, d)) ? num1(cellHours.get(key(p.id, d))!) : "–"}
                          </span>
                        )}
                      </td>
                    ))}
                    <td className={`${stickyRight} bg-inherit px-2 py-1.5 text-center font-bold tnum ${total > 0 ? "text-steel" : "text-muted"}`} style={{right: 60}}>
                      {total > 0 ? num1(total) : "–"}
                    </td>
                    <td className={`${stickyRight} bg-inherit px-2 py-1.5 text-center font-bold tnum ${total > 0 ? "text-ink" : "text-muted"}`}>
                      {total > 0 ? num1(total / 8) : "–"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          <tfoot>
            <tr className="bg-slate-100 font-bold text-ink">
              <td className={`${stickyLeft} bg-slate-100 px-3 py-2 text-right sticky bottom-0 z-30 border-t border-line`}>Tổng ngày</td>
              {days.map((d) => {
                const t = dayTotal(d);
                return (
                  <td key={d} className="border border-line bg-slate-100 px-1 py-2 text-center tnum sticky bottom-0 z-20 border-t border-line">
                    {t > 0 ? num1(t) : "–"}
                  </td>
                );
              })}
              <td className={`${stickyRight} bg-slate-100 px-2 py-2 text-center text-amber-deep tnum sticky bottom-0 z-30 border-t border-line`} style={{right: 60}}>
                {grandTotal > 0 ? num1(grandTotal) : "–"}
              </td>
              <td className={`${stickyRight} bg-slate-100 px-2 py-2 text-center text-emerald-600 font-extrabold tnum sticky bottom-0 z-30 border-t border-line`}>
                {grandTotal > 0 ? num1(grandTotal / 8) : "–"}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </AppShell>
  );
}
