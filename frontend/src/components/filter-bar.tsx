"use client";

// Thanh lọc DÙNG CHUNG cho các trang danh sách: lọc theo PHÒNG BAN, theo NGƯỜI CHỦ TRÌ,
// và theo DỰ ÁN. Mỗi bộ lọc bật/tắt độc lập qua prop `show` — trang nào thiếu chiều nào
// thì tắt bộ lọc đó. Component tự nạp danh sách lựa chọn (chỉ nạp cho bộ lọc đang bật).
//
// Dùng: cha giữ state `Filters`, truyền value + onChange, rồi tự áp predicate lên dữ liệu.
//   const [f, setF] = useState<Filters>(NO_FILTERS);
//   <FilterBar show={{ dept: true, lead: true, project: true }} value={f} onChange={setF} />

import { useEffect, useState } from "react";
import { FunnelIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { api } from "@/lib/api";
import { isSeniorManagerUp } from "@/lib/roles";
import type { User, Project } from "@/lib/types";

export type Filters = { dept: string; leadId: number | ""; projectId: number | "" };
export const NO_FILTERS: Filters = { dept: "", leadId: "", projectId: "" };

/** Tách chuỗi phòng ban "Phòng BIM, Phòng AI" -> ["Phòng BIM", "Phòng AI"]. */
export const splitDepts = (s?: string | null): string[] =>
  (s || "").split(",").map((x) => x.trim()).filter(Boolean);

export default function FilterBar({
  show,
  value,
  onChange,
  leadLabel = "người chủ trì",
}: {
  show: { dept?: boolean; lead?: boolean; project?: boolean };
  value: Filters;
  onChange: (v: Filters) => void;
  leadLabel?: string;
}) {
  const [me, setMe] = useState<User | null>(api.cachedUser());
  const [depts, setDepts] = useState<string[]>([]);
  const [leads, setLeads] = useState<User[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    api.me().then(setMe).catch(() => {});
    if (show.dept) api.departments().then((d) => setDepts(d.map((x) => x.name))).catch(() => {});
    if (show.lead) api.users().then(setLeads).catch(() => {});
    if (show.project) api.projects().then(setProjects).catch(() => {});
  }, [show.dept, show.lead, show.project]);

  // Ứng viên "người chủ trì": cấp quản lý (ADMIN/DIRECTOR/MANAGER) hoặc người đang có cấp dưới.
  const leadOpts = leads
    .filter(
      (u) =>
        u.is_active !== false &&
        (u.role === "ADMIN" || u.role === "DIRECTOR" || u.role === "MANAGER" || u.has_subordinates)
    )
    .sort((a, b) => a.full_name.localeCompare(b.full_name, "vi"));

  const projectOpts = [...projects].sort((a, b) => a.name.localeCompare(b.name, "vi"));

  const active = value.dept !== "" || value.leadId !== "" || value.projectId !== "";
  const selCls =
    "min-w-0 rounded-lg border border-line bg-white px-2.5 py-2 text-xs text-ink outline-none focus:border-steel";

  return (
    <section className="flex flex-wrap items-center gap-2 rounded-xl2 border border-line bg-white p-2 shadow-card">
      <span className="flex items-center gap-1 pl-1 text-[11px] font-semibold text-muted">
        <FunnelIcon className="h-4 w-4" /> Lọc
      </span>

      {show.dept && isSeniorManagerUp(me) && (
        <select
          value={value.dept}
          onChange={(e) => onChange({ ...value, dept: e.target.value })}
          className={selCls}
          aria-label="Lọc theo phòng ban"
        >
          <option value="">Tất cả phòng ban</option>
          {depts.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      )}

      {show.lead && (
        <select
          value={value.leadId}
          onChange={(e) => onChange({ ...value, leadId: e.target.value ? Number(e.target.value) : "" })}
          className={selCls}
          aria-label={`Lọc theo ${leadLabel}`}
        >
          <option value="">Tất cả {leadLabel}</option>
          {leadOpts.map((u) => (
            <option key={u.id} value={u.id}>{u.full_name}</option>
          ))}
        </select>
      )}

      {show.project && (
        <select
          value={value.projectId}
          onChange={(e) => onChange({ ...value, projectId: e.target.value ? Number(e.target.value) : "" })}
          className={selCls}
          aria-label="Lọc theo dự án"
        >
          <option value="">Tất cả dự án</option>
          {projectOpts.map((p) => (
            <option key={p.id} value={p.id}>{p.code ? `${p.code} · ` : ""}{p.name}</option>
          ))}
        </select>
      )}

      {active && (
        <button
          type="button"
          onClick={() => onChange(NO_FILTERS)}
          className="ml-auto flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-muted hover:bg-paper"
        >
          <XMarkIcon className="h-3.5 w-3.5" /> Xóa lọc
        </button>
      )}
    </section>
  );
}
