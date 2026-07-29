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

  // Tên nhóm cha của từng hạng mục (để ghi "thuộc nhóm nào").
  const parentName = useMemo(() => {
    const m = new Map<number, string>();
    for (const i of items) if (i.parent_id == null) m.set(i.id, i.name);
    return m;
  }, [items]);

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
                      {myItems.length > 0 && ` · ${myItems.length} hạng mục (${itemDone} xong)`}
                      {list.length > 0 && ` · ${list.length} việc (${doneN} xong)`}
                    </p>
                  </div>

                </div>



                {/* HẠNG MỤC được giao — lấy thẳng từ tab Hạng mục (project_items). */}
                {myItems.length > 0 && (
                  <div className="mt-2 space-y-1 border-t border-line/50 pt-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-steel">
                      Hạng mục được giao
                    </p>
                    {myItems.map((i) => {
                      const grp = i.parent_id != null ? parentName.get(i.parent_id) : null;
                      const done = !!i.done_date;
                      const late = done && i.due_date ? i.done_date! > i.due_date : false;
                      return (
                        <div
                          key={i.id}
                          className="flex items-start justify-between gap-2 rounded-lg bg-paper/60 p-2"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium text-ink" title={i.name}>
                              {i.name || <span className="italic text-muted">(chưa đặt tên)</span>}
                            </p>
                            <p className="mt-0.5 text-[10px] text-muted">
                              {grp ? `Nhóm: ${grp}` : "Nhóm hạng mục"}
                              {i.department ? ` · ${i.department}` : ""}
                              {i.due_date ? ` · hạn ${i.due_date}` : " · chưa đặt hạn"}
                            </p>
                          </div>
                          <span
                            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
                              done ? (late ? "bg-bad/15 text-bad" : "bg-ok/10 text-ok") : "bg-line text-muted"
                            }`}
                          >
                            {done ? (late ? "Xong (trễ)" : "Xong") : "Chưa xong"}
                          </span>
                        </div>
                      );
                    })}
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
