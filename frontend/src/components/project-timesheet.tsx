"use client";

// Bảng tiến độ ngày TRONG 1 DỰ ÁN — HÀNG = HẠNG MỤC & ĐẦU VIỆC (kéo từ tab Hạng mục
// sang), CỘT = ngày trong tuần, Ô = số GIỜ THỰC TẾ làm cho đầu việc đó trong ngày.
//  - Nhân viên: điền giờ của MÌNH cho từng đầu việc.
//  - Quản lý/chủ trì: chọn xem/điền giờ theo TỪNG NGƯỜI, hoặc xem tổng CẢ NHÓM (chỉ xem).
// Nhóm (hạng mục) hiển thị dòng tiêu đề + tự cộng dồn giờ các đầu việc con.

import { useCallback, useEffect, useMemo, useState } from "react";
import { ClockIcon, ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { api } from "@/lib/api";
import { dateLocal, todayLocal, formatDate } from "@/lib/format";
import type { ProjectItem, Timesheet, User } from "@/lib/types";

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

// "team" = xem tổng cả nhóm (chỉ xem); số = 1 người cụ thể.
type ViewSel = number | "team";

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
  const [items, setItems] = useState<ProjectItem[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  // Ai đang xem/điền: mặc định chính mình; quản lý có thể đổi người / xem cả nhóm.
  const [view, setView] = useState<ViewSel>(() => currentUserId ?? "team");

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

  useEffect(() => {
    if (view === "team" && currentUserId != null && !canManage) setView(currentUserId);
  }, [currentUserId, canManage, view]);

  // Hạng mục/đầu việc — nguồn HÀNG của bảng (kéo từ tab Hạng mục sang).
  useEffect(() => {
    api.projectItems(projectId).then(setItems).catch(() => setItems([]));
  }, [projectId]);

  const load = useCallback(() => {
    // Không lọc user_id: quản lý nhận cả nhóm (tự lọc phía dưới), nhân viên chỉ nhận của mình.
    api.timesheets({ from: weekStart, to: weekEnd, projectId })
      .then(setEntries)
      .catch(() => setEntries([]));
  }, [weekStart, weekEnd, projectId]);
  useEffect(() => { load(); }, [load]);

  // Danh sách người để quản lý chọn (thành viên ∪ ai đã khai giờ).
  const people = useMemo(() => {
    const map = new Map<number, string>();
    for (const m of members) map.set(m.id, m.full_name);
    for (const e of entries) if (!map.has(e.user_id)) map.set(e.user_id, e.user_name ?? `#${e.user_id}`);
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [members, entries]);

  // Dựng HÀNG: mỗi hạng mục (nhóm) -> 1 dòng tiêu đề + các đầu việc con. Nhóm không có
  // con thì cho điền giờ ngay trên dòng nhóm (đầu việc lẻ ở cấp trên cùng).
  const rows = useMemo(() => {
    const groups = items.filter((i) => i.parent_id == null).sort((a, b) => a.order_index - b.order_index);
    const out: { item: ProjectItem; isGroup: boolean; editable: boolean }[] = [];
    for (const g of groups) {
      const kids = items.filter((i) => i.parent_id === g.id).sort((a, b) => a.order_index - b.order_index);
      out.push({ item: g, isGroup: true, editable: kids.length === 0 });
      for (const k of kids) out.push({ item: k, isGroup: false, editable: true });
    }
    return out;
  }, [items]);
  const childrenOf = useCallback(
    (gid: number) => items.filter((i) => i.parent_id === gid).sort((a, b) => a.order_index - b.order_index),
    [items],
  );

  // Ô giờ theo góc nhìn hiện tại: 1 người -> giờ của người đó; "team" -> tổng mọi người.
  const key = (itemId: number, d: string) => `${itemId}:${d}`;
  const hoursMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) {
      if (e.project_item_id == null) continue;               // bỏ giờ cấp dự án (không gắn đầu việc)
      if (view !== "team" && e.user_id !== view) continue;    // lọc theo người đang xem
      const k = key(e.project_item_id, e.work_date);
      map.set(k, (map.get(k) ?? 0) + Number(e.hours));
    }
    return map;
  }, [entries, view]);

  // Chỉ điền được khi đang xem 1 người cụ thể (không phải "team") và có quyền.
  const editingUid = view === "team" ? null : view;
  const canEdit = editingUid != null && (canManage || editingUid === currentUserId);

  const cellValue = (itemId: number, d: string) => {
    const k = key(itemId, d);
    if (edits[k] !== undefined) return edits[k];
    const h = hoursMap.get(k);
    return h ? num1(h) : "";
  };

  async function commit(itemId: number, d: string) {
    const k = key(itemId, d);
    if (edits[k] === undefined) return;
    const raw = edits[k].trim().replace(",", ".");
    const hours = raw === "" ? 0 : Number(raw);
    const cur = hoursMap.get(k) ?? 0;
    setEdits((p) => { const n = { ...p }; delete n[k]; return n; });
    if (editingUid == null || isNaN(hours) || hours < 0 || hours > 24 || hours === cur) return;
    try {
      await api.upsertTimesheet({
        project_id: projectId, project_item_id: itemId, work_date: d, hours,
        user_id: editingUid !== currentUserId ? editingUid : undefined,
      });
      load();
    } catch { /* noop */ }
  }

  // Cộng dồn: nhóm = tổng đầu việc con; ngày = tổng các đầu việc (dòng điền được).
  const groupDayTotal = (gid: number, d: string) =>
    childrenOf(gid).reduce((s, k) => s + (hoursMap.get(key(k.id, d)) ?? 0), 0);
  const rowDayValue = (r: { item: ProjectItem; isGroup: boolean; editable: boolean }, d: string) =>
    r.isGroup && !r.editable ? groupDayTotal(r.item.id, d) : (hoursMap.get(key(r.item.id, d)) ?? 0);
  const rowTotal = (r: { item: ProjectItem; isGroup: boolean; editable: boolean }) =>
    days.reduce((s, d) => s + rowDayValue(r, d), 0);
  const dayTotal = (d: string) =>
    rows.reduce((s, r) => s + (r.editable ? (hoursMap.get(key(r.item.id, d)) ?? 0) : 0), 0);
  const grand = days.reduce((s, d) => s + dayTotal(d), 0);

  return (
    <div className="rounded-xl2 border border-line/40 bg-white p-3.5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase text-muted">
          <ClockIcon className="h-4 w-4 text-steel" />
          Bảng tiến độ ngày · giờ theo đầu việc
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

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        {canManage ? (
          <label className="flex items-center gap-1.5 text-[11px] text-muted">
            <span className="font-semibold uppercase">Giờ của</span>
            <select
              value={String(view)}
              onChange={(e) => setView(e.target.value === "team" ? "team" : Number(e.target.value))}
              className="rounded-lg border border-line bg-white px-2 py-1 text-[11px] font-semibold text-ink outline-none focus:border-steel"
            >
              {currentUserId != null && <option value={currentUserId}>Tôi</option>}
              {people.filter((p) => p.id !== currentUserId).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
              <option value="team">Cả nhóm (tổng · chỉ xem)</option>
            </select>
          </label>
        ) : (
          <span className="text-[11px] text-muted">Đang điền giờ của <b className="text-ink">bạn</b>.</span>
        )}
        <p className="text-[11px] text-muted">
          {projStart ? <>Bắt đầu <b className="text-ink">{formatDate(projStart)}</b></> : "Chưa đặt ngày bắt đầu"}
          {projEnd ? (
            <>
              {" · "}hạn <b className="text-ink">{formatDate(projEnd)}</b>
              {remaining !== null && (remaining >= 0
                ? <> — còn <b className="text-amber-deep tnum">{remaining}</b> ngày</>
                : <> — <b className="text-bad">quá hạn {-remaining} ngày</b></>)}
            </>
          ) : " · chưa đặt hạn"}
        </p>
      </div>

      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[620px] border-collapse text-xs">
          <thead>
            <tr className="bg-paper text-[10px] uppercase tracking-wide text-muted">
              <th className="sticky left-0 z-10 border border-line bg-paper px-2 py-1.5 text-left font-semibold">Hạng mục / Đầu việc</th>
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
            {rows.length === 0 ? (
              <tr><td colSpan={9} className="border border-line px-3 py-5 text-center text-muted">
                Chưa có hạng mục — thêm đầu việc ở tab <b>Hạng mục</b> để điền giờ.
              </td></tr>
            ) : (
              rows.map((r) => {
                const total = rowTotal(r);
                const groupHead = r.isGroup && !r.editable;   // nhóm có đầu việc con -> tiêu đề cộng dồn
                return (
                  <tr key={r.item.id} className={groupHead ? "bg-steel/5" : "odd:bg-white even:bg-paper/40"}>
                    <td
                      className={`sticky left-0 z-10 max-w-[200px] truncate border border-line bg-inherit px-2 py-1.5 ${
                        r.isGroup ? "font-bold text-ink" : "pl-5 font-medium text-ink/90"
                      }`}
                      title={r.item.name}
                    >
                      {!r.isGroup && <span className="text-line">– </span>}{r.item.name}
                    </td>
                    {days.map((d) => {
                      const v = rowDayValue(r, d);
                      if (groupHead) {
                        return (
                          <td key={d} className={`border border-line px-1 py-1.5 text-center tnum font-semibold ${v > 0 ? "text-steel" : "text-line"} ${d === today ? "bg-amber/10" : ""}`}>
                            {v > 0 ? num1(v) : ""}
                          </td>
                        );
                      }
                      return (
                        <td key={d} className={`border border-line p-0 text-center ${v > 0 ? "bg-ok/15" : d === today ? "bg-amber/10" : ""}`}>
                          {canEdit ? (
                            <input
                              type="text"
                              inputMode="decimal"
                              value={cellValue(r.item.id, d)}
                              onChange={(e) => setEdits((x) => ({ ...x, [key(r.item.id, d)]: e.target.value }))}
                              onBlur={() => commit(r.item.id, d)}
                              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                              placeholder="–"
                              className="h-7 w-full min-w-[38px] bg-transparent text-center text-xs text-ink outline-none placeholder:text-line focus:bg-steel/5"
                            />
                          ) : (
                            <span className={`block px-1 py-1 tnum ${v > 0 ? "font-semibold text-ink" : "text-line"}`}>
                              {v > 0 ? num1(v) : "–"}
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className={`border border-line px-2 py-1.5 text-center font-bold tnum ${total > 0 ? "text-steel" : "text-muted"}`}>
                      {total > 0 ? num1(total) : "–"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {rows.length > 0 && (
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
          )}
        </table>
      </div>
      <p className="mt-1.5 text-[11px] text-muted">
        Điền số giờ vào ô đầu việc là tự lưu. Dòng <b className="text-ink">hạng mục</b> (in đậm) tự cộng dồn giờ các đầu việc con.
      </p>
    </div>
  );
}
