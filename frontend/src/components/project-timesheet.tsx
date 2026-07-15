"use client";

// Bảng tiến độ ngày TRONG 1 DỰ ÁN — theo TỪNG NGƯỜI:
//   • Mỗi người là 1 dòng có thể BẤM SỔ RA các ĐẦU VIỆC ĐƯỢC GIAO cho họ.
//   • Mỗi đầu việc hiển thị % TIẾN ĐỘ + số GIỜ làm MỖI NGÀY (điền trực tiếp).
//   • Đầu việc chưa giao nằm ở nhóm "Chưa giao" — chọn người để giao ngay tại đây.
// Đầu việc lấy từ tab Hạng mục (project_items); giờ lưu theo (người, đầu việc, ngày).

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ClockIcon, ChevronLeftIcon, ChevronRightIcon, ChevronDownIcon, UserCircleIcon,
} from "@heroicons/react/24/outline";
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
const UNASSIGNED = "unassigned" as const;
type PersonKey = number | typeof UNASSIGNED;

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
  const [hourEdits, setHourEdits] = useState<Record<string, string>>({});
  const [progEdits, setProgEdits] = useState<Record<number, string>>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());   // person key -> đang thu gọn

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

  const loadItems = useCallback(() => {
    api.projectItems(projectId).then(setItems).catch(() => setItems([]));
  }, [projectId]);
  useEffect(() => { loadItems(); }, [loadItems]);

  const loadEntries = useCallback(() => {
    api.timesheets({ from: weekStart, to: weekEnd, projectId })
      .then(setEntries)
      .catch(() => setEntries([]));
  }, [weekStart, weekEnd, projectId]);
  useEffect(() => { loadEntries(); }, [loadEntries]);

  // Tên hiển thị của 1 người (từ thành viên, người được giao, hoặc bảng giờ).
  const nameOf = useCallback((uid: number): string => {
    const m = members.find((x) => x.id === uid);
    if (m) return m.full_name;
    const it = items.find((x) => x.assignee_id === uid && x.assignee_name);
    if (it?.assignee_name) return it.assignee_name;
    const e = entries.find((x) => x.user_id === uid && x.user_name);
    return e?.user_name ?? `#${uid}`;
  }, [members, items, entries]);

  // Đầu việc = các mục KHÔNG phải nhóm cha (lá). Kèm tên nhóm cha để biết ngữ cảnh.
  const parentName = useMemo(() => {
    const map = new Map<number, string>();
    for (const i of items) if (i.parent_id == null) map.set(i.id, i.name);
    return map;
  }, [items]);
  // Đầu việc = mục con (parent_id != null) trong mô hình 2 cấp. Nhóm cha (kể cả nhóm
  // rỗng chưa có con) KHÔNG phải đầu việc nên không hiện để điền giờ.
  const leaves = useMemo(() =>
    items.filter((i) => i.parent_id != null)
      .sort((a, b) => a.order_index - b.order_index || a.id - b.id),
    [items]);

  // Gom đầu việc theo NGƯỜI: mỗi người thấy đầu việc ĐƯỢC GIAO cho mình HOẶC đầu việc
  // mình ĐÃ KHAI GIỜ (để giờ đã khai không "biến mất" khi đầu việc được giao lại người khác).
  const groups = useMemo(() => {
    const workersByItem = new Map<number, Set<number>>();
    for (const e of entries) {
      if (e.project_item_id == null) continue;
      const s = workersByItem.get(e.project_item_id) ?? new Set<number>();
      s.add(e.user_id); workersByItem.set(e.project_item_id, s);
    }
    const byPerson = new Map<number, ProjectItem[]>();
    const seen = new Map<number, Set<number>>();
    const add = (uid: number, it: ProjectItem) => {
      const s = seen.get(uid) ?? new Set<number>();
      if (s.has(it.id)) return;
      s.add(it.id); seen.set(uid, s);
      const a = byPerson.get(uid) ?? []; a.push(it); byPerson.set(uid, a);
    };
    const unassigned: ProjectItem[] = [];
    for (const it of leaves) {
      let owned = false;
      if (it.assignee_id != null) { add(it.assignee_id, it); owned = true; }
      for (const uid of workersByItem.get(it.id) ?? []) { add(uid, it); owned = true; }
      if (!owned) unassigned.push(it);   // chưa giao & chưa ai khai giờ
    }
    const memberIds = members.map((m) => m.id);
    const orderedPids: number[] = [];
    for (const mid of memberIds) if (byPerson.has(mid)) orderedPids.push(mid);
    for (const pid of byPerson.keys()) if (!memberIds.includes(pid)) orderedPids.push(pid);
    const out: { key: PersonKey; name: string; tasks: ProjectItem[] }[] =
      orderedPids.map((pid) => ({ key: pid, name: nameOf(pid), tasks: byPerson.get(pid)! }));
    if (unassigned.length) out.push({ key: UNASSIGNED, name: "Chưa giao", tasks: unassigned });
    return out;
  }, [leaves, entries, members, nameOf]);

  // Giờ theo (người, đầu việc, ngày).
  const hkey = (uid: number, itemId: number, d: string) => `${uid}:${itemId}:${d}`;
  const hoursMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) {
      if (e.project_item_id == null) continue;
      map.set(hkey(e.user_id, e.project_item_id, e.work_date), Number(e.hours));
    }
    return map;
  }, [entries]);

  // Danh sách để giao việc = thành viên dự án + người hiện đang được giao (kể cả đã rời
  // dự án) để ô chọn không hiển thị sai "Chưa giao" cho việc thực ra đã có người.
  const assigneeOptions = useMemo(() => {
    const map = new Map<number, string>();
    for (const m of members) map.set(m.id, m.full_name);
    for (const it of items) if (it.assignee_id != null && !map.has(it.assignee_id))
      map.set(it.assignee_id, it.assignee_name ?? nameOf(it.assignee_id));
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [members, items, nameOf]);

  // ---- Sửa GIỜ (chỉ cho đầu việc đã có người) ----
  const canEditHours = (pid: PersonKey) =>
    pid !== UNASSIGNED && (canManage || pid === currentUserId);
  const hoursValue = (pid: number, itemId: number, d: string) => {
    const k = hkey(pid, itemId, d);
    if (hourEdits[k] !== undefined) return hourEdits[k];
    const h = hoursMap.get(k);
    return h ? num1(h) : "";
  };
  async function commitHours(pid: number, itemId: number, d: string) {
    const k = hkey(pid, itemId, d);
    if (hourEdits[k] === undefined) return;
    const raw = hourEdits[k].trim().replace(",", ".");
    const hours = raw === "" ? 0 : Number(raw);
    const cur = hoursMap.get(k) ?? 0;
    setHourEdits((p) => { const n = { ...p }; delete n[k]; return n; });
    if (isNaN(hours) || hours < 0 || hours > 24 || hours === cur) return;
    try {
      await api.upsertTimesheet({
        project_id: projectId, project_item_id: itemId, work_date: d, hours,
        user_id: pid !== currentUserId ? pid : undefined,
      });
      loadEntries();
    } catch { /* noop */ }
  }

  // ---- Sửa % TIẾN ĐỘ của đầu việc ----
  const canEditProgress = (it: ProjectItem) =>
    canManage || (it.assignee_id != null && it.assignee_id === currentUserId);
  const progValue = (it: ProjectItem) =>
    progEdits[it.id] !== undefined ? progEdits[it.id] : (it.progress ? num1(it.progress) : "");
  async function commitProgress(it: ProjectItem) {
    if (progEdits[it.id] === undefined) return;
    const raw = progEdits[it.id].trim().replace(",", ".");
    let val = raw === "" ? 0 : Number(raw);
    setProgEdits((p) => { const n = { ...p }; delete n[it.id]; return n; });
    if (isNaN(val)) return;
    val = Math.max(0, Math.min(100, val));
    if (val === Number(it.progress)) return;
    try { await api.updateProjectItem(it.id, { progress: val }); loadItems(); } catch { /* noop */ }
  }

  // ---- GIAO / đổi người phụ trách đầu việc ----
  async function assign(it: ProjectItem, pid: number | null) {
    if (pid === (it.assignee_id ?? null)) return;
    try { await api.updateProjectItem(it.id, { assignee_id: pid }); loadItems(); } catch { /* noop */ }
  }

  // ---- Cộng dồn ----
  const taskDay = (pid: PersonKey, itemId: number, d: string) =>
    pid === UNASSIGNED ? 0 : (hoursMap.get(hkey(pid, itemId, d)) ?? 0);
  const taskTotal = (pid: PersonKey, itemId: number) => days.reduce((s, d) => s + taskDay(pid, itemId, d), 0);
  const personDay = (g: { key: PersonKey; tasks: ProjectItem[] }, d: string) =>
    g.tasks.reduce((s, t) => s + taskDay(g.key, t.id, d), 0);
  const personTotal = (g: { key: PersonKey; tasks: ProjectItem[] }) =>
    days.reduce((s, d) => s + personDay(g, d), 0);
  const dayGrand = (d: string) => groups.reduce((s, g) => s + personDay(g, d), 0);
  const grand = days.reduce((s, d) => s + dayGrand(d), 0);

  const isOpen = (k: PersonKey) => !collapsed.has(String(k));
  const toggle = (k: PersonKey) =>
    setCollapsed((s) => { const n = new Set(s); const key = String(k); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const COLS = 1 + 1 + 7 + 1; // tên · % · 7 ngày · tổng

  return (
    <div className="rounded-xl2 border border-line/40 bg-white p-3.5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase text-muted">
          <ClockIcon className="h-4 w-4 text-steel" />
          Tiến độ theo người · đầu việc được giao (giờ/ngày)
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
        <span className="text-muted/70"> · bấm tên người để sổ ra đầu việc; điền số giờ vào ô là tự lưu.</span>
      </p>

      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[680px] border-collapse text-xs">
          <thead>
            <tr className="bg-paper text-[10px] uppercase tracking-wide text-muted">
              <th className="sticky left-0 z-10 border border-line bg-paper px-2 py-1.5 text-left font-semibold">Người / Đầu việc</th>
              <th className="border border-line px-1 py-1 text-center font-semibold">% TĐ</th>
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
            {groups.length === 0 ? (
              <tr><td colSpan={COLS} className="border border-line px-3 py-5 text-center text-muted">
                Chưa có đầu việc — thêm ở tab <b>Hạng mục</b>, rồi giao cho từng người tại đây.
              </td></tr>
            ) : (
              groups.map((g) => {
                const open = isOpen(g.key);
                const pTotal = personTotal(g);
                const unassigned = g.key === UNASSIGNED;
                return (
                  <FragmentRows key={String(g.key)}>
                    {/* ---- Dòng NGƯỜI (bấm để sổ ra) ---- */}
                    <tr
                      className={`cursor-pointer ${unassigned ? "bg-amber/10" : "bg-ink/5"} font-semibold text-ink hover:brightness-95`}
                      onClick={() => toggle(g.key)}
                    >
                      <td className="sticky left-0 z-10 border border-line bg-inherit px-2 py-1.5">
                        <span className="flex items-center gap-1.5">
                          {open ? <ChevronDownIcon className="h-3.5 w-3.5 shrink-0" /> : <ChevronRightIcon className="h-3.5 w-3.5 shrink-0" />}
                          {!unassigned && <UserCircleIcon className="h-4 w-4 shrink-0 text-steel" />}
                          <span className="truncate">{g.name}</span>
                          {g.key === currentUserId && <span className="text-[9px] font-normal text-muted">(tôi)</span>}
                          <span className="ml-1 rounded-full bg-white/70 px-1.5 text-[9px] font-semibold text-muted">{g.tasks.length}</span>
                        </span>
                      </td>
                      <td className="border border-line" />
                      {days.map((d) => {
                        const v = personDay(g, d);
                        return <td key={d} className={`border border-line px-1 py-1.5 text-center tnum ${v > 0 ? "text-steel" : "text-line"} ${d === today ? "bg-amber/10" : ""}`}>{v > 0 ? num1(v) : ""}</td>;
                      })}
                      <td className="border border-line px-2 py-1.5 text-center tnum text-amber-deep">{pTotal > 0 ? num1(pTotal) : "–"}</td>
                    </tr>

                    {/* ---- Các ĐẦU VIỆC của người này ---- */}
                    {open && g.tasks.map((it) => {
                      const tTotal = taskTotal(g.key, it.id);
                      const pgEdit = canEditProgress(it);
                      const grp = it.parent_id != null ? parentName.get(it.parent_id) : null;
                      return (
                        <tr key={it.id} className="odd:bg-white even:bg-paper/40">
                          <td className="sticky left-0 z-10 border border-line bg-inherit px-2 py-1.5 pl-6">
                            <div className="max-w-[240px] truncate text-ink/90" title={it.name}>
                              <span className="text-line">– </span>{it.name || <span className="italic text-muted">(chưa đặt tên)</span>}
                            </div>
                            {grp && <div className="max-w-[240px] truncate text-[9px] text-muted" title={grp}>{grp}</div>}
                            {/* Giao / đổi người (chỉ quản lý) */}
                            {canManage && (
                              <select
                                value={it.assignee_id ?? ""}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => assign(it, e.target.value === "" ? null : Number(e.target.value))}
                                className="mt-0.5 max-w-[240px] rounded border border-line bg-white px-1 py-0.5 text-[10px] text-muted outline-none focus:border-steel"
                              >
                                <option value="">— Chưa giao —</option>
                                {assigneeOptions.map((o) => (
                                  <option key={o.id} value={o.id}>{o.name}</option>
                                ))}
                              </select>
                            )}
                          </td>
                          {/* % tiến độ */}
                          <td className={`border border-line p-0 text-center ${Number(it.progress) >= 100 ? "bg-ok/20" : ""}`}>
                            {pgEdit ? (
                              <input
                                type="text" inputMode="decimal"
                                value={progValue(it)}
                                onChange={(e) => setProgEdits((x) => ({ ...x, [it.id]: e.target.value }))}
                                onBlur={() => commitProgress(it)}
                                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                                placeholder="0"
                                className="h-7 w-full min-w-[34px] bg-transparent text-center text-xs text-ink outline-none placeholder:text-line focus:bg-steel/5"
                              />
                            ) : (
                              <span className={`block px-1 py-1 tnum ${it.progress ? "font-semibold text-ink" : "text-line"}`}>
                                {it.progress ? num1(it.progress) : "–"}
                              </span>
                            )}
                          </td>
                          {/* Giờ mỗi ngày */}
                          {days.map((d) => {
                            const v = taskDay(g.key, it.id, d);
                            return (
                              <td key={d} className={`border border-line p-0 text-center ${v > 0 ? "bg-ok/15" : d === today ? "bg-amber/10" : ""}`}>
                                {canEditHours(g.key) ? (
                                  <input
                                    type="text" inputMode="decimal"
                                    value={hoursValue(g.key as number, it.id, d)}
                                    onChange={(e) => setHourEdits((x) => ({ ...x, [hkey(g.key as number, it.id, d)]: e.target.value }))}
                                    onBlur={() => commitHours(g.key as number, it.id, d)}
                                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                                    placeholder="–"
                                    className="h-7 w-full min-w-[38px] bg-transparent text-center text-xs text-ink outline-none placeholder:text-line focus:bg-steel/5"
                                  />
                                ) : (
                                  <span className={`block px-1 py-1 tnum ${v > 0 ? "font-semibold text-ink" : "text-line"}`}>
                                    {unassigned ? "" : (v > 0 ? num1(v) : "–")}
                                  </span>
                                )}
                              </td>
                            );
                          })}
                          <td className={`border border-line px-2 py-1.5 text-center font-bold tnum ${tTotal > 0 ? "text-steel" : "text-muted"}`}>
                            {tTotal > 0 ? num1(tTotal) : "–"}
                          </td>
                        </tr>
                      );
                    })}
                  </FragmentRows>
                );
              })
            )}
          </tbody>
          {groups.length > 0 && (
            <tfoot>
              <tr className="bg-ink/10 font-bold text-ink">
                <td className="sticky left-0 z-10 border border-line bg-ink/10 px-2 py-1.5 text-right">Tổng ngày</td>
                <td className="border border-line" />
                {days.map((d) => {
                  const t = dayGrand(d);
                  return <td key={d} className="border border-line px-1 py-1.5 text-center tnum">{t > 0 ? num1(t) : "–"}</td>;
                })}
                <td className="border border-line px-2 py-1.5 text-center text-amber-deep tnum">{grand > 0 ? num1(grand) : "–"}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="mt-1.5 text-[11px] text-muted">
        <b className="text-ink">% TĐ</b> = mức hoàn thành đầu việc. {canManage
          ? <>Chọn người trong ô dưới tên đầu việc để <b className="text-ink">giao / đổi người</b>.</>
          : "Bạn điền giờ cho các đầu việc được giao cho mình."}
      </p>
    </div>
  );
}

// Cho phép trả về nhiều <tr> trong .map mà không chèn thẻ bọc sai chỗ trong <tbody>.
function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
