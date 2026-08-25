"use client";

// Trang DOANH THU — cùng bố cục bảng với trang Dự án, nhưng xoay quanh tiền:
// bỏ bớt các cột vận hành (tiến độ, giờ công, ghi chú), giữ lại phần nhận diện
// dự án + ô nhập Doanh thu, và cộng TỔNG ở cuối bảng.
// Số liệu dùng chung trường `revenue` với bảng Dự án -> sửa bên nào cũng khớp.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { StarIcon as StarIconSolid } from "@heroicons/react/24/solid";
import AppShell from "@/components/app-shell";
import { api } from "@/lib/api";
import { isSeniorManagerUp } from "@/lib/roles";
import { PRESET_DEPARTMENTS } from "@/lib/departments";
import { DEPT_JA, groupLabel, normalizeDept, getProjectDept } from "@/lib/groups";
import { formatVND } from "@/lib/format";
import type { Project, ProjectStatus, User } from "@/lib/types";

const PROJECT_STATUS: Record<string, { label: string; cls: string }> = {
  PLANNING: { label: "Chuẩn bị", cls: "bg-line text-muted" },
  IN_PROGRESS: { label: "Đang làm", cls: "bg-steel/10 text-steel" },
  ON_HOLD: { label: "Tạm dừng", cls: "bg-amber/20 text-amber-deep" },
  COMPLETED: { label: "Hoàn thành", cls: "bg-ok/15 text-ok" },
  CLOSED: { label: "Đã đóng", cls: "bg-bad/15 text-bad" },
};

/** Trạng thái hiển thị — tôn trọng cờ ép tay, giống hệt bảng Dự án. */
function effectiveStatus(p: Project): string {
  if (p.status_locked) return p.status;
  const pct = Math.round(Number(p.progress_percent ?? 0));
  if (p.status === "ON_HOLD" || p.status === "CLOSED") {
    if (pct < 100 && !p.end_date) return p.status;
  }
  if (pct >= 100 || p.end_date) return "COMPLETED";
  if (pct > 0 || p.start_date) return "IN_PROGRESS";
  return "PLANNING";
}

