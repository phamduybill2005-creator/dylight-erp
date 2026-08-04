"use client";

// Bảng tiến độ ngày TRONG 1 DỰ ÁN — theo HẠNG MỤC LỚN & ĐẦU VIỆC CON:
//   • Hiển thị danh mục theo STT (1, 1.1, 1.2, 2, 2.1...), Nhóm trưởng, Phòng ban, Đánh giá sao.
//   • Mỗi đầu việc hiển thị các cột giờ làm MỖI NGÀY (T2..CN) + nút tích hoàn thành.
//   • Cho phép thêm đầu việc trực tiếp tại từng nhóm hạng mục.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ClockIcon, ChevronLeftIcon, ChevronRightIcon, ChevronDownIcon, UserCircleIcon, StarIcon, PlusIcon,
} from "@heroicons/react/24/outline";
import { CheckCircleIcon } from "@heroicons/react/24/solid";
import { api } from "@/lib/api";
import { dateLocal, todayLocal, formatDate } from "@/lib/format";
import { PRESET_DEPARTMENTS } from "@/lib/departments";
import type { ProjectItem, ProjectItemRating, Timesheet, User } from "@/lib/types";

const RATING_LABELS: Record<number, string> = {
  1: "Cần xem xét lại",
  2: "Cần cải thiện",
  3: "Đạt",
  4: "Xuất sắc",
  5: "Rất xuất sắc",
};

const RATING_CLASSES: Record<number, string> = {
  1: "bg-red-50 text-red-700 border border-red-200/60",
  2: "bg-orange-50 text-orange-700 border border-orange-200/60",
  3: "bg-sky-50 text-sky-700 border border-sky-200/60",
  4: "bg-emerald-50 text-emerald-700 border border-emerald-200/60",
  5: "bg-purple-50 text-purple-700 border border-purple-200/60",
};

const num = (v: unknown) => {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
};

