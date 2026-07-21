"use client";

// Bảng tiến độ ngày TRONG 1 DỰ ÁN — theo TỪNG NGƯỜI:
//   • Mỗi người là 1 dòng có thể BẤM SỔ RA các ĐẦU VIỆC ĐƯỢC GIAO cho họ.
//   • Mỗi đầu việc hiển thị % TIẾN ĐỘ + số GIỜ làm MỖI NGÀY (điền trực tiếp).
//   • Đầu việc chưa giao nằm ở nhóm "Chưa giao" — chọn người để giao ngay tại đây.
// Đầu việc lấy từ tab Hạng mục (project_items); giờ lưu theo (người, đầu việc, ngày).

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ClockIcon, ChevronLeftIcon, ChevronRightIcon, ChevronDownIcon, UserCircleIcon, StarIcon,
} from "@heroicons/react/24/outline";
import { CheckCircleIcon } from "@heroicons/react/24/solid";
import { api } from "@/lib/api";
import { dateLocal, todayLocal, formatDate } from "@/lib/format";
import type { ProjectItem, ProjectItemRating, Timesheet, User } from "@/lib/types";

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
  const [allEntries, setAllEntries] = useState<Timesheet[]>([]);
  const [items, setItems] = useState<ProjectItem[]>([]);
  const [workerRatings, setWorkerRatings] = useState<ProjectItemRating[]>([]);
  const [hourEdits, setHourEdits] = useState<Record<string, string>>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());   // item id -> đang thu gọn
  const [tempWorkers, setTempWorkers] = useState<Record<number, number[]>>({}); // item id -> user ids thêm tạm thời

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const today = todayLocal();
  const projStart = startDate ? startDate.slice(0, 10) : null;
  const projEnd = endDate ? endDate.slice(0, 10) : null;
  const dayDiff = (a: string, b: string) => {
    const [ay, am, ad] = a.split("-").map(Number);
    const [by, bm, bd] = b.split("-").map(Number);
    return Math.round((new Date(by, bm - 1, bd).getTime() - new Date(ay, am - 1, ad).getTime()) / 86_400_000);
  };
  const remaining = projEnd ? dayDiff(today, projEnd) : null;

  const loadItems = useCallback(() => {
    api.projectItems(projectId).then(setItems).catch(() => setItems([]));
  }, [projectId]);
  useEffect(() => { loadItems(); }, [loadItems]);

  const [weekEnd, setWeekEnd] = [days[6], null]; // just unused helper
  const loadEntries = useCallback(() => {
    api.timesheets({ from: weekStart, to: days[6], projectId })
      .then(setEntries)
      .catch(() => setEntries([]));
  }, [weekStart, days, projectId]);
  useEffect(() => { loadEntries(); }, [loadEntries]);

  const loadAllEntries = useCallback(() => {
    api.timesheets({ projectId })
      .then(setAllEntries)
      .catch(() => setAllEntries([]));
  }, [projectId]);
  useEffect(() => { loadAllEntries(); }, [loadAllEntries]);

  const loadWorkerRatings = useCallback(() => {
    api.projectItemRatings(projectId).then(setWorkerRatings).catch(() => setWorkerRatings([]));
  }, [projectId]);
  useEffect(() => { loadWorkerRatings(); }, [loadWorkerRatings]);

  async function rateWorker(itemId: number, userId: number, stars: number) {
    try {
      await api.upsertProjectItemRating({ project_item_id: itemId, user_id: userId, rating: stars });
      loadWorkerRatings();
    } catch { /* noop */ }
  }


  const nameOf = useCallback((uid: number): string => {
    const m = members.find((x) => x.id === uid);
    if (m) return m.full_name;
    const it = items.find((x) => x.assignee_id === uid && x.assignee_name);
    if (it?.assignee_name) return it.assignee_name;
    const e = entries.find((x) => x.user_id === uid && x.user_name);
    return e?.user_name ?? `#${uid}`;
  }, [members, items, entries]);

  const parentName = useMemo(() => {
    const map = new Map<number, string>();
    for (const i of items) if (i.parent_id == null) map.set(i.id, i.name);
    return map;
  }, [items]);

  // Sum of hours for a specific project_item_id and user_id from the start of project
  const workerAllTotal = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of allEntries) {
      if (e.project_item_id) {
        const key = `${e.user_id}-${e.project_item_id}`;
        map.set(key, (map.get(key) ?? 0) + Number(e.hours));
      }
    }
    return map;
  }, [allEntries]);

  // Sum of hours for a specific project_item_id from the start of project
  const taskAllTotal = useMemo(() => {
    const map = new Map<number, number>();
    for (const e of allEntries) {
      if (e.project_item_id) {
        map.set(e.project_item_id, (map.get(e.project_item_id) ?? 0) + Number(e.hours));
      }
    }
    return map;
  }, [allEntries]);
  
  const leaves = useMemo(() =>
    items.filter((i) => i.parent_id != null)
      .sort((a, b) => a.order_index - b.order_index || a.id - b.id),
    [items]);

  const taskWorkers = useCallback((it: ProjectItem): User[] => {
    const workerIds = new Set<number>();
    if (it.assignee_id != null) workerIds.add(it.assignee_id);
    for (const e of entries) if (e.project_item_id === it.id) workerIds.add(e.user_id);
    for (const uid of (tempWorkers[it.id] ?? [])) workerIds.add(uid);
    if (currentUserId != null && members.some(m => m.id === currentUserId)) workerIds.add(currentUserId);
    
    return Array.from(workerIds).map(uid => {
      const m = members.find(x => x.id === uid);
      if (m) return m;
      return { id: uid, full_name: nameOf(uid), role: "FIELD_STAFF", is_active: true, is_approved: true, company_id: projectId } as User;
    });
  }, [entries, tempWorkers, currentUserId, members, nameOf, projectId]);

  const hkey = (uid: number, itemId: number, d: string) => `${uid}:${itemId}:${d}`;
  const hoursMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) {
      if (e.project_item_id == null) continue;
      map.set(hkey(e.user_id, e.project_item_id, e.work_date), Number(e.hours));
    }
    return map;
  }, [entries]);

  const assigneeOptions = useMemo(() => {
    const map = new Map<number, string>();
    for (const m of members) map.set(m.id, m.full_name);
    for (const it of items) if (it.assignee_id != null && !map.has(it.assignee_id))
      map.set(it.assignee_id, it.assignee_name ?? nameOf(it.assignee_id));
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [members, items, nameOf]);

  const canEditHours = (uid: number) => canManage || uid === currentUserId;
  const hoursValue = (uid: number, itemId: number, d: string) => {
    const k = hkey(uid, itemId, d);
    if (hourEdits[k] !== undefined) return hourEdits[k];
    const h = hoursMap.get(k);
    return h ? num1(h) : "";
  };
  async function commitHours(uid: number, itemId: number, d: string) {
    const k = hkey(uid, itemId, d);
    if (hourEdits[k] === undefined) return;
    const raw = hourEdits[k].trim().replace(",", ".");
    const hours = raw === "" ? 0 : Number(raw);
    const cur = hoursMap.get(k) ?? 0;
    setHourEdits((p) => { const n = { ...p }; delete n[k]; return n; });
    if (isNaN(hours) || hours < 0 || hours > 24 || hours === cur) return;
    try {
      await api.upsertTimesheet({
        project_id: projectId, project_item_id: itemId, work_date: d, hours,
        user_id: uid !== currentUserId ? uid : undefined,
      });
      loadEntries();
      loadAllEntries();
    } catch { /* noop */ }
  }

  // Đánh dấu HOÀN THÀNH đầu việc — CHỈ người phụ trách chính (assignee) mới tích được.
  // Set done_date (so hạn nộp -> Đúng/Trễ hạn ở tab Hạng mục) + progress 100/0.
  async function toggleDone(it: ProjectItem) {
    try {
      await api.updateProjectItem(it.id, it.done_date
        ? { done_date: null, progress: 0 }
        : { done_date: dateLocal(new Date()), progress: 100 });
      loadItems();
    } catch { /* noop */ }
  }

  async function assign(it: ProjectItem, pid: number | null) {
    if (pid === (it.assignee_id ?? null)) return;
    try { await api.updateProjectItem(it.id, { assignee_id: pid }); loadItems(); } catch { /* noop */ }
  }

  const dayGrand = (d: string) => entries.filter(e => e.work_date === d && e.project_item_id != null).reduce((sum, e) => sum + Number(e.hours), 0);
  const grand = entries.filter(e => e.project_item_id != null).reduce((sum, e) => sum + Number(e.hours), 0);

  const isOpen = (k: number) => !collapsed.has(String(k));
  const toggle = (k: number) =>
    setCollapsed((s) => { const n = new Set(s); const key = String(k); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const COLS = 1 + 1 + 7 + 1;

  return (
    <div className="rounded-xl2 border border-line/40 bg-white p-3.5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase text-muted">
          <ClockIcon className="h-4 w-4 text-steel" />
          Tiến độ theo đầu việc · người tham gia làm (giờ/ngày)
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
        ) : " · chưa đặt hạn"}
        <span className="text-muted/70"> · bấm tên đầu việc để sổ ra danh sách người làm; điền số giờ vào ô là tự lưu.</span>
      </p>

      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-xs">
          <thead>
            <tr className="bg-paper text-[10px] uppercase tracking-wide text-muted">
              <th className="sticky left-0 z-10 border border-line bg-paper px-2 py-1.5 text-left font-semibold">Đầu việc / Người làm</th>
              <th className="border border-line px-1 py-1 text-center font-semibold"><div>Trạng thái</div><div className="text-[9px] font-normal">/ Đánh giá</div></th>
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
            {leaves.length === 0 ? (
              <tr><td colSpan={COLS} className="border border-line px-3 py-5 text-center text-muted">
                Chưa có đầu việc — thêm ở tab <b>Hạng mục</b>.
              </td></tr>
            ) : (
              leaves.map((it) => {
                const open = isOpen(it.id);
                const workers = taskWorkers(it);
                const grp = it.parent_id != null ? parentName.get(it.parent_id) : null;
                const tDayHours = (d: string) => workers.reduce((sum, w) => sum + (hoursMap.get(hkey(w.id, it.id, d)) ?? 0), 0);
                const tTotalHours = days.reduce((sum, d) => sum + tDayHours(d), 0);
                return (
                  <FragmentRows key={it.id}>
                    <tr className="cursor-pointer bg-ink/5 font-semibold text-ink hover:brightness-95" onClick={() => toggle(it.id)}>
                      <td className="sticky left-0 z-10 border border-line bg-inherit px-2 py-1.5">
                        <span className="flex items-center gap-1.5">
                          {open ? <ChevronDownIcon className="h-3.5 w-3.5 shrink-0" /> : <ChevronRightIcon className="h-3.5 w-3.5 shrink-0" />}
                          <div className="max-w-[240px] truncate" title={it.name}>{it.name || <span className="italic text-muted">(chưa đặt tên)</span>}</div>
                          {grp && <span className="text-[9px] font-normal text-muted">({grp})</span>}
                          <span className="ml-1 rounded-full bg-white/70 px-1.5 text-[9px] font-semibold text-muted">{workers.length}</span>
                        </span>
                      </td>
                      <td className="border border-line px-1 py-1.5 text-center" onClick={(e) => e.stopPropagation()}>
                        {(() => {
                          const done = !!it.done_date;
                          const canTick = it.assignee_id != null && it.assignee_id === currentUserId;
                          return (
                            <button
                              type="button"
                              disabled={!canTick}
                              onClick={() => toggleDone(it)}
                              title={done ? "Đã xong — bấm để bỏ" : canTick ? "Đánh dấu đã xong" : "Chỉ người phụ trách chính mới tích được"}
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold transition-colors ${done ? "bg-ok/15 text-ok" : "bg-line/50 text-muted"} ${canTick ? "cursor-pointer hover:brightness-95" : "cursor-default"}`}
                            >
                              {done ? <CheckCircleIcon className="h-4 w-4" /> : <span className="h-3 w-3 rounded-full border-2 border-current" />}
                              {done ? "Đã xong" : "Chưa xong"}
                            </button>
                          );
                        })()}
                      </td>
                      {days.map((d) => {
                        const v = tDayHours(d);
                        return <td key={d} className={`border border-line px-1 py-1.5 text-center tnum font-semibold text-steel ${d === today ? "bg-amber/10" : ""}`}>{v > 0 ? num1(v) : ""}</td>;
                      })}
                      {(() => {
                        const tAllHours = taskAllTotal.get(it.id) ?? 0;
                        return (
                          <td className="border border-line px-2 py-1.5 text-center tnum text-amber-deep font-bold">
                            {tAllHours > 0 ? num1(tAllHours) : "–"}
                          </td>
                        );
                      })()}
                    </tr>
                    {open && (
                      <>
                        {workers.map((w) => {
                          const wTotal = days.reduce((sum, d) => sum + (hoursMap.get(hkey(w.id, it.id, d)) ?? 0), 0);
                          const isMainAssignee = it.assignee_id === w.id;
                          return (
                            <tr key={w.id} className="odd:bg-white even:bg-paper/40">
                              <td className="sticky left-0 z-10 border border-line bg-inherit px-2 py-1.5 pl-6">
                                <div className="flex items-center gap-1.5 text-ink/90">
                                  <UserCircleIcon className="h-3.5 w-3.5 shrink-0 text-steel" />
                                  <span className="truncate">{w.full_name}</span>
                                  {isMainAssignee && <StarIcon className="h-3 w-3 text-amber fill-amber animate-pulse" title="Người phụ trách chính" />}
                                  {w.id === currentUserId && <span className="text-[9px] text-muted">(tôi)</span>}
                                </div>
                              </td>
                              <td className="border border-line px-1 py-1.5 text-center">
                                {(() => {
                                  const wDone = (workerRatings.find(r => r.project_item_id === it.id && r.user_id === w.id)?.rating ?? 0) > 0;
                                  const canTick = w.id === currentUserId;   // mỗi người tự tích phần của mình
                                  return (
                                    <button
                                      type="button"
                                      disabled={!canTick}
                                      onClick={() => rateWorker(it.id, w.id, wDone ? 0 : 1)}
                                      title={wDone ? "Đã xong — bấm để bỏ" : canTick ? "Đánh dấu phần của bạn đã xong" : "Chưa xong"}
                                      className={`inline-flex items-center justify-center transition-colors ${wDone ? "text-ok" : "text-line"} ${canTick ? "cursor-pointer hover:text-ok" : "cursor-default"}`}
                                    >
                                      {wDone ? <CheckCircleIcon className="h-5 w-5" /> : <span className="h-4 w-4 rounded-full border-2 border-current" />}
                                    </button>
                                  );
                                })()}
                              </td>
                              {days.map((d) => {
                                const v = hoursMap.get(hkey(w.id, it.id, d)) ?? 0;
                                return (
                                  <td key={d} className={`border border-line p-0 text-center ${v > 0 ? "bg-ok/15" : d === today ? "bg-amber/10" : d > today ? "bg-line/20" : ""}`}>
                                    {/* Chỉ cho nhập giờ ngày HÔM NAY & các ngày ĐÃ QUA; ngày mai trở đi không nhập được. */}
                                    {canEditHours(w.id) && d <= today ? (
                                      <input type="text" inputMode="decimal" value={hoursValue(w.id, it.id, d)} onChange={(e) => setHourEdits((x) => ({ ...x, [hkey(w.id, it.id, d)]: e.target.value }))} onBlur={() => commitHours(w.id, it.id, d)} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} placeholder="–" className="h-7 w-full min-w-[38px] bg-transparent text-center text-xs text-ink outline-none placeholder:text-line focus:bg-steel/5" />
                                    ) : (
                                      <span className={`block px-1 py-1 tnum ${v > 0 ? "font-semibold text-ink" : "text-line"}`} title={d > today ? "Chưa tới ngày — chưa nhập được" : undefined}>{v > 0 ? num1(v) : "–"}</span>
                                    )}
                                  </td>
                                );
                              })}
                              {(() => {
                                const wAllHours = workerAllTotal.get(`${w.id}-${it.id}`) ?? 0;
                                return (
                                  <td className={`border border-line px-2 py-1.5 text-center font-bold tnum ${wAllHours > 0 ? "text-steel" : "text-muted"}`}>
                                    {wAllHours > 0 ? num1(wAllHours) : "–"}
                                  </td>
                                );
                              })()}
                            </tr>
                          );
                        })}
                        {members.length > 0 && (
                          <tr className="bg-paper/20">
                            <td colSpan={COLS} className="border border-line px-6 py-1">
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] text-muted">Thêm người làm việc này:</span>
                                <select value="" onChange={(e) => { const val = e.target.value; if (val) { const uid = Number(val); setTempWorkers(prev => { const curr = prev[it.id] ?? []; if (curr.includes(uid)) return prev; return { ...prev, [it.id]: [...curr, uid] }; }); } }} className="rounded border border-line bg-white px-1.5 py-0.5 text-[10px] text-muted outline-none focus:border-steel cursor-pointer">
                                  <option value="">— Chọn người —</option>
                                  {members.filter(m => !workers.some(w => w.id === m.id)).map(m => (<option key={m.id} value={m.id}>{m.full_name}</option>))}
                                </select>
                                {canManage && (
                                  <>
                                    <span className="text-[10px] text-muted ml-4">Đặt người phụ trách chính:</span>
                                    <select value={it.assignee_id ?? ""} onChange={(e) => assign(it, e.target.value === "" ? null : Number(e.target.value))} className="rounded border border-line bg-white px-1.5 py-0.5 text-[10px] text-muted outline-none focus:border-steel cursor-pointer">
                                      <option value="">— Chưa chọn —</option>
                                      {assigneeOptions.map((o) => (<option key={o.id} value={o.id}>{o.name}</option>))}
                                    </select>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    )}
                  </FragmentRows>
                );
              })
            )}
          </tbody>
          {leaves.length > 0 && (
            <tfoot>
              <tr className="bg-ink/10 font-bold text-ink">
                <td className="sticky left-0 z-10 border border-line bg-ink/10 px-2 py-1.5 text-right">Tổng ngày</td>
                <td className="border border-line" />
                {days.map((d) => { const t = dayGrand(d); return <td key={d} className="border border-line px-1 py-1.5 text-center tnum">{t > 0 ? num1(t) : "–"}</td>; })}
                <td className="border border-line px-2 py-1.5 text-center text-amber-deep tnum">{grand > 0 ? num1(grand) : "–"}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="mt-1.5 text-[11px] text-muted">
        <b className="text-ink">Đã xong</b> (dòng đầu việc) = người phụ trách chính đánh dấu hoàn thành → liên kết cột &quot;Đúng hạn&quot; ở tab Hạng mục.
        {" "}Mỗi người tự tích <b className="text-ok">✓</b> phần việc của mình ở dòng bên dưới.
        Bấm tên đầu việc để mở rộng danh sách người làm.
      </p>
    </div>
  );
}

// Cho phép trả về nhiều <tr> trong .map mà không chèn thẻ bọc sai chỗ trong <tbody>.
function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