/** "78.000.000" -> 78000000 ; rỗng -> null. */
function parseMoney(s: string): number | null {
  const t = s.replace(/[^\d]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Số -> "78.000.000" để hiện trong ô nhập. */
function groupNumber(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("vi-VN", { maximumFractionDigits: 0 }) : "";
}

/** Đổi ngày về mốc thời gian để so sánh — copy y hệt trang Dự án. */
function parseTimestamp(s?: string | null): number | null {
  if (!s) return null;
  const str = s.trim();
  if (!str) return null;
  const v = str.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split("-").map(Number);
    return new Date(y, m - 1, d).getTime();
  }
  const t = new Date(str).getTime();
  return isNaN(t) ? null : t;
}

/** "2026-08-03" -> "03/08" */
const dm = (iso?: string | null): string => {
  if (!iso) return "—";
  const [, m, d] = iso.slice(0, 10).split("-");
  return m && d ? `${d}/${m}` : "—";
};

export default function RevenuePage() {
  const router = useRouter();

  const [projects, setProjects] = useState<Project[]>([]);
  const [me, setMe] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const [searchQuery, setSearchQuery] = useState("");
  const [filterDept, setFilterDept] = useState("");
  const [filterMonth, setFilterMonth] = useState("");

  const [edits, setEdits] = useState<Record<number, string>>({});   // ô đang gõ dở

  // Dự án GHIM — dùng CHUNG localStorage với trang Dự án & Tiến độ, nên ghim ở
  // đâu thì cả ba trang cùng đẩy lên đầu.
  const [pinnedIds, setPinnedIds] = useState<number[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const saved = localStorage.getItem("timesheet_pinned_projects");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    const syncPinned = () => {
      try {
        const saved = localStorage.getItem("timesheet_pinned_projects");
        setPinnedIds(saved ? JSON.parse(saved) : []);
      } catch {}
    };
    syncPinned();
    window.addEventListener("storage", syncPinned);
    window.addEventListener("focus", syncPinned);
    window.addEventListener("pinned_projects_changed", syncPinned);
    return () => {
      window.removeEventListener("storage", syncPinned);
      window.removeEventListener("focus", syncPinned);
      window.removeEventListener("pinned_projects_changed", syncPinned);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    api.me().then((u) => alive && setMe(u)).catch(() => {});
    api.projects()
      .then((d) => alive && setProjects(d))
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  /** Sửa doanh thu: từ quản lý trở lên hoặc chính người chủ trì dự án đó. */
  const canEdit = (p: Project) =>
    isSeniorManagerUp(me) || !!me?.has_subordinates || (!!me && p.lead_id === me.id);

  const uniqueDepts = useMemo(
    () =>
      Array.from(
        new Set([...PRESET_DEPARTMENTS, ...projects.map((p) => getProjectDept(p)).filter(Boolean)]),
      ).sort(),
    [projects],
  );

  const rows = useMemo(() => {
    const list = projects.filter((p) => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const hit =
          (p.name || "").toLowerCase().includes(q) || (p.code || "").toLowerCase().includes(q);
        if (!hit) return false;
      }
      if (filterDept && getProjectDept(p) !== filterDept) return false;
      if (filterMonth && (p.start_date || "").slice(0, 7) !== filterMonth) return false;
      return true;
    });
    // Sắp xếp GIỐNG HỆT trang Dự án: 1) dự án GHIM lên đầu -> 2) TIME IN
    // (ngày nhận) từ CŨ đến MỚI -> 3) thiếu ngày nhận xuống cuối -> 4) theo Mã QL.
    const pinnedSet = new Set(pinnedIds);
    return [...list].sort((a, b) => {
      const aPin = pinnedSet.has(a.id) ? 1 : 0;
      const bPin = pinnedSet.has(b.id) ? 1 : 0;
      if (aPin !== bPin) return bPin - aPin;

      const ta = parseTimestamp(a.start_date);
      const tb = parseTimestamp(b.start_date);
      if (ta !== null && tb !== null) {
        if (ta !== tb) return ta - tb;
        return (a.code || "").localeCompare(b.code || "", "vi");
      }
      if (ta !== null && tb === null) return -1;
      if (ta === null && tb !== null) return 1;
      return (a.code || "").localeCompare(b.code || "", "vi");
    });
  }, [projects, searchQuery, filterDept, filterMonth, pinnedIds]);

  const tong = useMemo(
    () => rows.reduce((s, p) => s + Number(p.revenue ?? 0), 0),
    [rows],
  );
  const soCoDoanhThu = useMemo(
    () => rows.filter((p) => Number(p.revenue ?? 0) > 0).length,
    [rows],
  );

  async function saveRevenue(p: Project) {
    const draft = edits[p.id];
    if (draft === undefined) return;
    const clear = () =>
      setEdits((s) => {
        const n = { ...s };
        delete n[p.id];
        return n;
      });
    const next = parseMoney(draft);
    const cur = p.revenue == null || p.revenue === "" ? null : Number(p.revenue);
    if (next === cur) {
      clear();
      return;
    }
    try {
      const updated = await api.updateProject(p.id, { revenue: next });
      setProjects((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    } catch (err: any) {
      alert(err?.message || "Không lưu được doanh thu.");
    } finally {
      clear();
    }
  }

  const TH = "border border-line font-semibold whitespace-nowrap sticky top-0 bg-paper z-10 px-1.5 py-1.5";
  const TD = "border border-line align-middle px-1.5 py-1.5";

  return (
    <AppShell maxWidthClass="max-w-md lg:max-w-[1600px]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">Doanh thu</h1>
          <p className="mt-0.5 text-xs text-muted">
            Doanh thu từng dự án — gõ thẳng vào ô, rời ô là tự lưu.
          </p>
        </div>

        {/* Thẻ tổng — số liệu quan trọng nhất của trang, để ngay tầm mắt */}
        <div className="flex items-center gap-3 rounded-xl2 border border-line bg-white px-4 py-2.5 shadow-card">
          <div>
            <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted">
              Tổng doanh thu
            </span>
            <span className="block text-lg font-bold text-ink tnum">{formatVND(tong)}</span>
          </div>
          <div className="border-l border-line pl-3">
            <span className="block text-[10px] text-muted">Đã nhập</span>
            <span className="block text-sm font-bold text-steel tnum">
              {soCoDoanhThu}/{rows.length}
            </span>
          </div>
        </div>
      </div>

      {/* Bộ lọc — giống bảng Dự án */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="min-w-[240px] flex-1">
          <input
            type="text"
            placeholder="Tìm theo tên hoặc mã quản lý..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl2 border border-line bg-white px-3 py-2 text-xs outline-none placeholder:text-muted focus:border-steel"
          />
        </div>

        {isSeniorManagerUp(me) && (
          <div className="w-full sm:w-[200px]">
            <select
              value={filterDept}
              onChange={(e) => setFilterDept(e.target.value)}
              className="w-full rounded-xl2 border border-line bg-white px-3 py-2.5 text-xs text-ink outline-none focus:border-steel"
            >
              <option value="">— Tất cả phòng ban —</option>
              {uniqueDepts.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
        )}

        <input
          type="month"
          value={filterMonth}
          onChange={(e) => setFilterMonth(e.target.value)}
          title="Lọc theo tháng nhận việc"
          className="rounded-xl2 border border-line bg-white px-3 py-2 text-xs text-ink outline-none focus:border-steel"
        />

        {(searchQuery || filterDept || filterMonth) && (
          <button
            onClick={() => { setSearchQuery(""); setFilterDept(""); setFilterMonth(""); }}
            className="text-xs font-semibold text-steel hover:text-ink hover:underline"
          >
            Xóa bộ lọc
          </button>
        )}
      </div>

      <p className="mt-2 text-xs text-muted">
        Tìm thấy: <b className="text-ink">{rows.length}</b> dự án
      </p>

      <div className="mt-3 max-h-[calc(100vh-300px)] overflow-auto rounded-xl2 border border-line bg-white shadow-card">
        <table className="w-full min-w-[1000px] table-fixed border-collapse text-[11px]">
          <colgroup>
            <col className="w-[52px]" />    {/* STT (+ ★ nếu ghim) */}
            <col className="w-[132px]" />   {/* Mã QL */}
            <col className="w-[300px]" />   {/* Tên dự án */}
            <col className="w-[86px]" />    {/* Nhóm */}
            <col className="w-[110px]" />   {/* DOSCO担当 */}
            <col className="w-[70px]" />    {/* Time in */}
            <col className="w-[70px]" />    {/* Time out */}
            <col className="w-[92px]" />    {/* Trạng thái */}
            <col className="w-[150px]" />   {/* Doanh thu */}
          </colgroup>
          <thead>
            <tr className="bg-paper text-left text-[11px] uppercase tracking-wide text-muted">
              <th className={`${TH} text-center`}>STT</th>
              <th className={TH}>Mã QL</th>
              <th className={TH}>Tên dự án</th>
              <th className={TH}>Nhóm</th>
              <th className={TH}>DOSCO担当</th>
              <th className={TH} title="Ngày nhận">Time in</th>
              <th className={TH} title="Ngày hoàn thành">Time out</th>
              <th className={TH}>Trạng thái</th>
              <th className={`${TH} text-right`}>Doanh thu</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td className={`${TD} text-center text-muted`} colSpan={9}>Đang tải…</td>
              </tr>
            )}

            {!loading && rows.length === 0 && (
              <tr>
                <td className={`${TD} text-center text-muted`} colSpan={9}>
                  Không tìm thấy dự án nào khớp với bộ lọc.
                </td>
              </tr>
            )}

            {rows.map((p, i) => {
              const st = PROJECT_STATUS[effectiveStatus(p)] ?? PROJECT_STATUS.PLANNING;
              return (
                <tr
                  key={p.id}
                  onClick={() => router.push(`/projects/${p.id}`)}
                  className={`cursor-pointer transition-colors ${i % 2 === 0 ? "bg-white" : "bg-slate-50/30"} hover:bg-sky-50/50`}
                >
                  {/* Dự án GHIM nhảy lên đầu — gắn ★ để biết vì sao nó ở trên. */}
                  <td className={`${TD} text-center text-[10px] text-slate-500`}>
                    {pinnedIds.includes(p.id) ? (
                      <span className="inline-flex items-center gap-0.5" title="Dự án đã ghim (ghim/bỏ ghim ở trang Dự án)">
                        <StarIconSolid className="h-3 w-3 text-amber" />
                        {i + 1}
                      </span>
                    ) : (
                      i + 1
                    )}
                  </td>
                  <td className={`${TD} whitespace-nowrap font-mono text-[13px] font-bold text-bad`}>
                    {p.code}
                  </td>
                  <td className={`${TD} font-semibold text-ink`}>
                    <div className="truncate" title={p.name}>{p.name}</div>
                  </td>
                  <td className={`${TD} text-muted`}>
                    <div className="truncate" title={groupLabel(p.group_name)}>
                      {DEPT_JA[normalizeDept(p.group_name)] || normalizeDept(p.group_name) || "—"}
                    </div>
                  </td>
                  <td className={`${TD} text-muted`}>
                    <div className="flex items-center gap-1 truncate" title={p.dosco_manager || ""}>
                      {p.dosco_manager && <StarIconSolid className="h-3 w-3 shrink-0 text-amber" />}
                      <span className="truncate">{p.dosco_manager || "—"}</span>
                    </div>
                  </td>
                  <td className={`${TD} whitespace-nowrap text-muted tnum`}>{dm(p.start_date)}</td>
                  <td className={`${TD} whitespace-nowrap text-muted tnum`}>{dm(p.end_date)}</td>
                  <td className={TD}>
                    <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ${st.cls}`}>
                      {st.label}
                    </span>
                  </td>
                  {/* Ô nhập doanh thu — chung dữ liệu với cột Doanh thu ở bảng Dự án */}
                  <td
                    className={`${TD} whitespace-nowrap text-right`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {canEdit(p) ? (
                      <input
                        type="text"
                        inputMode="numeric"
                        value={edits[p.id] ?? groupNumber(p.revenue)}
                        onChange={(e) => setEdits((s) => ({ ...s, [p.id]: e.target.value }))}
                        onBlur={() => saveRevenue(p)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            (e.target as HTMLInputElement).blur();
                          }
                          if (e.key === "Escape") {
                            setEdits((s) => {
                              const n = { ...s };
                              delete n[p.id];
                              return n;
                            });
                          }
                        }}
                        placeholder="—"
                        title={p.revenue != null && p.revenue !== "" ? formatVND(p.revenue) : "Nhập doanh thu (VND)"}
                        className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-right text-[12px] font-semibold text-ink tnum outline-none transition-colors placeholder:text-line hover:border-line focus:border-steel focus:bg-white"
                      />
                    ) : (
                      <span className="block truncate font-semibold text-ink tnum" title={formatVND(p.revenue)}>
                        {p.revenue != null && p.revenue !== "" ? formatVND(p.revenue) : "—"}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>

          {rows.length > 0 && (
            <tfoot>
              <tr className="sticky bottom-0 bg-paper font-bold">
                <td className={`${TD} text-right text-[11px] uppercase tracking-wide text-muted`} colSpan={8}>
                  Tổng cộng ({rows.length} dự án)
                </td>
                <td className={`${TD} whitespace-nowrap text-right text-[13px] text-ink tnum`}>
                  {formatVND(tong)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="mt-2 text-[11px] text-muted">
        Bấm vào một hàng để xem chi tiết dự án. Số liệu dùng chung với cột Doanh thu ở bảng Dự án.
      </p>
    </AppShell>
  );
}
