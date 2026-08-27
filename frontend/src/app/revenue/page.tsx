"use client";

// Trang DOANH THU — cùng bố cục bảng với trang Dự án, nhưng xoay quanh tiền:
// bỏ bớt các cột vận hành (tiến độ, giờ công, ghi chú), giữ lại phần nhận diện
// dự án + ô nhập Doanh thu, và cộng TỔNG ở cuối bảng.
// Số liệu dùng chung trường `revenue` với bảng Dự án -> sửa bên nào cũng khớp.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { StarIcon as StarIconOutline } from "@heroicons/react/24/outline";
import { StarIcon as StarIconSolid } from "@heroicons/react/24/solid";
import AppShell from "@/components/app-shell";
import { api } from "@/lib/api";
import { isSeniorManagerUp } from "@/lib/roles";
import { PRESET_DEPARTMENTS } from "@/lib/departments";
import { getProjectDept } from "@/lib/groups";
import { formatVND } from "@/lib/format";
import type { Project, User } from "@/lib/types";

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

/** Số giờ -> "X,X ngày" (8 giờ = 1 ngày, cùng quy ước với Real time). */
function hoursToDays(h: number): string {
  return (Math.round((h / 8) * 10) / 10).toLocaleString("vi-VN", { maximumFractionDigits: 1 });
}

