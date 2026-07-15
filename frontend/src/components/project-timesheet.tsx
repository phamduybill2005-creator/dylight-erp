"use client";

// Nhân công theo ngày TRONG 1 DỰ ÁN — lưới Người × Ngày = số GIỜ THỰC TẾ đã làm cho
// dự án này, theo tuần. Mỗi người sửa được ô của MÌNH; Quản lý/chủ trì sửa được mọi người.

import { useCallback, useEffect, useMemo, useState } from "react";
import { ClockIcon, ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { api } from "@/lib/api";
import { dateLocal, todayLocal, formatDate } from "@/lib/format";
import type { Timesheet, User } from "@/lib/types";

function mondayOf(d: string): string {
  const [y, m, dd] = d.split("-").map(Number);
  const x = new Date(y, m - 1, dd);
  const wd = x.getDay();
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

export default function ProjectTimesheet({
  projectId,
  members,
  currentUserId,
  canManage,
  startDate = null,
  endDate = null,
}: {
  projectId: number;
  members: User[];
  currentUserId: number | null;
  canManage: boolean;
  startDate?: string | null;
  endDate?: string | null;
}) {
  const [weekStart, setWeekStart] = useState(() => mondayOf(todayLocal()));
  const [entries, setEntries] = useState<Timesheet[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const weekEnd = days[6];
  const today = todayLocal();
  const projStart = startDate ? startDate.slice(0, 10) : null;
  const projEnd = endDate ? endDate.slice(0, 10) : null;
  const dayDiff = (a: string, b: string) => {
    const [ay, am, ad] = a.split("-").map(Number);
    const [by, bm, bd] = b.split("-").map(Number);
    return Math.round((new Date(by, bm - 1, bd).getTime() - new Date(ay, am - 1, ad).getTime()) / 86_400_000);
  };
  const remaining = projEnd ? dayDiff(today, projEnd) : null;

  const load = useCallback(() => {
    api.timesheets({ from: weekStart, to: weekEnd, projectId })
      .then(setEntries)
      .catch(() => setEntries([]));
  }, [weekStart, weekEnd, projectId]);
  useEffect(() => { load(); }, [load]);

  // Hàng = người. Nhân viên: chỉ hàng của mình. Quản lý: thành viên ∪ ai đã khai giờ.
  const people = useMemo(() => {
    if (!canManage) {
      if (!currentUserId) return [];
      return [{ id: currentUserId, name: members.find((m) => m.id === currentUserId)?.full_name ?? "Tôi" }];
    }
    const map = new Map<number, string>();
    for (const m of members) map.set(m.id, m.full_name);
    for (const e of entries) if (!map.has(e.user_id)) map.set(e.user_id, e.user_name ?? `#${e.user_id}`);
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [members, entries, canManage, currentUserId]);

  const key = (uid: number, d: string) => `${uid}:${d}`;
  const hoursMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) map.set(key(e.user_id, e.work_date), Number(e.hours));
    return map;
  }, [entries]);

  const canEditRow = (uid: number) => canManage || uid === currentUserId;
  const cellValue = (uid: number, d: string) => {
    const k = key(uid, d);
    if (edits[k] !== undefined) return edits[k];
    const h = hoursMap.get(k);
    return h ? num1(h) : "";
  };

  async function commit(uid: number, d: string) {
    const k = key(uid, d);
    if (edits[k] === undefined) return;
    const raw = edits[k].trim().replace(",", ".");
    const hours = raw === "" ? 0 : Number(raw);
    const cur = hoursMap.get(k) ?? 0;
    setEdits((p) => { const n = { ...p }; delete n[k]; return n; });
    if (isNaN(hours) || hours < 0 || hours > 24 || hours === cur) return;
    try {
      await api.upsertTimesheet({
        project_id: projectId, work_date: d, hours,
        user_id: uid !== currentUserId ? uid : undefined,
      });
      load();
    } catch { /* noop */ }
  }

  const rowTotal = (uid: number) => days.reduce((s, d) => s + (hoursMap.get(key(uid, d)) ?? 0), 0);
  const dayTotal = (d: string) => people.reduce((s, p) => s + (hoursMap.get(key(p.id, d)) ?? 0), 0);
  const grand = days.reduce((s, d) => s + dayTotal(d), 0);

  return (
    <div className="rounded-xl2 border border-line/40 bg-white p-3.5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase text-muted">
          <ClockIcon className="h-4 w-4 text-steel" />
          Bảng tiến độ ngày · nhân công (giờ)
        </h3>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setWeekStart(addDays(weekStart, -7))} className="rounded-lg border border-line p-1 text-muted hover:bg-paper" title="Tuần trước">
            <ChevronLeftIcon className="h-4 w-4" />
          </button>
          <span className="text-[11px] font-semibold text-ink">{fmtDay(weekStart)} – {fmtDay(weekEnd)}</span>
          <button onClick={() => setWeekStart(addDays(weekStart, 7))} className="rounded-lg border border-line p-1 text-muted hover:bg-paper" title="Tuần sau">
            <ChevronRightIcon className="h-4 w-4" />
          </button>
          <button onClick={() => setWeekStart(mondayOf(today))} className="rounded-lg border border-line px-2 py-1 text-[11px] font-semibold text-steel hover:bg-paper">
            Tuần này
          </button>
        </div>
      </div>

      <p className="mt-1 text-[11px] text-muted">
        {projStart ? <>Bắt đầu <b className="text-ink">{formatDate(projStart)}</b></> : "Chưa đặt ngày bắt đầu"}
        {projEnd ? (
          <>
            {" · "}hạn <b className="text-ink">{formatDate(projEnd)}</b>
            {remaining !== null && (remaining >= 0
              ? <> — còn <b className="text-amber-deep tnum">{remaining}</b> ngày</>
              : <> — <b className="text-bad">quá hạn {-remaining} ngày</b></>)}
          </>
        ) : " · chưa đặt hạn (vào Sửa dự án)"}
        <span className="text-muted/70"> · chỉ cần điền số giờ vào ô là tự chạy.</span>
      </p>

      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-xs">
          <thead>
            <tr className="bg-paper text-[10px] uppercase tracking-wide text-muted">
              <th className="sticky left-0 z-10 border border-line bg-paper px-2 py-1.5 text-left font-semibold">Người</th>
              {days.map((d, i) => (
                <th key={d} className={`border border-line px-1 py-1 text-center font-semibold ${d === today ? "bg-amber text-white" : ""}`}>
                  <div>{DOW[i]}</div>
                  <div className="text-[9px] font-normal">{fmtDay(d)}</div>
                </th>
              ))}
              <th className="border border-line px-2 py-1.5 text-center font-semibold">Tổng</th>
            </tr>
          </thead>
          <tbody>
            {people.length === 0 ? (
              <tr><td colSpan={9} className="border border-line px-3 py-5 text-center text-muted">Chưa có ai trong dự án.</td></tr>
            ) : (
              people.map((p) => {
                const total = rowTotal(p.id);
                return (
                  <tr key={p.id} className="odd:bg-white even:bg-paper/40">
                    <td className="sticky left-0 z-10 max-w-[140px] truncate border border-line bg-inherit px-2 py-1.5 font-medium text-ink" title={p.name}>
                      {p.name}{p.id === currentUserId && <span className="text-[9px] text-muted"> (tôi)</span>}
                    </td>
                    {days.map((d) => (
                      <td key={d} className={`border border-line p-0 text-center ${(hoursMap.get(key(p.id, d)) ?? 0) > 0 ? "bg-ok/15" : d === today ? "bg-amber/10" : ""}`}>
                        {canEditRow(p.id) ? (
                          <input
                            type="text"
                            inputMode="decimal"
                            value={cellValue(p.id, d)}
                            onChange={(e) => setEdits((x) => ({ ...x, [key(p.id, d)]: e.target.value }))}
                            onBlur={() => commit(p.id, d)}
                            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                            placeholder="–"
                            className="h-7 w-full min-w-[38px] bg-transparent text-center text-xs text-ink outline-none placeholder:text-line focus:bg-steel/5"
                          />
                        ) : (
                          <span className={`block px-1 py-1 tnum ${hoursMap.get(key(p.id, d)) ? "font-semibold text-ink" : "text-line"}`}>
                            {hoursMap.get(key(p.id, d)) ? num1(hoursMap.get(key(p.id, d))!) : "–"}
                          </span>
                        )}
                      </td>
                    ))}
                    <td className={`border border-line px-2 py-1.5 text-center font-bold tnum ${total > 0 ? "text-steel" : "text-muted"}`}>
                      {total > 0 ? num1(total) : "–"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          <tfoot>
            <tr className="bg-ink/5 font-bold text-ink">
              <td className="sticky left-0 z-10 border border-line bg-ink/5 px-2 py-1.5 text-right">Tổng ngày</td>
              {days.map((d) => {
                const t = dayTotal(d);
                return <td key={d} className="border border-line px-1 py-1.5 text-center tnum">{t > 0 ? num1(t) : "–"}</td>;
              })}
              <td className="border border-line px-2 py-1.5 text-center text-amber-deep tnum">{grand > 0 ? num1(grand) : "–"}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
