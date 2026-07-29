"use client";

// Tab "Phân công" — xem trong 1 dự án: CÓ BAO NHIÊU NGƯỜI làm, mỗi người LÀM GÌ,
// và LÀM TRONG BAO LÂU. Dữ liệu từ hệ thống Giao việc (Assignment) lọc theo dự án.
// Thời gian "bao lâu" do backend tự đóng dấu khi đổi trạng thái (bắt đầu / hoàn thành).

import { useCallback, useEffect, useMemo, useState } from "react";
import { UserGroupIcon, ClockIcon, TrashIcon } from "@heroicons/react/24/outline";
import { CheckBadgeIcon } from "@heroicons/react/24/solid";
import { api } from "@/lib/api";
import { assignmentDays } from "@/lib/format";
import { roleTitle } from "@/lib/roles";
import type { Assignment, User, Role, ProjectItem } from "@/lib/types";

type Person = { id: number; name: string; role?: Role; department?: string | null };

const STATUS_META: Record<string, { label: string; cls: string }> = {
  DONE: { label: "Hoàn thành", cls: "bg-ok/10 text-ok" },
  IN_PROGRESS: { label: "Đang làm", cls: "bg-amber/15 text-amber-deep" },
  ASSIGNED: { label: "Mới giao", cls: "bg-line text-muted" },
};

function StatusPill({ status }: { status: string }) {
  const m = STATUS_META[status] ?? STATUS_META.ASSIGNED;
  return <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${m.cls}`}>{m.label}</span>;
}

/** Nhãn "Xong / Xong (trễ) / Chưa xong" của 1 hạng mục (so ngày hoàn thành với hạn nộp). */
function ItemDonePill({ item }: { item: ProjectItem }) {
  const done = !!item.done_date;
  const late = done && item.due_date ? item.done_date! > item.due_date : false;
  return (
    <span
      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
        done ? (late ? "bg-bad/15 text-bad" : "bg-ok/10 text-ok") : "bg-line text-muted"
      }`}
    >
      {done ? (late ? "Xong (trễ)" : "Xong") : "Chưa xong"}
    </span>
  );
}

/** Thứ tự trong bảng Hạng mục: theo order_index, cùng số thì theo id. */
const byOrder = (a: ProjectItem, b: ProjectItem) => a.order_index - b.order_index || a.id - b.id;

/** 1 khối hiển thị: ĐẦU VIỆC LỚN (nhóm cha) + các ĐẦU VIỆC CON của người đó trong nhóm. */
type ItemBlock = { group: ProjectItem | null; groupMine: boolean; kids: ProjectItem[] };

/** "xong trong 3 ngày" / "đang làm < 1 ngày" / "chưa bắt đầu" / "—". */
function durationText(a: Assignment): string {
  // Chưa bắt đầu (mới giao, chưa bấm "Đang làm") -> không tính là đang làm.
  if (a.status !== "DONE" && !a.started_at) return "chưa bắt đầu";
  const d = assignmentDays(a.status, a.created_at, a.started_at, a.done_at);
  if (d === null) return "—";
  const num = d === 0 ? "< 1 ngày" : `${d} ngày`;
  return a.status === "DONE" ? `xong trong ${num}` : `đang làm ${num}`;
}

