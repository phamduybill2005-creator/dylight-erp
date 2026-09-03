"use client";

// Bảng tiến độ ngày TRONG 1 DỰ ÁN — theo HẠNG MỤC LỚN & ĐẦU VIỆC CON:
//   • Hiển thị danh mục theo STT (1, 1.1, 1.2, 2, 2.1...), Nhóm trưởng, Phòng ban.
//   • Mỗi đầu việc hiển thị rõ ràng từng nhân sự làm việc (T2..CN) + nút tích hoàn thành.
//   • Hỗ trợ nhân viên tách việc, phân chia giờ và xóa bớt giờ của từng người một cách minh bạch.
//   • Tính tổng realtime chuẩn xác, không bị lệch hoặc kẹt số cũ.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ClockIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  UserCircleIcon,
  StarIcon,
  PlusIcon,
  TrashIcon,
  UserPlusIcon,
  ExclamationTriangleIcon,
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
  onHoursChange,
}: {
  projectId: number;
  members: User[];
  currentUserId: number | null;
  canManage: boolean;
  startDate?: string | null;
  endDate?: string | null;
  onHoursChange?: () => void;
}) {
  const [weekStart, setWeekStart] = useState(() => mondayOf(todayLocal()));
  const [entries, setEntries] = useState<Timesheet[]>([]);
  const [items, setItems] = useState<ProjectItem[]>([]);
  const [hourEdits, setHourEdits] = useState<Record<string, string>>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [tempWorkers, setTempWorkers] = useState<Record<number, number[]>>({});
  const [addingWorkerForItemId, setAddingWorkerForItemId] = useState<number | null>(null);

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
      .then((data) => {
        setEntries(data);
      })
      .catch(() => setEntries([]));
  }, [weekStart, weekEnd, projectId]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  async function onPersist(id: number, patch: Partial<ProjectItem>) {
    try {
      await api.updateProjectItem(id, patch);
      loadItems();
      onHoursChange?.();
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

  // Danh sách nhân sự thực tế đã/đang tham gia đầu việc này
  const taskWorkers = useCallback(
    (it: ProjectItem): User[] => {
      const workerIds = new Set<number>();
      // 1. Người được gán phụ trách chính
      if (it.assignee_id != null) workerIds.add(it.assignee_id);
      // 2. Mọi người đã từng chấm giờ > 0 vào đầu việc này
      for (const e of entries) {
        if (e.project_item_id === it.id && Number(e.hours) > 0) {
          workerIds.add(e.user_id);
        }
      }
      // 3. Người được thêm tạm để phân bổ giờ
      for (const uid of tempWorkers[it.id] ?? []) {
        workerIds.add(uid);
      }
      // 4. Người dùng hiện tại nếu chưa có ai
      if (workerIds.size === 0 && currentUserId != null) {
        workerIds.add(currentUserId);
      }

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

  const hoursValue = (uid: number, itemId: number, d: string) => {
    const k = hkey(uid, itemId, d);
    if (hourEdits[k] !== undefined) return hourEdits[k];
    const h = hoursMap.get(k);
    return h ? num1(h) : "";
  };

  // Lưu hoặc cập nhật giờ làm
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
      onHoursChange?.();
    } catch (err: any) {
      alert(err?.message || "Không thể lưu giờ làm việc. Vui lòng kiểm tra lại quyền.");
      loadEntries();
    }
  }

  // Xóa toàn bộ giờ của 1 nhân sự trên đầu việc này (hỗ trợ nhân viên tách việc & xóa bớt giờ)
  async function handleClearWorkerOnItem(uid: number, itemId: number, workerName: string) {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa toàn bộ giờ làm của "${workerName}" trên đầu việc này không?`)) {
      return;
    }
    try {
      await api.clearWorkerHours({
        project_id: projectId,
        user_id: uid,
        project_item_id: itemId,
      });
      loadEntries();
      onHoursChange?.();
    } catch (err: any) {
      alert(err?.message || "Không thể xóa giờ của nhân sự này.");
    }
  }

  // Thêm nhân sự vào đầu việc để phân bổ/tách giờ
  function handleAddWorkerToItem(itemId: number, uid: number) {
    setTempWorkers((prev) => ({
      ...prev,
      [itemId]: Array.from(new Set([...(prev[itemId] || []), uid])),
    }));
    setAddingWorkerForItemId(null);
  }

  // Chuyển trạng thái hoàn thành
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

  // Tổng giờ theo từng ngày trong tuần (Tính trực tiếp từ entries để realtime 100% chuẩn xác)
  const dayGrand = useCallback(
    (d: string) => {
      return entries
        .filter((e) => e.work_date === d)
        .reduce((sum, e) => sum + Number(e.hours || 0), 0);
    },
    [entries]
  );

  // Tổng cả tuần
  const grand = useMemo(() => {
    return days.reduce((sum, d) => sum + dayGrand(d), 0);
  }, [days, dayGrand]);

  // Các bản ghi giờ chưa gắn vào đầu việc hợp lệ (giờ thừa/lạc)
  const orphanEntries = useMemo(() => {
    const activeItemIds = new Set(items.map((it) => it.id));
    return entries.filter((e) => e.project_item_id == null || !activeItemIds.has(e.project_item_id));
  }, [entries, items]);

  const handleCleanOrphans = async () => {
    if (!window.confirm("Bạn có muốn dọn sạch toàn bộ các bản ghi giờ chưa phân bổ hoặc thuộc đầu việc đã xóa này không?")) {
      return;
    }
    try {
      await Promise.all(orphanEntries.map((e) => api.deleteTimesheet(e.id)));
      loadEntries();
      onHoursChange?.();
    } catch (e: any) {
      alert(e?.message || "Lỗi khi xóa giờ lạc.");
    }
  };

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
          · điền số giờ vào các ô ngày để cập nhật; bấm nút thùng rác đỏ để xóa bớt giờ của từng người.
        </span>
      </p>

      {/* CẢNH BÁO & DỌN SẠCH GIỜ LẠC / GIỜ THỪA */}
      {orphanEntries.length > 0 && (
        <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs flex flex-wrap items-center justify-between gap-2 shadow-xs">
          <div className="flex items-center gap-2">
            <ExclamationTriangleIcon className="h-5 w-5 text-amber-600 shrink-0" />
            <div>
              <span className="font-bold text-amber-900">
                Phát hiện {orphanEntries.length} bản ghi ({num1(orphanEntries.reduce((s, e) => s + Number(e.hours || 0), 0))}h) chưa gắn vào đầu việc con hợp lệ:
              </span>
              <p className="text-[11px] text-amber-800">
                Đây là các giờ làm trước đây từ các hạng mục đã xóa hoặc chưa phân nhóm con khiến tổng ngoài bị lệch.
              </p>
            </div>
          </div>
          <button
            onClick={handleCleanOrphans}
            className="rounded-lg bg-bad px-3 py-1.5 text-xs font-bold text-white hover:bg-bad/90 transition shadow-xs"
          >
            Dọn sạch {orphanEntries.length} giờ này
          </button>
        </div>
      )}

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
                    {/* DÒNG NHÓM HẠNG MỤC LỚN */}
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
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-slate-900 text-xs tracking-tight">
                            {g.name}
                          </span>
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
                              title={done ? "Đã xong — bấm để bỏ" : canTick ? "Đánh dấu đã xong" : "Chỉ nhóm trưởng mới tích được"}
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold transition-colors ${
                                done ? "bg-ok/15 text-ok" : "bg-line/50 text-muted"
                              } ${canTick ? "cursor-pointer hover:brightness-95" : "cursor-default"}`}
                            >
                              {done ? <CheckCircleIcon className="h-4 w-4" /> : <span className="h-3 w-3 rounded-full border-2 border-current" />}
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

                    {/* CÁC ĐẦU VIỆC CON */}
                    {gOpen &&
                      kids.map((c, ci) => {
                        const workers = taskWorkers(c);
                        const isMultiple = workers.length > 1;

                        // Tổng giờ của đầu việc này theo từng ngày
                        const taskDayTotal = (d: string) => {
                          return workers.reduce((s, w) => s + (hoursMap.get(hkey(w.id, c.id, d)) ?? 0), 0);
                        };

                        // Tổng cả tuần của đầu việc này
                        const taskWeekTotal = days.reduce((s, d) => s + taskDayTotal(d), 0);

                        return (
                          <React.Fragment key={c.id}>
                            {/* DÒNG TIÊU ĐỀ ĐẦU VIỆC CON */}
                            <tr className={`border-t border-line/50 ${isMultiple ? "bg-slate-50/90 font-medium" : "bg-white"} transition-colors`}>
                              <td className="px-2 py-2 text-[11px] font-bold text-center text-slate-700 bg-slate-100/50">
                                {gi + 1}.{ci + 1}
                              </td>
                              <td className="sticky left-0 z-10 px-2 py-1.5 pl-3 bg-inherit">
                                <div className="flex flex-col">
                                  <div className="flex items-center justify-between gap-1">
                                    <span className="font-semibold text-ink text-xs">{c.name}</span>
                                    {/* Nút thêm nhân sự tham gia */}
                                    <button
                                      onClick={() => setAddingWorkerForItemId(addingWorkerForItemId === c.id ? null : c.id)}
                                      className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold text-steel hover:bg-paper hover:text-ink transition"
                                      title="Thêm nhân sự cùng làm đầu việc này để tách giờ"
                                    >
                                      <UserPlusIcon className="h-3 w-3" />
                                      <span>+ Thêm người</span>
                                    </button>
                                  </div>

                                  {/* Menu chọn thêm nhân sự */}
                                  {addingWorkerForItemId === c.id && (
                                    <div className="mt-1 flex items-center gap-1.5 rounded-lg border border-steel/30 bg-white p-1.5 shadow-sm">
                                      <span className="text-[10px] text-muted">Chọn nhân sự:</span>
                                      <select
                                        onChange={(e) => {
                                          if (e.target.value) handleAddWorkerToItem(c.id, Number(e.target.value));
                                        }}
                                        defaultValue=""
                                        className="rounded border border-line bg-paper px-1.5 py-0.5 text-[10px] text-ink outline-none"
                                      >
                                        <option value="" disabled>-- Chọn người làm --</option>
                                        {members
                                          .filter((m) => !workers.some((w) => w.id === m.id))
                                          .map((m) => (
                                            <option key={m.id} value={m.id}>
                                              {m.full_name}
                                            </option>
                                          ))}
                                      </select>
                                      <button
                                        onClick={() => setAddingWorkerForItemId(null)}
                                        className="text-[10px] text-muted hover:text-bad px-1"
                                      >
                                        Hủy
                                      </button>
                                    </div>
                                  )}

                                  <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted">
                                    <span>Phụ trách chính:</span>
                                    <select
                                      value={c.assignee_id || ""}
                                      onChange={(e) =>
                                        onPersist(c.id, {
                                          assignee_id: e.target.value ? Number(e.target.value) : null,
                                        })
                                      }
                                      disabled={!canManage}
                                      className="rounded border border-line/60 bg-transparent px-1 py-0.2 text-[9px] font-semibold text-slate-700 outline-none"
                                    >
                                      <option value="">— Chưa phân công —</option>
                                      {members.map((m) => (
                                        <option key={m.id} value={m.id}>
                                          {m.full_name}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                </div>
                              </td>

                              <td className="px-1 py-1.5 text-center">
                                {(() => {
                                  const done = !!c.done_date;
                                  const canTick =
                                    canManage ||
                                    !c.assignee_id ||
                                    c.assignee_id === currentUserId ||
                                    (currentUserId != null && members.some((m) => m.id === currentUserId));
                                  return (
                                    <button
                                      type="button"
                                      disabled={!canTick}
                                      onClick={() => toggleDone(c)}
                                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold transition-colors ${
                                        done ? "bg-ok/15 text-ok" : "bg-line/50 text-muted"
                                      } ${canTick ? "cursor-pointer hover:brightness-95" : "cursor-default"}`}
                                    >
                                      {done ? <CheckCircleIcon className="h-4 w-4" /> : <span className="h-3 w-3 rounded-full border-2 border-current" />}
                                      {done ? "Đã xong" : "Chưa xong"}
                                    </button>
                                  );
                                })()}
                              </td>

                              {/* Hiển thị tổng giờ đầu việc theo ngày nếu có nhiều người */}
                              {days.map((d) => {
                                const tot = taskDayTotal(d);
                                return (
                                  <td
                                    key={d}
                                    className={`border border-line/40 p-0 text-center ${
                                      tot > 0 ? "bg-emerald-50 font-bold text-emerald-800" : ""
                                    }`}
                                  >
                                    <span className="text-[11px] tnum">
                                      {tot > 0 ? num1(tot) : "–"}
                                    </span>
                                  </td>
                                );
                              })}
                              <td className="border-l border-line/40 px-2 py-1 text-center tnum text-amber-deep font-bold text-xs">
                                {taskWeekTotal > 0 ? num1(taskWeekTotal) : "–"}
                              </td>
                            </tr>

                            {/* DÒNG CHI TIẾT TỪNG NHÂN SỰ ĐỂ NHẬP / XÓA BỚT GIỜ */}
                            {workers.map((w) => {
                              const wTotal = days.reduce(
                                (sum, d) => sum + (hoursMap.get(hkey(w.id, c.id, d)) ?? 0),
                                0
                              );
                              const isMainAssignee = c.assignee_id === w.id;

                              return (
                                <tr key={w.id} className="border-t border-line/30 bg-white/70 hover:bg-amber-50/40 text-[11px] transition-colors">
                                  <td className="text-center text-slate-300 text-[10px]">•</td>
                                  <td className="sticky left-0 z-10 px-2 py-1 pl-6 bg-inherit">
                                    <div className="flex items-center justify-between gap-1 text-ink/90">
                                      <div className="flex items-center gap-1.5 truncate">
                                        <UserCircleIcon className="h-3.5 w-3.5 shrink-0 text-steel" />
                                        <span className="truncate font-medium">{w.full_name}</span>
                                        {isMainAssignee && (
                                          <StarIcon
                                            className="h-3 w-3 text-amber fill-amber shrink-0"
                                            title="Phụ trách chính"
                                          />
                                        )}
                                        {w.id === currentUserId && (
                                          <span className="text-[9px] text-muted">(tôi)</span>
                                        )}
                                      </div>

                                      {/* Nút xóa giờ của nhân sự này nếu đã có giờ */}
                                      {wTotal > 0 && (
                                        <button
                                          onClick={() => handleClearWorkerOnItem(w.id, c.id, w.full_name)}
                                          className="text-bad hover:bg-bad/10 p-0.5 rounded transition"
                                          title={`Xóa toàn bộ ${wTotal}h của ${w.full_name} trên đầu việc này`}
                                        >
                                          <TrashIcon className="h-3.5 w-3.5" />
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                  <td className="text-center text-[10px] text-muted">
                                    {wTotal > 0 ? `${num1(wTotal)}h` : "—"}
                                  </td>

                                  {/* Các ô nhập giờ từng ngày cho nhân sự này */}
                                  {days.map((d) => {
                                    const v = hoursMap.get(hkey(w.id, c.id, d)) ?? 0;
                                    const displayVal = hoursValue(w.id, c.id, d);

                                    return (
                                      <td
                                        key={d}
                                        className={`border border-line/40 p-0 text-center ${
                                          v > 0
                                            ? "bg-emerald-100/70"
                                            : d === today
                                            ? "bg-amber/15"
                                            : d > today
                                            ? "bg-slate-100/40"
                                            : ""
                                        }`}
                                      >
                                        {d <= today ? (
                                          <input
                                            type="text"
                                            inputMode="decimal"
                                            value={displayVal}
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
                                            className="h-7 w-full min-w-[32px] bg-transparent text-center text-xs font-bold text-ink outline-none placeholder:text-line/60 focus:bg-white focus:ring-1 focus:ring-amber-500"
                                          />
                                        ) : (
                                          <span className="block px-1 py-0.5 tnum text-line">–</span>
                                        )}
                                      </td>
                                    );
                                  })}

                                  <td className="border-l border-line/40 px-2 py-1 text-center tnum text-slate-800 font-semibold text-xs">
                                    {wTotal > 0 ? num1(wTotal) : "–"}
                                  </td>
                                </tr>
                              );
                            })}
                          </React.Fragment>
                        );
                      })}
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
        📌 <b>Bảng Tiến độ theo Đầu việc</b>: Mỗi đầu việc hiển thị chi tiết từng người làm.
        Bấm nút <b className="text-steel">+ Thêm người</b> để phân chia đầu việc cho nhân sự khác; bấm biểu tượng <b className="text-bad">thùng rác đỏ</b> để xóa bớt giờ của từng người khi cần điều chỉnh.
      </p>
    </div>
  );
}