/** "12,5" / "12.5" -> 12.5 ; rỗng -> null. */
function parseHours(v: string): number | null {
  const t = v.replace(/,/g, ".").replace(/[^\d.]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Decimal "16.00" từ backend -> "16" cho gọn ô nhập. */
function plainNumber(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : "";
}

/** DOANH THU = Time khách hàng × Đơn giá. Không còn lấy từ ô nhập tay nữa. */
function revenueOf(p: Project): number {
  const h = Number(p.client_hours ?? 0);
  const price = Number(p.unit_price ?? 0);
  return h > 0 && price > 0 ? h * price : 0;
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

export default function RevenuePage() {
  const router = useRouter();

  const [projects, setProjects] = useState<Project[]>([]);
  const [me, setMe] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const [searchQuery, setSearchQuery] = useState("");
  const [filterDept, setFilterDept] = useState("");
  const [filterMonth, setFilterMonth] = useState("");

  // Khoá nháp là chuỗi "<id dự án>:<tên trường>" vì mỗi hàng có 3 ô nhập.
  const [edits, setEdits] = useState<Record<string, string>>({});

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

  /** Ghim / bỏ ghim — ghi vào CÙNG chỗ lưu với trang Dự án & Tiến độ và bắn
   *  sự kiện để các trang đang mở cùng đổi thứ tự ngay, không phải tải lại. */
  const togglePin = useCallback(
    (pid: number) => {
      // Tính TRƯỚC rồi mới setState — không đặt ghi localStorage / bắn sự kiện vào
      // trong hàm cập nhật state, vì React gọi hàm đó nhiều lần và listener đồng bộ
      // sẽ ghi đè ngược lại làm cú bấm đầu tiên mất tác dụng.
      const next = pinnedIds.includes(pid)
        ? pinnedIds.filter((id) => id !== pid)
        : [...pinnedIds, pid];
      setPinnedIds(next);
      try {
        localStorage.setItem("timesheet_pinned_projects", JSON.stringify(next));
        window.dispatchEvent(new CustomEvent("pinned_projects_changed", { detail: next }));
      } catch {}
    },
    [pinnedIds],
  );

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

  const tong = useMemo(() => rows.reduce((s, p) => s + revenueOf(p), 0), [rows]);
  const soCoDoanhThu = useMemo(() => rows.filter((p) => revenueOf(p) > 0).length, [rows]);
  const tongGioKhach = useMemo(
    () => rows.reduce((s, p) => s + Number(p.client_hours ?? 0), 0),
    [rows],
  );

  /** Các ô nhập được trên trang này. Khoá nháp = "<id>:<trường>". */
  type Field = "manual_hours" | "client_hours" | "unit_price";
  const keyOf = (p: Project, f: Field) => `${p.id}:${f}`;

  /** Lưu 1 ô — rời ô là gọi. Giá trị bằng cũ thì bỏ qua, không gọi mạng. */
  async function saveField(p: Project, field: Field) {
    const k = keyOf(p, field);
    const draft = edits[k];
    if (draft === undefined) return;
    const clear = () =>
      setEdits((s) => {
        const n = { ...s };
        delete n[k];
        return n;
      });
    const next = field === "unit_price" ? parseMoney(draft) : parseHours(draft);
    const raw = p[field];
    const cur = raw == null || raw === "" ? null : Number(raw);
    if (next === cur) {
      clear();
      return;
    }
    try {
      const updated = await api.updateProject(p.id, { [field]: next });
      setProjects((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    } catch (err: any) {
      alert(err?.message || "Không lưu được, thử lại giúp mình.");
    } finally {
      clear();
    }
  }

  /** Ô nhập dùng chung cho Manual time / Time khách hàng / Đơn giá. */
  const cellInput = (p: Project, field: Field, opts: { align: string; title: string }) => {
    const k = keyOf(p, field);
    const shown =
      edits[k] ?? (field === "unit_price" ? groupNumber(p[field]) : plainNumber(p[field]));
    return (
      <input
        type="text"
        inputMode={field === "unit_price" ? "numeric" : "decimal"}
        value={shown}
        onChange={(e) => setEdits((st) => ({ ...st, [k]: e.target.value }))}
        onBlur={() => saveField(p, field)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === "Escape") {
            setEdits((st) => {
              const n = { ...st };
              delete n[k];
              return n;
            });
          }
        }}
        placeholder="—"
        title={opts.title}
        className={`w-full rounded border border-transparent bg-transparent px-1 py-0.5 ${opts.align} text-[12px] font-semibold text-ink tnum outline-none transition-colors placeholder:text-line hover:border-line focus:border-steel focus:bg-white`}
      />
    );
  };

  const TH = "border border-line font-semibold whitespace-nowrap sticky top-0 bg-paper z-10 px-1.5 py-1.5";
  const TD = "border border-line align-middle px-1.5 py-1.5";

  return (
    <AppShell maxWidthClass="max-w-md lg:max-w-[1600px]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">Doanh thu</h1>
          <p className="mt-0.5 text-xs text-muted">
            Doanh thu = <b className="text-ink">Time khách hàng × Đơn giá</b>. Gõ thẳng vào ô, rời ô là tự lưu.
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
            <span className="block text-[10px] text-muted">Giờ khách hàng</span>
            <span className="block text-sm font-bold text-steel tnum">
              {tongGioKhach.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}h
            </span>
          </div>
          <div className="border-l border-line pl-3">
            <span className="block text-[10px] text-muted">Đã tính</span>
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
        <table className="w-full min-w-[1030px] table-fixed border-collapse text-[11px]">
          <colgroup>
            <col className="w-[40px]" />    {/* STT */}
            <col className="w-[26px]" />    {/* Ghim ★ */}
            <col className="w-[132px]" />   {/* Mã QL + nhãn "Ghim" */}
            <col className="w-[300px]" />   {/* Tên dự án */}
            <col className="w-[96px]" />    {/* Manual time */}
            <col className="w-[96px]" />    {/* Realtime (AI) */}
            <col className="w-[104px]" />   {/* Time khách hàng */}
            <col className="w-[124px]" />   {/* Đơn giá */}
            <col className="w-[156px]" />   {/* Doanh thu */}
          </colgroup>
          <thead>
            <tr className="bg-paper text-left text-[11px] uppercase tracking-wide text-muted">
              <th className={`${TH} text-center`}>STT</th>
              <th className={`${TH} text-center text-amber`} title="Ghim yêu thích lên đầu">★</th>
              <th className={TH}>Mã QL</th>
              <th className={TH}>Tên dự án</th>
              <th className={`${TH} text-center`} title="Giờ nhập tay — dùng chung với cột Manual time ở bảng Dự án">
                Manual time
              </th>
              <th className={`${TH} text-center`} title="Giờ thực tế lấy từ chấm công tiến độ — dùng chung với cột Real time ở bảng Dự án">
                Realtime (AI)
              </th>
              <th className={`${TH} text-center`} title="Số giờ tính tiền với khách hàng">
                Time khách hàng
              </th>
              <th className={`${TH} text-right`} title="Đơn giá cho mỗi giờ (VND)">
                Đơn giá <span className="normal-case text-[9px]">(₫/giờ)</span>
              </th>
              <th className={`${TH} text-right`} title="Time khách hàng × Đơn giá">Doanh thu</th>
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
              const isPinned = pinnedIds.includes(p.id);
              return (
                <tr
                  key={p.id}
                  onClick={() => router.push(`/projects/${p.id}`)}
                  className={`cursor-pointer transition-colors ${i % 2 === 0 ? "bg-white" : "bg-slate-50/30"} hover:bg-sky-50/50`}
                >
                  <td className={`${TD} text-center text-[10px] text-slate-500`}>{i + 1}</td>

                  {/* GHIM — bấm để ghim/bỏ ghim, giống hệt bảng Dự án. Dùng chung
                      danh sách ghim nên ghim ở đây thì bên Dự án cũng lên đầu. */}
                  <td
                    className={`${TD} text-center`}
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePin(p.id);
                    }}
                  >
                    <button
                      type="button"
                      className="cursor-pointer p-0.5 transition-transform hover:scale-125 focus:outline-none"
                      title={isPinned ? "Bỏ ghim dự án" : "Ghim dự án lên đầu bảng"}
                    >
                      {isPinned ? (
                        <StarIconSolid className="h-4 w-4 text-amber" />
                      ) : (
                        <StarIconOutline className="h-4 w-4 text-slate-300 hover:text-amber" />
                      )}
                    </button>
                  </td>

                  <td className={`${TD} whitespace-nowrap font-mono text-[13px] font-bold text-bad`}>
                    <span>{p.code}</span>
                  </td>
                  <td className={`${TD} font-semibold text-ink`}>
                    <div className="truncate" title={p.name}>{p.name}</div>
                  </td>
                  {/* MANUAL TIME — dùng chung trường manual_hours với bảng Dự án */}
                  <td
                    className={`${TD} whitespace-nowrap text-center`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {(() => {
                      const shown = edits[keyOf(p, "manual_hours")] ?? plainNumber(p.manual_hours);
                      const h = parseHours(shown) ?? 0;
                      return (
                        <div className="flex flex-col items-center">
                          <span className="text-[11px] font-bold text-ink tnum">
                            {h > 0 ? `${hoursToDays(h)} ngày` : "0 ngày"}
                          </span>
                          {canEdit(p) ? (
                            <span className="flex items-center justify-center text-[10px] text-muted">
                              (
                              <span className="w-9">
                                {cellInput(p, "manual_hours", { align: "text-center", title: "Nhập SỐ GIỜ (8 giờ = 1 ngày)" })}
                              </span>
                              h)
                            </span>
                          ) : (
                            <span className="text-[10px] text-muted tnum">({h}h)</span>
                          )}
                        </div>
                      );
                    })()}
                  </td>

                  {/* REALTIME (AI) — chỉ xem, lấy từ chấm công tiến độ */}
                  <td className={`${TD} whitespace-nowrap text-center`}>
                    <div className="flex flex-col items-center">
                      <span className="text-[11px] font-bold text-ink tnum">
                        {p.total_days && p.total_days > 0 ? `${p.total_days} ngày` : "0 ngày"}
                      </span>
                      {p.total_hours && p.total_hours > 0 ? (
                        <span className="text-[10px] text-muted tnum">({p.total_hours}h)</span>
                      ) : null}
                    </div>
                  </td>

                  {/* TIME KHÁCH HÀNG — số giờ tính tiền */}
                  <td
                    className={`${TD} whitespace-nowrap text-center`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {canEdit(p) ? (
                      cellInput(p, "client_hours", { align: "text-center", title: "Số giờ tính tiền với khách" })
                    ) : (
                      <span className="text-[12px] font-semibold text-ink tnum">
                        {plainNumber(p.client_hours) || "—"}
                      </span>
                    )}
                  </td>

                  {/* ĐƠN GIÁ (₫/giờ) */}
                  <td
                    className={`${TD} whitespace-nowrap text-right`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {canEdit(p) ? (
                      cellInput(p, "unit_price", { align: "text-right", title: "Đơn giá mỗi giờ (VND)" })
                    ) : (
                      <span className="text-[12px] font-semibold text-ink tnum">
                        {groupNumber(p.unit_price) || "—"}
                      </span>
                    )}
                  </td>
                  {/* DOANH THU — TÍNH RA, không nhập: Time khách hàng × Đơn giá */}
                  <td className={`${TD} whitespace-nowrap text-right`}>
                    {revenueOf(p) > 0 ? (
                      <span
                        className="block truncate font-bold text-ink tnum"
                        title={`${plainNumber(p.client_hours)}h × ${groupNumber(p.unit_price)}₫ = ${formatVND(revenueOf(p))}`}
                      >
                        {formatVND(revenueOf(p))}
                      </span>
                    ) : (
                      <span className="text-muted" title="Cần nhập cả Time khách hàng và Đơn giá">—</span>
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
        Bấm vào một hàng để xem chi tiết dự án. <b className="text-ink">Manual time</b> và{" "}
        <b className="text-ink">Realtime (AI)</b> dùng chung số liệu với bảng Dự án.
      </p>
    </AppShell>
  );
}