export default function ProjectTeamTab({
  projectId,
  members,
  leadId,
  canManage,
}: {
  projectId: number;
  members: User[];
  leadId: number | null;
  canManage: boolean;
}) {
  const [rows, setRows] = useState<Assignment[]>([]);
  const [items, setItems] = useState<ProjectItem[]>([]);   // HẠNG MỤC / đầu việc đã giao
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.assignments({ projectId }).catch(() => [] as Assignment[]),
      api.projectItems(projectId).catch(() => [] as ProjectItem[]),
    ])
      .then(([a, it]) => {
        setRows(a);
        setItems(it);
      })
      .finally(() => setLoading(false));
  }, [projectId]);
  useEffect(() => {
    load();
  }, [load]);

  const byAssignee = useMemo(() => {
    const m = new Map<number, Assignment[]>();
    for (const a of rows) {
      const list = m.get(a.assignee_id) ?? [];
      list.push(a);
      m.set(a.assignee_id, list);
    }
    return m;
  }, [rows]);

  // Tra nhanh 1 hạng mục theo id (để lấy ĐẦU VIỆC LỚN của một đầu việc con).
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  // SỐ THỨ TỰ y hệt bảng "Hạng mục": đầu việc lớn = "1", đầu việc con = "1.2".
  const itemNo = useMemo(() => {
    const m = new Map<number, string>();
    items
      .filter((i) => i.parent_id == null)
      .sort(byOrder)
      .forEach((g, gi) => {
        m.set(g.id, String(gi + 1));
        items
          .filter((i) => i.parent_id === g.id)
          .sort(byOrder)
          .forEach((c, ci) => m.set(c.id, `${gi + 1}.${ci + 1}`));
      });
    return m;
  }, [items]);

  // Gom hạng mục của 1 người thành các khối: ĐẦU VIỆC LỚN + đầu việc con bên dưới.
  // Nếu chỉ được giao đầu việc con thì vẫn hiện đầu việc lớn (mờ) để biết nó thuộc đâu.
  const blocksOf = useCallback(
    (mine: ProjectItem[]): ItemBlock[] => {
      const map = new Map<number, ItemBlock>();
      const at = (key: number, group: ProjectItem | null) => {
        let b = map.get(key);
        if (!b) {
          b = { group, groupMine: false, kids: [] };
          map.set(key, b);
        }
        if (!b.group && group) b.group = group;
        return b;
      };
      for (const i of mine) {
        if (i.parent_id == null) at(i.id, i).groupMine = true;
        else at(i.parent_id, itemById.get(i.parent_id) ?? null).kids.push(i);
      }
      const blocks = Array.from(map.values());
      for (const b of blocks) b.kids.sort(byOrder);
      return blocks.sort((a, b) =>
        a.group && b.group ? byOrder(a.group, b.group) : a.group ? -1 : 1,
      );
    },
    [itemById],
  );

  // HẠNG MỤC đã giao, gom theo NGƯỜI ĐƯỢC GIAO — đây là nguồn chính của tab Phân công.
  const itemsByAssignee = useMemo(() => {
    const m = new Map<number, ProjectItem[]>();
    for (const i of items) {
      if (i.assignee_id == null) continue;
      const list = m.get(i.assignee_id) ?? [];
      list.push(i);
      m.set(i.assignee_id, list);
    }
    for (const list of m.values())
      list.sort((a, b) => a.order_index - b.order_index || a.id - b.id);
    return m;
  }, [items]);

  // Người tham gia = thành viên dự án ∪ ai được giao HẠNG MỤC ∪ ai được giao việc.
  const people: Person[] = useMemo(() => {
    const map = new Map<number, Person>();
    for (const u of members) map.set(u.id, { id: u.id, name: u.full_name, role: u.role, department: u.department });
    for (const i of items) {
      if (i.assignee_id != null && !map.has(i.assignee_id)) {
        map.set(i.assignee_id, { id: i.assignee_id, name: i.assignee_name ?? `#${i.assignee_id}` });
      }
    }
    for (const a of rows) {
      if (!map.has(a.assignee_id)) {
        map.set(a.assignee_id, { id: a.assignee_id, name: a.assignee_name ?? `#${a.assignee_id}` });
      }
    }
    // Chủ trì lên đầu, còn lại theo tên.
    return Array.from(map.values()).sort((x, y) => {
      if (x.id === leadId) return -1;
      if (y.id === leadId) return 1;
      return x.name.localeCompare(y.name, "vi");
    });
  }, [members, items, rows, leadId]);


  async function changeStatus(a: Assignment, status: string) {
    // Cập nhật lạc quan rồi đồng bộ lại (để mốc thời gian/độ dài tính đúng từ backend).
    setRows((prev) => prev.map((x) => (x.id === a.id ? { ...x, status } : x)));
    try {
      await api.updateAssignment(a.id, { status });
      load();
    } catch {
      load();
    }
  }

  async function removeAssignment(a: Assignment) {
    if (!confirm(`Xóa phần việc "${a.title}"?`)) return;
    setRows((prev) => prev.filter((x) => x.id !== a.id));
    try {
      await api.deleteAssignment(a.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Xóa phần việc thất bại.");
    } finally {
      load();
    }
  }

  if (loading) {
    return <p className="py-10 text-center text-xs text-muted">Đang tải phân công…</p>;
  }

  // "Đang có phần việc" = được giao hạng mục HOẶC có phần việc giao riêng.
  const activeCount = people.filter(
    (p) => (itemsByAssignee.get(p.id)?.length ?? 0) > 0 || (byAssignee.get(p.id)?.length ?? 0) > 0,
  ).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase text-muted">
          <UserGroupIcon className="h-4 w-4 text-steel" />
          {people.length} người tham gia
        </h3>
        <span className="text-[11px] text-muted">{activeCount} người đang có phần việc</span>
      </div>

      {error && <p className="rounded-lg bg-bad/10 px-3 py-2 text-xs text-bad">{error}</p>}

      {people.length === 0 ? (
        <p className="rounded-xl2 bg-white p-6 text-center text-xs text-muted shadow-card">
          Dự án chưa có thành viên. Vào <b>Sửa dự án</b> để thêm người thực hiện.
        </p>
      ) : (
        <div className="rounded-xl2 border border-line bg-white shadow-card divide-y divide-line">
          {people.map((p) => {
            const list = (byAssignee.get(p.id) ?? []).slice().sort((a, b) => a.created_at.localeCompare(b.created_at));
            const myItems = itemsByAssignee.get(p.id) ?? [];       // HẠNG MỤC được giao
            const itemDone = myItems.filter((i) => !!i.done_date).length;
            const myBig = myItems.filter((i) => i.parent_id == null).length;   // đầu việc lớn
            const myKid = myItems.length - myBig;                              // đầu việc con
            const isLead = leadId === p.id;
            const doneN = list.filter((a) => a.status === "DONE").length;
            return (
              <div key={p.id} className="p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      {isLead && <CheckBadgeIcon className="h-4 w-4 shrink-0 text-indigo-600" />}
                      <span className="truncate text-sm font-semibold text-ink">{p.name}</span>
                      {isLead && <span className="text-[9px] font-bold text-amber-deep">(Chủ trì)</span>}
                    </div>
                    <p className="mt-0.5 text-[10px] text-muted">
                      {p.role ? roleTitle(p.role) : "Nhân viên"}
                      {p.department ? ` · ${p.department}` : ""}
                      {myItems.length > 0 &&
                        ` · ${myBig} đầu việc lớn + ${myKid} đầu việc con (${itemDone} xong)`}
                      {list.length > 0 && ` · ${list.length} việc (${doneN} xong)`}
                    </p>
                  </div>

                </div>



                {/* HẠNG MỤC được giao — lấy thẳng từ tab Hạng mục (project_items).
                    Hiển thị 2 CẤP y như bảng Hạng mục: đầu việc lớn "1" -> đầu việc con "1.2". */}
                {myItems.length > 0 && (
                  <div className="mt-2 space-y-1.5 border-t border-line/50 pt-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-steel">
                      Hạng mục được giao
                    </p>
                    {blocksOf(myItems).map((b) => (
                      <div
                        key={b.group?.id ?? `k-${b.kids[0]?.id ?? 0}`}
                        className="overflow-hidden rounded-lg border border-line/70"
                      >
                        {/* ĐẦU VIỆC LỚN (nhóm cha) */}
                        <div
                          className={`flex items-start justify-between gap-2 px-2 py-1.5 ${
                            b.groupMine
                              ? "bg-gradient-to-r from-indigo-50 to-sky-50"
                              : "bg-slate-50"
                          }`}
                        >
                          <div className="flex min-w-0 items-start gap-1.5">
                            <span
                              className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white ${
                                b.groupMine ? "bg-indigo-600" : "bg-slate-400"
                              }`}
                            >
                              {b.group ? itemNo.get(b.group.id) ?? "–" : "–"}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-xs font-bold text-ink" title={b.group?.name}>
                                {b.group?.name || (
                                  <span className="italic text-muted">(chưa đặt tên)</span>
                                )}
                              </p>
                              <p className="mt-0.5 text-[10px] text-muted">
                                Đầu việc lớn
                                {b.groupMine ? " · phụ trách cả nhóm" : " · chỉ làm đầu việc con"}
                                {b.group?.department ? ` · ${b.group.department}` : ""}
                                {b.group?.due_date ? ` · hạn ${b.group.due_date}` : ""}
                              </p>
                            </div>
                          </div>
                          {b.groupMine && b.group && <ItemDonePill item={b.group} />}
                        </div>

                        {/* ĐẦU VIỆC CON — nền vàng + viền trái vàng như bên Hạng mục */}
                        {b.kids.map((c) => (
                          <div
                            key={c.id}
                            className="flex items-start justify-between gap-2 border-t border-line/40 border-l-4 border-l-amber-400 bg-amber-50/60 py-1.5 pl-2 pr-2"
                          >
                            <div className="flex min-w-0 items-start gap-1.5">
                              <span className="mt-0.5 shrink-0 text-[10px] font-bold tnum text-amber-800">
                                {itemNo.get(c.id) ?? ""}
                              </span>
                              <div className="min-w-0">
                                <p className="truncate text-xs font-medium text-ink" title={c.name}>
                                  {c.name || <span className="italic text-muted">(chưa đặt tên)</span>}
                                </p>
                                <p className="mt-0.5 text-[10px] text-muted">
                                  Đầu việc con
                                  {c.department ? ` · ${c.department}` : ""}
                                  {c.due_date ? ` · hạn ${c.due_date}` : " · chưa đặt hạn"}
                                </p>
                              </div>
                            </div>
                            <ItemDonePill item={c} />
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}

                {/* Danh sách phần việc + thời gian */}
                {list.length === 0 ? (
                  myItems.length === 0 && (
                    <p className="mt-2 border-t border-line/50 pt-2 text-[11px] italic text-muted">
                      Chưa được giao hạng mục nào trong dự án này.
                    </p>
                  )
                ) : (
                  <div className="mt-2 space-y-1.5 border-t border-line/50 pt-2">
                    {list.map((a) => (
                      <div key={a.id} className="rounded-lg bg-paper/60 p-2">
                        <div className="flex items-start justify-between gap-2">
                          <span className="min-w-0 text-xs font-medium text-ink">{a.title}</span>
                          <span className="flex shrink-0 items-center gap-1.5">
                            <StatusPill status={a.status} />
                          </span>
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1 text-[10px] text-muted">
                            <ClockIcon className="h-3 w-3" />
                            {durationText(a)}
                          </span>
                          {canManage && (
                            <div className="flex items-center gap-1">
                              {["ASSIGNED", "IN_PROGRESS", "DONE"].map((s) => (
                                <button
                                  key={s}
                                  type="button"
                                  onClick={() => changeStatus(a, s)}
                                  className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${
                                    a.status === s ? "bg-ink text-white" : "bg-white text-muted hover:bg-line"
                                  }`}
                                >
                                  {s === "ASSIGNED" ? "Mới" : s === "IN_PROGRESS" ? "Đang làm" : "Xong"}
                                </button>
                              ))}
                              <button
                                type="button"
                                onClick={() => removeAssignment(a)}
                                title="Xóa phần việc"
                                className="rounded p-0.5 text-muted hover:bg-bad/10 hover:text-bad"
                              >
                                <TrashIcon className="h-3 w-3" />
                              </button>
                            </div>
                          )}
                        </div>
                        {a.description && <p className="mt-1 text-[10px] text-muted">{a.description}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