/** Chấm sao 1–5 đánh giá hạng mục (0 = chưa chấm). Bấm lại sao đang chọn để bỏ về 0. */
function ItemRating({ value, onChange, disabled = false }: { value: number; onChange: (n: number) => void; disabled?: boolean }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label="Đánh giá hạng mục">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            onChange(n === value ? 0 : n);
          }}
          title={`${n} sao`}
          className={`${disabled ? "cursor-not-allowed opacity-75" : "cursor-pointer"} ${
            n <= value ? "text-amber" : "text-line hover:text-amber"
          }`}
        >
          <StarIcon className={`h-3.5 w-3.5 ${n <= value ? "fill-amber" : ""}`} />
        </button>
      ))}
    </span>
  );
}

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
  const [items, setItems] = useState<ProjectItem[]>([]);
  const [workerRatings, setWorkerRatings] = useState<ProjectItemRating[]>([]);
  const [hourEdits, setHourEdits] = useState<Record<string, string>>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [tempWorkers, setTempWorkers] = useState<Record<number, number[]>>({});

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
  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const loadEntries = useCallback(() => {
    api.timesheets({ from: weekStart, to: weekEnd, projectId })
      .then(setEntries)
      .catch(() => setEntries([]));
  }, [weekStart, weekEnd, projectId]);
  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  const loadWorkerRatings = useCallback(() => {
    api.projectItemRatings(projectId).then(setWorkerRatings).catch(() => setWorkerRatings([]));
  }, [projectId]);
  useEffect(() => {
    loadWorkerRatings();
  }, [loadWorkerRatings]);

  async function rateWorker(itemId: number, userId: number, stars: number) {
    try {
      await api.upsertProjectItemRating({ project_item_id: itemId, user_id: userId, rating: stars });
      loadWorkerRatings();
      loadItems();
    } catch {
      /* noop */
    }
  }

  async function onPersist(id: number, patch: Partial<ProjectItem>) {
    try {
      await api.updateProjectItem(id, patch);
      loadItems();
    } catch {
      /* noop */
    }
  }

  async function addChild(group: ProjectItem) {
    try {
      await api.createProjectItem({
        project_id: projectId,
        parent_id: group.id,
        name: "Đầu việc mới",
        department: group.department || null,
        assignee_id: null,
      });
      loadItems();
    } catch {
      /* noop */
    }
  }

  const nameOf = useCallback(
    (uid: number): string => {
      const m = members.find((x) => x.id === uid);
      if (m) return m.full_name;
      const it = items.find((x) => x.assignee_id === uid && x.assignee_name);
      if (it?.assignee_name) return it.assignee_name;
      const e = entries.find((x) => x.user_id === uid && x.user_name);
      return e?.user_name ?? `#${uid}`;
    },
    [members, items, entries]
  );

  // Phân loại 2 cấp theo nhóm cha (parent_id == null) & các con
  const byOrder = (a: ProjectItem, b: ProjectItem) => a.order_index - b.order_index || a.id - b.id;

  const parents = useMemo(
    () => items.filter((i) => i.parent_id == null).sort(byOrder),
    [items]
  );

  const childrenOf = useCallback(
    (parentId: number) => items.filter((i) => i.parent_id === parentId).sort(byOrder),
    [items]
  );

  const taskWorkers = useCallback(
    (it: ProjectItem): User[] => {
      const workerIds = new Set<number>();
      if (it.assignee_id != null) workerIds.add(it.assignee_id);
      for (const e of entries) if (e.project_item_id === it.id) workerIds.add(e.user_id);
      for (const uid of tempWorkers[it.id] ?? []) workerIds.add(uid);
      if (currentUserId != null && members.some((m) => m.id === currentUserId)) workerIds.add(currentUserId);

      return Array.from(workerIds).map((uid) => {
        const m = members.find((x) => x.id === uid);
        if (m) return m;
        return {
          id: uid,
          full_name: nameOf(uid),
          role: "FIELD_STAFF",
          is_active: true,
          is_approved: true,
          company_id: projectId,
        } as User;
      });
    },
    [entries, tempWorkers, currentUserId, members, nameOf, projectId]
  );

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
    for (const it of items)
      if (it.assignee_id != null && !map.has(it.assignee_id))
        map.set(it.assignee_id, it.assignee_name ?? nameOf(it.assignee_id));
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [members, items, nameOf]);

  const canEditHours = (_uid: number) => true;
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
    setHourEdits((p) => {
      const n = { ...p };
      delete n[k];
      return n;
    });
    if (isNaN(hours) || hours < 0 || hours > 24 || hours === cur) return;
    try {
      await api.upsertTimesheet({
        project_id: projectId,
        project_item_id: itemId,
        work_date: d,
        hours,
        user_id: uid,
      });
      loadEntries();
    } catch {
      /* noop */
    }
  }

  async function toggleDone(it: ProjectItem) {
    try {
      await api.updateProjectItem(
        it.id,
        it.done_date ? { done_date: null, progress: 0 } : { done_date: dateLocal(new Date()), progress: 100 }
      );
      loadItems();
    } catch {
      /* noop */
    }
  }

  const dayGrand = (d: string) =>
    entries.filter((e) => e.work_date === d && e.project_item_id != null).reduce((sum, e) => sum + Number(e.hours), 0);
  const grand = entries.filter((e) => e.project_item_id != null).reduce((sum, e) => sum + Number(e.hours), 0);

  const isOpen = (k: number) => !collapsed.has(String(k));
  const toggle = (k: number) =>
    setCollapsed((s) => {
      const n = new Set(s);
      const key = String(k);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });

  const COLS = 1 + 1 + 7 + 1;

  return (
    <div className="rounded-xl2 border border-line/40 bg-white p-3.5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase text-muted">
          <ClockIcon className="h-4 w-4 text-steel" />
          Tiến độ theo đầu việc · người tham gia làm (giờ/ngày)
        </h3>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setWeekStart(addDays(weekStart, -7))}
            className="rounded-lg border border-line p-1 text-muted hover:bg-paper"
            title="Tuần trước"
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </button>
          <span className="text-[11px] font-semibold text-ink">
            {fmtDay(weekStart)} – {fmtDay(weekEnd)}
          </span>
          <button
            onClick={() => setWeekStart(addDays(weekStart, 7))}
            className="rounded-lg border border-line p-1 text-muted hover:bg-paper"
            title="Tuần sau"
          >
            <ChevronRightIcon className="h-4 w-4" />
          </button>
          <button
            onClick={() => setWeekStart(mondayOf(today))}
            className="rounded-lg border border-line px-2 py-1 text-[11px] font-semibold text-steel hover:bg-paper"
          >
            Tuần này
          </button>
        </div>
      </div>

      <p className="mt-1 text-[11px] text-muted">
        {projStart ? (
          <>
            Bắt đầu <b className="text-ink">{formatDate(projStart)}</b>
          </>
        ) : (
          "Chưa đặt ngày bắt đầu"
        )}
        {projEnd ? (
          <>
            {" · "}hạn <b className="text-ink">{formatDate(projEnd)}</b>
            {remaining !== null &&
              (remaining >= 0 ? (
                <>
                  {" "}
                  — còn <b className="text-amber-deep tnum">{remaining}</b> ngày
                </>
              ) : (
                <>
                  {" "}
                  — <b className="text-bad">quá hạn {-remaining} ngày</b>
                </>
              ))}
          </>
        ) : (
          " · chưa đặt hạn"
        )}
        <span className="text-muted/70">
          {" "}
          · bấm tên nhóm để mở rộng/thu gọn; điền số giờ vào các ô ngày là tự lưu.
        </span>
      </p>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[850px] table-fixed border-collapse text-xs">
          <colgroup>
            <col className="w-[45px]" />
            <col className="w-[320px]" />
            <col className="w-[92px]" />
            {days.map((d) => (
              <col key={d} className="w-[54px]" />
            ))}
            <col className="w-[60px]" />
          </colgroup>
          <thead>
            <tr className="bg-gradient-to-r from-slate-700 to-slate-800 text-[10px] uppercase tracking-wide text-white">
              <th className="px-2 py-2 text-center font-semibold border-r border-slate-600">STT</th>
              <th className="sticky left-0 z-10 px-2 py-2 text-left font-semibold">TÊN HẠNG MỤC</th>
              <th className="px-1 py-2 text-center font-semibold">
                <div>Trạng thái</div>
                <div className="text-[9px] font-normal opacity-80">/ Đánh giá</div>
              </th>
              {days.map((d, i) => (
                <th
                  key={d}
                  className={`px-1 py-2 text-center font-semibold ${
                    d === today ? "bg-amber text-white" : ""
                  }`}
                >
                  <div>{DOW[i]}</div>
                  <div className="text-[9px] font-normal opacity-80">{fmtDay(d)}</div>
                </th>
              ))}
              <th className="px-2 py-2 text-center font-semibold">Tổng</th>
            </tr>
          </thead>
          <tbody>
            {parents.length === 0 ? (
              <tr>
                <td colSpan={COLS + 1} className="border border-line px-3 py-5 text-center text-muted">
                  Chưa có nhóm hạng mục — thêm ở tab <b>Hạng mục</b>.
                </td>
              </tr>
            ) : (
              parents.map((g, gi) => {
                const kids = childrenOf(g.id);
                const gOpen = isOpen(g.id);

                return (
                  <React.Fragment key={g.id}>
                    {/* DÒNG NHÓM HẠNG MỤC LỚN (Matching Image 1) */}
                    <tr className="border-y-2 border-indigo-100 bg-gradient-to-r from-indigo-50/90 to-sky-50/70 hover:from-indigo-100/70 hover:to-sky-100/50 transition-all">
                      <td className="px-2 py-2 text-center text-[11px] font-bold text-ink">
                        <button
                          type="button"
                          onClick={() => toggle(g.id)}
                          title={gOpen ? "Bấm để thu gọn" : "Bấm để mở rộng"}
                          className="group/badge inline-flex items-center gap-1 focus:outline-none cursor-pointer"
                        >
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 font-bold text-xs text-white shadow-sm transition-transform group-hover/badge:scale-110">
                            {gi + 1}
                          </span>
                          <ChevronDownIcon
                            className={`h-3.5 w-3.5 text-indigo-600 transition-transform duration-200 ${
                              !gOpen ? "-rotate-90 text-slate-400" : ""
                            }`}
                          />
                        </button>
                      </td>
                      <td className="sticky left-0 z-10 px-2 py-2 bg-inherit">
                        <div className="flex flex-col">
                          <span className="font-bold text-ink text-sm tracking-tight">{g.name}</span>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] font-semibold text-muted">Nhóm trưởng:</span>
                              <select
                                value={g.assignee_id || ""}
                                onChange={(e) =>
                                  onPersist(g.id, {
                                    assignee_id: e.target.value ? Number(e.target.value) : null,
                                  })
                                }
                                disabled={!canManage}
                                className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold outline-none focus:border-steel cursor-pointer disabled:bg-transparent ${
                                  g.assignee_id
                                    ? "border-indigo-200 bg-indigo-50 text-indigo-800"
                                    : "border-line bg-white text-muted"
                                }`}
                              >
                                <option value="">— Chưa chọn —</option>
                                {members.map((m) => (
                                  <option key={m.id} value={m.id}>
                                    {m.full_name}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <select
                              value={g.department || ""}
                              onChange={(e) => onPersist(g.id, { department: e.target.value || null })}
                              disabled={!canManage}
                              className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold outline-none focus:border-steel disabled:bg-transparent ${
                                g.department
                                  ? "border-amber-200 bg-amber-50 text-amber-deep font-bold"
                                  : "border-line bg-white text-muted"
                              }`}
                            >
                              <option value="">— Chưa gán phòng —</option>
                              {PRESET_DEPARTMENTS.map((d) => (
                                <option key={d} value={d}>
                                  {d}
                                </option>
                              ))}
                            </select>

                            <div className="flex items-center gap-1">
                              <span className="text-[10px] font-semibold text-muted">Đánh giá:</span>
                              <ItemRating
                                value={num(g.rating)}
                                onChange={(n) => onPersist(g.id, { rating: n })}
                                disabled={!canManage}
                              />
                              {num(g.rating) > 0 && (
                                <span
                                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                    RATING_CLASSES[num(g.rating)] || "bg-amber/10 text-amber-deep"
                                  }`}
                                >
                                  {RATING_LABELS[num(g.rating)]}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-1 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                        {(() => {
                          const done = !!g.done_date;
                          const canTick = g.assignee_id != null && g.assignee_id === currentUserId;
                          return (
                            <button
                              type="button"
                              disabled={!canTick}
                              onClick={() => toggleDone(g)}
                              title={
                                done
                                  ? "Đã xong — bấm để bỏ"
                                  : canTick
                                  ? "Đánh dấu đã xong"
                                  : "Chỉ nhóm trưởng mới tích được"
                              }
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold transition-colors ${
                                done ? "bg-ok/15 text-ok" : "bg-line/50 text-muted"
                              } ${canTick ? "cursor-pointer hover:brightness-95" : "cursor-default"}`}
                            >
                              {done ? (
                                <CheckCircleIcon className="h-4 w-4" />
                              ) : (
                                <span className="h-3 w-3 rounded-full border-2 border-current" />
                              )}
                              {done ? "Đã xong" : "Chưa xong"}
                            </button>
                          );
                        })()}
                      </td>
                      {days.map((d) => (
                        <td key={d} className="border-l border-line/40 text-center" />
                      ))}
                      <td className="border-l border-line/40 text-center font-bold text-indigo-700" />
                    </tr>

                    {/* CÁC ĐẦU VIỆC CON (Sub-items) (Matching Image 1) */}
                    {gOpen &&
                      kids.map((c, ci) => {
                        const workers = taskWorkers(c);
                        const cOpen = isOpen(c.id);

                        return (
                          <React.Fragment key={c.id}>
                            <tr
                              className={`border-t border-line/50 transition-colors ${
                                c.assignee_id
                                  ? "bg-amber-50/80 hover:bg-amber-100/70"
                                  : `${ci % 2 === 0 ? "bg-white" : "bg-slate-50/30"} hover:bg-sky-50/40`
                              }`}
                            >
                              <td
                                className={`px-2 py-2 text-[11px] font-bold text-center ${
                                  c.assignee_id
                                    ? "bg-amber-100/70 text-amber-900 border-l-4 border-l-amber-400"
                                    : "text-slate-600 bg-slate-50/50"
                                }`}
                              >
                                {gi + 1}.{ci + 1}
                              </td>
                              <td className="sticky left-0 z-10 px-2 py-2 pl-3 bg-inherit">
                                <div className="flex flex-col">
                                  <span className="font-semibold text-ink text-xs">{c.name}</span>
                                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                                    <div className="flex items-center gap-1">
                                      <span className="text-[9px] font-semibold text-muted">Người làm:</span>
                                      <select
                                        value={c.assignee_id || ""}
                                        onChange={(e) =>
                                          onPersist(c.id, {
                                            assignee_id: e.target.value ? Number(e.target.value) : null,
                                          })
                                        }
                                        disabled={!canManage}
                                        className={`rounded border px-1.5 py-0.5 text-[9px] font-semibold outline-none focus:border-steel cursor-pointer disabled:bg-transparent ${
                                          c.assignee_id
                                            ? "border-sky-200 bg-sky-50 text-sky-800 font-medium"
                                            : "border-line bg-white text-muted"
                                        }`}
                                      >
                                        <option value="">— Chưa phân công —</option>
                                        {members.map((m) => (
                                          <option key={m.id} value={m.id}>
                                            {m.full_name}
                                          </option>
                                        ))}
                                      </select>
                                    </div>

                                    <div className="flex items-center gap-1">
                                      <span className="text-[9px] font-semibold text-muted">Đánh giá:</span>
                                      <ItemRating
                                        value={num(c.rating)}
                                        onChange={(n) => onPersist(c.id, { rating: n })}
                                        disabled={!canManage}
                                      />
                                      {num(c.rating) > 0 && (
                                        <span
                                          className={`text-[9px] font-bold px-1.5 py-0.2 rounded ${
                                            RATING_CLASSES[num(c.rating)] || "bg-amber/10 text-amber-deep"
                                          }`}
                                        >
                                          {RATING_LABELS[num(c.rating)]}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-1 py-1.5 text-center">
                                {(() => {
                                  const done = !!c.done_date;
                                  const canTick = c.assignee_id != null && c.assignee_id === currentUserId;
                                  return (
                                    <button
                                      type="button"
                                      disabled={!canTick}
                                      onClick={() => toggleDone(c)}
                                      title={
                                        done
                                          ? "Đã xong — bấm để bỏ"
                                          : canTick
                                          ? "Đánh dấu đã xong"
                                          : "Chỉ người làm mới tích được"
                                      }
                                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold transition-colors ${
                                        done ? "bg-ok/15 text-ok" : "bg-line/50 text-muted"
                                      } ${canTick ? "cursor-pointer hover:brightness-95" : "cursor-default"}`}
                                    >
                                      {done ? (
                                        <CheckCircleIcon className="h-4 w-4" />
                                      ) : (
                                        <span className="h-3 w-3 rounded-full border-2 border-current" />
                                      )}
                                      {done ? "Đã xong" : "Chưa xong"}
                                    </button>
                                  );
                                })()}
                              </td>
                              {days.map((d) => {
                                const v = workers.reduce(
                                  (sum, w) => sum + (hoursMap.get(hkey(w.id, c.id, d)) ?? 0),
                                  0
                                );
                                return (
                                  <td
                                    key={d}
                                    className={`border-l border-line/40 px-1 py-1.5 text-center tnum font-semibold text-steel ${
                                      d === today ? "bg-amber/10" : ""
                                    }`}
                                  >
                                    {v > 0 ? num1(v) : ""}
                                  </td>
                                );
                              })}
                              <td className="border-l border-line/40 px-2 py-1.5 text-center tnum text-amber-deep font-bold">
                                {(() => {
                                  const tot = days.reduce(
                                    (sum, d) =>
                                      sum +
                                      workers.reduce(
                                        (wSum, w) => wSum + (hoursMap.get(hkey(w.id, c.id, d)) ?? 0),
                                        0
                                      ),
                                    0
                                  );
                                  return tot > 0 ? num1(tot) : "–";
                                })()}
                              </td>
                            </tr>

                            {/* CHI TIẾT NGƯỜI LÀM VÀ Ô NHẬP GIỜ CHO TỪNG NGƯỜI */}
                            {workers.map((w) => {
                              const wTotal = days.reduce(
                                (sum, d) => sum + (hoursMap.get(hkey(w.id, c.id, d)) ?? 0),
                                0
                              );
                              const isMainAssignee = c.assignee_id === w.id;
                              return (
                                <tr key={w.id} className="odd:bg-white even:bg-paper/40 text-[11px]">
                                  <td />
                                  <td className="sticky left-0 z-10 px-2 py-1 pl-8 bg-inherit">
                                    <div className="flex items-center gap-1.5 text-ink/90">
                                      <UserCircleIcon className="h-3.5 w-3.5 shrink-0 text-steel" />
                                      <span className="truncate">{w.full_name}</span>
                                      {isMainAssignee && (
                                        <StarIcon
                                          className="h-3 w-3 text-amber fill-amber"
                                          title="Người phụ trách chính"
                                        />
                                      )}
                                      {w.id === currentUserId && <span className="text-[9px] text-muted">(tôi)</span>}
                                    </div>
                                  </td>
                                  <td className="px-1 py-1 text-center">
                                    {(() => {
                                      const wDone =
                                        (workerRatings.find(
                                          (r) => r.project_item_id === c.id && r.user_id === w.id
                                        )?.rating ?? 0) > 0;
                                      const canTick = w.id === currentUserId;
                                      return (
                                        <button
                                          type="button"
                                          disabled={!canTick}
                                          onClick={() => rateWorker(c.id, w.id, wDone ? 0 : 1)}
                                          title={
                                            wDone
                                              ? "Đã xong — bấm để bỏ"
                                              : canTick
                                              ? "Đánh dấu phần của bạn đã xong"
                                              : "Chưa xong"
                                          }
                                          className={`inline-flex items-center justify-center transition-colors ${
                                            wDone ? "text-ok" : "text-line"
                                          } ${canTick ? "cursor-pointer hover:text-ok" : "cursor-default"}`}
                                        >
                                          {wDone ? (
                                            <CheckCircleIcon className="h-4 w-4" />
                                          ) : (
                                            <span className="h-3.5 w-3.5 rounded-full border-2 border-current" />
                                          )}
                                        </button>
                                      );
                                    })()}
                                  </td>
                                  {days.map((d) => {
                                    const v = hoursMap.get(hkey(w.id, c.id, d)) ?? 0;
                                    return (
                                      <td
                                        key={d}
                                        className={`border border-line/40 p-0 text-center ${
                                          v > 0
                                            ? "bg-ok/15"
                                            : d === today
                                            ? "bg-amber/10"
                                            : d > today
                                            ? "bg-line/20"
                                            : ""
                                        }`}
                                      >
                                        {canEditHours(w.id) && d <= today ? (
                                          <input
                                            type="text"
                                            inputMode="decimal"
                                            value={hoursValue(w.id, c.id, d)}
                                            onChange={(e) =>
                                              setHourEdits((x) => ({
                                                ...x,
                                                [hkey(w.id, c.id, d)]: e.target.value,
                                              }))
                                            }
                                            onBlur={() => commitHours(w.id, c.id, d)}
                                            onKeyDown={(e) => {
                                              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                            }}
                                            placeholder="–"
                                            className="h-6 w-full min-w-[36px] bg-transparent text-center text-xs text-ink outline-none placeholder:text-line focus:bg-steel/5"
                                          />
                                        ) : (
                                          <span
                                            className={`block px-1 py-0.5 tnum ${
                                              v > 0 ? "font-semibold text-ink" : "text-line"
                                            }`}
                                          >
                                            {v > 0 ? num1(v) : "–"}
                                          </span>
                                        )}
                                      </td>
                                    );
                                  })}
                                  <td className="border border-line/40 px-2 py-1 text-center font-bold tnum text-steel">
                                    {wTotal > 0 ? num1(wTotal) : "–"}
                                  </td>
                                </tr>
                              );
                            })}
                          </React.Fragment>
                        );
                      })}

                    {/* NÚT THÊM ĐẦU VIỆC VÀO NHÓM (Matching Image 1: "+ Thêm đầu việc") */}
                    {gOpen && canManage && (
                      <tr className="border-t border-line/40 bg-white">
                        <td />
                        <td colSpan={COLS} className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => addChild(g)}
                            className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-600 hover:text-indigo-800 transition-colors cursor-pointer"
                          >
                            <PlusIcon className="h-4 w-4" />
                            Thêm đầu việc
                          </button>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
          {parents.length > 0 && (
            <tfoot>
              <tr className="bg-ink/10 font-bold text-ink">
                <td colSpan={2} className="sticky left-0 z-10 border border-line bg-ink/10 px-3 py-2 text-right">
                  Tổng giờ ngày
                </td>
                <td className="border border-line" />
                {days.map((d) => {
                  const t = dayGrand(d);
                  return (
                    <td key={d} className="border border-line px-1 py-2 text-center tnum">
                      {t > 0 ? num1(t) : "–"}
                    </td>
                  );
                })}
                <td className="border border-line px-2 py-2 text-center text-amber-deep tnum">
                  {grand > 0 ? num1(grand) : "–"}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="mt-2 text-[11px] text-muted">
        📌 <b>Bảng Tiến độ theo Đầu việc</b>: Hiển thị các nhóm hạng mục (STT 1, 2...) &amp; đầu việc con (STT 1.1, 1.2...).
        Bấm nút tím <b className="text-indigo-600">1</b>, <b className="text-indigo-600">2</b> để mở rộng/thu gọn nhóm.
      </p>
    </div>
  );
}
