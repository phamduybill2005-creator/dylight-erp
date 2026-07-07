"use client";

// Tab "Phân công" — xem trong 1 dự án: CÓ BAO NHIÊU NGƯỜI làm, mỗi người LÀM GÌ,
// và LÀM TRONG BAO LÂU. Dữ liệu từ hệ thống Giao việc (Assignment) lọc theo dự án.
// Thời gian "bao lâu" do backend tự đóng dấu khi đổi trạng thái (bắt đầu / hoàn thành).

import { useCallback, useEffect, useMemo, useState } from "react";
import { PlusIcon, UserGroupIcon, StarIcon, ClockIcon, TrashIcon } from "@heroicons/react/24/outline";
import { api } from "@/lib/api";
import { assignmentDays } from "@/lib/format";
import { roleTitle } from "@/lib/roles";
import type { Assignment, User, Role } from "@/lib/types";

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
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Giao việc nhanh cho 1 người ngay trong tab.
  const [assignTo, setAssignTo] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    api
      .assignments({ projectId })
      .then(setRows)
      .catch(() => setRows([]))
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

  // Người tham gia = thành viên dự án ∪ ai được giao việc trong dự án (kể cả chưa là member).
  const people: Person[] = useMemo(() => {
    const map = new Map<number, Person>();
    for (const u of members) map.set(u.id, { id: u.id, name: u.full_name, role: u.role, department: u.department });
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
  }, [members, rows, leadId]);

  async function submitAssign() {
    if (assignTo == null || !title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.createAssignment({
        assignee_id: assignTo,
        title: title.trim(),
        description: desc.trim() || null,
        project_id: projectId,
      });
      setTitle("");
      setDesc("");
      setAssignTo(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Giao việc thất bại.");
    } finally {
      setBusy(false);
    }
  }

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

  const activeCount = people.filter((p) => (byAssignee.get(p.id)?.length ?? 0) > 0).length;

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
        <div className="space-y-2.5">
          {people.map((p) => {
            const list = (byAssignee.get(p.id) ?? []).slice().sort((a, b) => a.created_at.localeCompare(b.created_at));
            const isLead = leadId === p.id;
            const doneN = list.filter((a) => a.status === "DONE").length;
            return (
              <div key={p.id} className="rounded-xl2 border border-line bg-white p-3.5 shadow-card">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      {isLead && <StarIcon className="h-3.5 w-3.5 shrink-0 text-amber" />}
                      <span className="truncate text-sm font-semibold text-ink">{p.name}</span>
                      {isLead && <span className="text-[9px] font-bold text-amber-deep">(Chủ trì)</span>}
                    </div>
                    <p className="mt-0.5 text-[10px] text-muted">
                      {p.role ? roleTitle(p.role) : "Nhân viên"}
                      {p.department ? ` · ${p.department}` : ""}
                      {list.length > 0 && ` · ${list.length} việc (${doneN} xong)`}
                    </p>
                  </div>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => {
                        setAssignTo(assignTo === p.id ? null : p.id);
                        setTitle("");
                        setDesc("");
                      }}
                      className="flex shrink-0 items-center gap-1 rounded-lg border border-line px-2 py-1 text-[11px] font-semibold text-steel hover:bg-paper"
                    >
                      <PlusIcon className="h-3.5 w-3.5" />
                      Giao việc
                    </button>
                  )}
                </div>

                {/* Form giao việc nhanh */}
                {canManage && assignTo === p.id && (
                  <div className="mt-2 space-y-2 rounded-lg bg-paper p-2.5">
                    <input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Tên phần việc *"
                      className="w-full rounded-lg border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel"
                    />
                    <textarea
                      value={desc}
                      onChange={(e) => setDesc(e.target.value)}
                      rows={2}
                      placeholder="Mô tả (tùy chọn)"
                      className="w-full rounded-lg border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={submitAssign}
                        disabled={busy || !title.trim()}
                        className="rounded-xl2 bg-ink px-3 py-1.5 text-xs font-semibold text-white hover:bg-steel disabled:opacity-50"
                      >
                        {busy ? "Đang giao…" : `Giao cho ${p.name}`}
                      </button>
                      <button
                        type="button"
                        onClick={() => setAssignTo(null)}
                        className="rounded-xl2 border border-line px-3 py-1.5 text-xs font-semibold text-muted hover:bg-white"
                      >
                        Hủy
                      </button>
                    </div>
                  </div>
                )}

                {/* Danh sách phần việc + thời gian */}
                {list.length === 0 ? (
                  <p className="mt-2 border-t border-line/50 pt-2 text-[11px] italic text-muted">
                    Chưa có phần việc nào trong dự án này.
                  </p>
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
