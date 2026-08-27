"use client";

// Trang DOANH THU — mỗi dự án có đơn giá Yên (¥/h) riêng, lưu vào trường unit_price.
// Cách nhập: click vào hàng dự án → thanh chuyển đổi Vietcombank "kích hoạt" cho dự án đó.
// Nhập số Yên ở thanh trên → chỉ cập nhật doanh thu của dự án đang chọn. Rời ô là tự lưu.
// Doanh thu (VNĐ) = Time khách hàng (h) × Đơn giá Yên (¥/h) × Tỷ giá Vietcombank Realtime.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  StarIcon as StarIconOutline,
  ArrowPathIcon,
  ArrowRightIcon,
  CursorArrowRippleIcon,
} from "@heroicons/react/24/outline";
import { StarIcon as StarIconSolid } from "@heroicons/react/24/solid";
import AppShell from "@/components/app-shell";
import { api } from "@/lib/api";
import { isSeniorManagerUp } from "@/lib/roles";
import { PRESET_DEPARTMENTS } from "@/lib/departments";
import { getProjectDept } from "@/lib/groups";
import { formatVND } from "@/lib/format";
import type { Project, User } from "@/lib/types";

/** Số giờ -> "X,X ngày" (8 giờ = 1 ngày). */
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

/** Số -> "1.000" để hiện trong ô. */
function groupNumber(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("vi-VN", { maximumFractionDigits: 0 }) : "";
}

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

  // Tỷ giá Vietcombank Realtime
  const [vcbData, setVcbData] = useState<{
    source: string;
    updated_at: string;
    jpy: { currency_code: string; currency_name: string; buy: number; transfer: number; sell: number };
  } | null>(null);
  const [vcbLoading, setVcbLoading] = useState(false);

  const [rateType, setRateType] = useState<"transfer" | "buy" | "sell">(() => {
    if (typeof window === "undefined") return "transfer";
    try { return (localStorage.getItem("revenue_vcb_rate_type") as any) || "transfer"; }
    catch { return "transfer"; }
  });

  // Dự án đang được chọn để nhập đơn giá Yên trên thanh converter
  const [activeProjectId, setActiveProjectId] = useState<number | null>(null);
  // Nháp đơn giá Yên đang nhập trên thanh converter (chuỗi để hiện trong ô)
  const [jpyDraft, setJpyDraft] = useState<string>("");
  const jpyInputRef = useRef<HTMLInputElement>(null);

  // Khoá nháp cho ô Time khách hàng / Manual time trong bảng
  const [edits, setEdits] = useState<Record<string, string>>({});

  const [pinnedIds, setPinnedIds] = useState<number[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const saved = localStorage.getItem("timesheet_pinned_projects");
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  const fetchVcb = useCallback((force = false) => {
    setVcbLoading(true);
    api.getVcbRate(force)
      .then((data) => setVcbData(data))
      .catch(() => {})
      .finally(() => setVcbLoading(false));
  }, []);

  useEffect(() => {
    fetchVcb();
    const timer = setInterval(() => fetchVcb(false), 2 * 60 * 1000);
    return () => clearInterval(timer);
  }, [fetchVcb]);

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

  const togglePin = useCallback(
    (pid: number) => {
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

  const canEdit = (p: Project) =>
    isSeniorManagerUp(me) || !!me?.has_subordinates || (!!me && p.lead_id === me.id);

  const uniqueDepts = useMemo(
    () =>
      Array.from(
        new Set([...PRESET_DEPARTMENTS, ...projects.map((p) => getProjectDept(p)).filter(Boolean)]),
      ).sort(),
    [projects],
  );

  const currentVcbRate = useMemo(() => {
    if (!vcbData?.jpy) return 159.90;
    return vcbData.jpy[rateType] || vcbData.jpy.transfer || 159.90;
  }, [vcbData, rateType]);

  const handleRateTypeChange = (t: "transfer" | "buy" | "sell") => {
    setRateType(t);
    try { localStorage.setItem("revenue_vcb_rate_type", t); } catch {}
  };

  /** Chọn dự án để nhập đơn giá trên thanh converter */
  const selectProject = useCallback((p: Project) => {
    setActiveProjectId(p.id);
    // Hiển thị đơn giá hiện tại của dự án đó (nếu có) vào ô nhập
    const cur = Number(p.unit_price ?? 0);
    setJpyDraft(cur > 0 ? groupNumber(cur) : "");
    // Focus vào ô nhập JPY
    setTimeout(() => jpyInputRef.current?.focus(), 80);
  }, []);

  /** Lưu đơn giá Yên của dự án đang chọn */
  const saveJpyForActive = useCallback(async () => {
    if (activeProjectId === null) return;
    const p = projects.find((x) => x.id === activeProjectId);
    if (!p) return;

    const rawNum = jpyDraft.replace(/\./g, "").replace(/,/g, "").replace(/[^\d]/g, "");
    const next = rawNum ? Number(rawNum) : null;
    const cur = p.unit_price != null && p.unit_price !== "" ? Number(p.unit_price) : null;
    if (next === cur) return;

    try {
      const updated = await api.updateProject(p.id, { unit_price: next });
      setProjects((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    } catch (err: any) {
      alert(err?.message || "Không lưu được, thử lại giúp mình.");
    }
  }, [activeProjectId, jpyDraft, projects]);

  /** Doanh thu từng dự án (VNĐ) = Time khách hàng × Đơn giá Yên × Tỷ giá Vietcombank */
  const revenueOf = useCallback((p: Project): number => {
    const h = Number(p.client_hours ?? 0);
    const jpy = Number(p.unit_price ?? 0);
    return h > 0 && jpy > 0 ? Math.round(h * jpy * currentVcbRate) : 0;
  }, [currentVcbRate]);

  const rows = useMemo(() => {
    const list = projects.filter((p) => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!(p.name || "").toLowerCase().includes(q) && !(p.code || "").toLowerCase().includes(q)) return false;
      }
      if (filterDept && getProjectDept(p) !== filterDept) return false;
      if (filterMonth && (p.start_date || "").slice(0, 7) !== filterMonth) return false;
      return true;
    });
    const pinnedSet = new Set(pinnedIds);
    return [...list].sort((a, b) => {
      const aPin = pinnedSet.has(a.id) ? 1 : 0;
      const bPin = pinnedSet.has(b.id) ? 1 : 0;
      if (aPin !== bPin) return bPin - aPin;
      const ta = parseTimestamp(a.start_date);
      const tb = parseTimestamp(b.start_date);
      if (ta !== null && tb !== null) return ta !== tb ? ta - tb : (a.code || "").localeCompare(b.code || "", "vi");
      if (ta !== null) return -1;
      if (tb !== null) return 1;
      return (a.code || "").localeCompare(b.code || "", "vi");
    });
  }, [projects, searchQuery, filterDept, filterMonth, pinnedIds]);

  const tong = useMemo(() => rows.reduce((s, p) => s + revenueOf(p), 0), [rows, revenueOf]);
  const soCoDoanhThu = useMemo(() => rows.filter((p) => revenueOf(p) > 0).length, [rows, revenueOf]);
  const tongGioKhach = useMemo(() => rows.reduce((s, p) => s + Number(p.client_hours ?? 0), 0), [rows]);

  // Dự án đang active trên thanh converter
  const activeProject = useMemo(() => projects.find((p) => p.id === activeProjectId) ?? null, [projects, activeProjectId]);

  // Số Yên đang nhập (parse) và VNĐ quy đổi tương ứng
  const parsedJpy = Number(jpyDraft.replace(/\./g, "").replace(/,/g, "").replace(/[^\d]/g, "")) || 0;
  const calcVnd = Math.round(parsedJpy * currentVcbRate);

  type RowField = "manual_hours" | "client_hours";
  const keyOf = (p: Project, f: RowField) => `${p.id}:${f}`;

  async function saveRowField(p: Project, field: RowField) {
    const k = keyOf(p, field);
    const draft = edits[k];
    if (draft === undefined) return;
    const clear = () => setEdits((s) => { const n = { ...s }; delete n[k]; return n; });
    const next = parseHours(draft);
    const cur = p[field] == null || p[field] === "" ? null : Number(p[field]);
    if (next === cur) { clear(); return; }
    try {
      const updated = await api.updateProject(p.id, { [field]: next });
      setProjects((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    } catch (err: any) {
      alert(err?.message || "Không lưu được, thử lại giúp mình.");
    } finally { clear(); }
  }

  const cellInput = (p: Project, field: RowField, opts: { align: string; title: string }) => {
    const k = keyOf(p, field);
    const shown = edits[k] ?? plainNumber(p[field]);
    return (
      <input
        type="text" inputMode="decimal"
        value={shown}
        onChange={(e) => setEdits((st) => ({ ...st, [k]: e.target.value }))}
        onBlur={() => saveRowField(p, field)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
          if (e.key === "Escape") setEdits((st) => { const n = { ...st }; delete n[k]; return n; });
        }}
        placeholder="—" title={opts.title}
        className={`w-full rounded border border-transparent bg-transparent px-1 py-0.5 ${opts.align} text-[12px] font-semibold text-ink tnum outline-none transition-colors placeholder:text-line hover:border-line focus:border-steel focus:bg-white`}
      />
    );
  };

  const TH = "border border-line font-semibold whitespace-nowrap sticky top-0 bg-paper z-10 px-2 py-2";
  const TD = "border border-line align-middle px-2 py-2";

  return (
    <AppShell maxWidthClass="max-w-md lg:max-w-none">
      {/* Header & Thẻ Tổng */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">Doanh thu</h1>
          <p className="mt-0.5 text-xs text-muted">
            Doanh thu = <b className="text-ink">Time khách hàng × Đơn giá Yên × Tỷ giá Vietcombank Realtime</b>.{" "}
            <span className="text-amber-700 font-semibold">Click vào hàng dự án</span> → nhập số Yên trên thanh chuyển đổi.
          </p>
        </div>
        <div className="flex items-center gap-4 rounded-xl2 border border-line bg-white px-5 py-3 shadow-card">
          <div>
            <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted">Tổng doanh thu (VNĐ)</span>
            <span className="block text-xl font-extrabold text-emerald-700 tnum">{formatVND(tong)}</span>
          </div>
          <div className="border-l border-line pl-3.5">
            <span className="block text-[10px] text-muted">Giờ khách hàng</span>
            <span className="block text-sm font-bold text-steel tnum">{tongGioKhach.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}h</span>
          </div>
          <div className="border-l border-line pl-3.5">
            <span className="block text-[10px] text-muted">Đã tính</span>
            <span className="block text-sm font-bold text-steel tnum">{soCoDoanhThu}/{rows.length}</span>
          </div>
        </div>
      </div>

      {/* THANH CHUYỂN ĐỔI VIETCOMBANK — kích hoạt khi click vào 1 hàng */}
      <div className={`mt-4 rounded-2xl border p-4 shadow-sm transition-all duration-200 ${
        activeProject
          ? "border-emerald-400 bg-gradient-to-r from-emerald-50 via-white to-emerald-50 ring-2 ring-emerald-200"
          : "border-slate-200/80 bg-gradient-to-r from-slate-50/50 via-white to-slate-50/50"
      }`}>
        {/* Header thanh */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-emerald-100/80 pb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-600 text-white font-bold text-xs shadow-sm">VCB</div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm font-bold text-slate-800">Chuyển đổi ngoại tệ Vietcombank (Realtime)</h2>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  1 JPY = {currentVcbRate.toLocaleString("vi-VN", { maximumFractionDigits: 2 })} ₫
                </span>
              </div>
              {activeProject ? (
                <p className="text-[11px] font-semibold text-emerald-800">
                  🎯 Đang nhập cho:{" "}
                  <span className="font-mono text-bad">{activeProject.code}</span>{" "}
                  <span className="text-ink">{activeProject.name}</span>
                  {Number(activeProject.unit_price ?? 0) > 0 && (
                    <span className="ml-1 text-slate-500">(hiện: {groupNumber(activeProject.unit_price)} ¥/h)</span>
                  )}
                </p>
              ) : (
                <p className="flex items-center gap-1 text-[11px] text-slate-500">
                  <CursorArrowRippleIcon className="h-3.5 w-3.5" />
                  Click vào một dự án trong bảng bên dưới để nhập đơn giá Yên cho dự án đó
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-xl bg-slate-200/70 p-0.5 text-xs font-semibold">
              {(["buy", "transfer", "sell"] as const).map((t) => {
                const labels = { buy: "Mua TM", transfer: "Chuyển khoản", sell: "Bán" };
                return (
                  <button key={t} type="button" onClick={() => handleRateTypeChange(t)}
                    className={`rounded-lg px-2.5 py-1 transition-all cursor-pointer ${
                      rateType === t ? "bg-emerald-600 text-white shadow-sm font-bold" : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    {labels[t]} ({vcbData?.jpy?.[t]?.toLocaleString("vi-VN", { maximumFractionDigits: 2 }) ?? "—"}₫)
                  </button>
                );
              })}
            </div>
            <button type="button" onClick={() => fetchVcb(true)} disabled={vcbLoading}
              className="inline-flex items-center gap-1 rounded-xl border border-emerald-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-50 transition-colors cursor-pointer disabled:opacity-50"
            >
              <ArrowPathIcon className={`h-3.5 w-3.5 ${vcbLoading ? "animate-spin" : ""}`} />
              <span className="text-[11px]">{vcbLoading ? "Đang cập nhật…" : `${vcbData?.updated_at || "—"}`}</span>
            </button>
          </div>
        </div>

        {/* Khu nhập Yên → VNĐ */}
        <div className="mt-3.5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 items-center gap-3">
          {/* Ô nhập JPY */}
          <div className={`lg:col-span-5 rounded-xl border p-3 shadow-2xs transition-all ${
            activeProject ? "border-emerald-400 bg-white ring-2 ring-emerald-100" : "border-slate-200 bg-slate-50"
          }`}>
            <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">
              ĐƠN GIÁ YÊN NHẬT (JPY/H){activeProject ? ` — ${activeProject.code}` : ""}
            </span>
            <div className="mt-1.5 flex items-center gap-2">
              <span className="shrink-0 inline-flex items-center gap-1 bg-slate-100 px-2 py-0.5 rounded text-xs font-bold text-slate-700">🇯🇵 JPY</span>
              <input
                ref={jpyInputRef}
                type="text" inputMode="numeric"
                value={jpyDraft}
                disabled={!activeProject}
                onChange={(e) => setJpyDraft(e.target.value)}
                onBlur={saveJpyForActive}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
                  if (e.key === "Escape") { setJpyDraft(groupNumber(activeProject?.unit_price)); }
                }}
                placeholder={activeProject ? "Nhập số Yên/giờ..." : "← Click chọn dự án trước"}
                className="w-full text-base font-extrabold text-slate-800 outline-none tnum bg-transparent disabled:text-slate-400 disabled:cursor-not-allowed"
              />
              <span className="text-xs font-medium text-slate-400 shrink-0">¥ / h</span>
            </div>
          </div>

          {/* Mũi tên */}
          <div className="lg:col-span-2 flex flex-col items-center justify-center gap-1">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <ArrowRightIcon className="h-4 w-4 stroke-2" />
            </div>
            {parsedJpy > 0 && (
              <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                ×{currentVcbRate.toLocaleString("vi-VN", { maximumFractionDigits: 2 })}
              </span>
            )}
          </div>

          {/* Kết quả VNĐ */}
          <div className={`lg:col-span-5 rounded-xl border p-3 shadow-2xs transition-all ${
            calcVnd > 0 ? "border-emerald-300 bg-emerald-50/80" : "border-slate-200 bg-slate-50/60"
          }`}>
            <span className="block text-[10px] font-bold uppercase tracking-wider text-emerald-800">
              ĐƠN GIÁ QUY ĐỔI VNĐ (VNĐ/H)
            </span>
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <span className="shrink-0 inline-flex items-center gap-1 bg-emerald-200/80 px-2 py-0.5 rounded text-xs font-bold text-emerald-900">🇻🇳 VND</span>
              <span className="text-lg font-black text-emerald-800 tnum truncate">
                {calcVnd > 0 ? formatVND(calcVnd) : "—"}
              </span>
              <span className="text-xs font-bold text-emerald-700 shrink-0">₫ / h</span>
            </div>
            {activeProject && calcVnd > 0 && Number(activeProject.client_hours ?? 0) > 0 && (
              <p className="mt-1 text-[10px] text-emerald-700 font-medium">
                → Doanh thu dự án: {formatVND(Math.round(Number(activeProject.client_hours) * parsedJpy * currentVcbRate))}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Bộ lọc */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="min-w-[240px] flex-1">
          <input type="text" placeholder="Tìm theo tên hoặc mã quản lý..." value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl2 border border-line bg-white px-3 py-2 text-xs outline-none placeholder:text-muted focus:border-steel"
          />
        </div>
        {isSeniorManagerUp(me) && (
          <div className="w-full sm:w-[200px]">
            <select value={filterDept} onChange={(e) => setFilterDept(e.target.value)}
              className="w-full rounded-xl2 border border-line bg-white px-3 py-2.5 text-xs text-ink outline-none focus:border-steel"
            >
              <option value="">— Tất cả phòng ban —</option>
              {uniqueDepts.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        )}
        <input type="month" value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)}
          title="Lọc theo tháng nhận việc"
          className="rounded-xl2 border border-line bg-white px-3 py-2 text-xs text-ink outline-none focus:border-steel"
        />
        {(searchQuery || filterDept || filterMonth) && (
          <button onClick={() => { setSearchQuery(""); setFilterDept(""); setFilterMonth(""); }}
            className="text-xs font-semibold text-steel hover:text-ink hover:underline cursor-pointer"
          >Xóa bộ lọc</button>
        )}
      </div>

      <p className="mt-2 text-xs text-muted">Tìm thấy: <b className="text-ink">{rows.length}</b> dự án</p>

      {/* BẢNG — không có cột Đơn giá, click hàng để nhập */}
      <div className="mt-3 max-h-[calc(100vh-360px)] overflow-auto rounded-xl2 border border-line bg-white shadow-card">
        <table className="w-full min-w-[920px] table-fixed border-collapse text-[11px]">
          <colgroup>
            <col className="w-[40px]" />
            <col className="w-[26px]" />
            <col className="w-[132px]" />
            <col className="w-[300px]" />
            <col className="w-[96px]" />
            <col className="w-[96px]" />
            <col className="w-[120px]" />
            <col className="w-[170px]" />
          </colgroup>
          <thead>
            <tr className="bg-paper text-left text-[11px] uppercase tracking-wide text-muted">
              <th className={`${TH} text-center`}>STT</th>
              <th className={`${TH} text-center text-amber`} title="Ghim yêu thích lên đầu">★</th>
              <th className={TH}>Mã QL</th>
              <th className={TH}>Tên dự án</th>
              <th className={`${TH} text-center`}>Manual time</th>
              <th className={`${TH} text-center`}>Realtime (AI)</th>
              <th className={`${TH} text-center`}>Time khách hàng (h)</th>
              <th className={`${TH} text-right`} title="Click hàng dự án để nhập đơn giá Yên trên thanh bên trên">
                Doanh thu (VNĐ)
              </th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td className={`${TD} text-center text-muted`} colSpan={8}>Đang tải…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td className={`${TD} text-center text-muted`} colSpan={8}>Không tìm thấy dự án nào khớp với bộ lọc.</td></tr>
            )}
            {rows.map((p, i) => {
              const isPinned = pinnedIds.includes(p.id);
              const rev = revenueOf(p);
              const isActive = p.id === activeProjectId;

              return (
                <tr
                  key={p.id}
                  className={`cursor-pointer transition-all duration-150 ${
                    isActive
                      ? "bg-emerald-50 ring-1 ring-inset ring-emerald-300"
                      : i % 2 === 0 ? "bg-white hover:bg-emerald-50/30" : "bg-slate-50/30 hover:bg-emerald-50/30"
                  }`}
                  onClick={(e) => {
                    // Nếu click vào ô đang edit (input) thì không chuyển trang
                    if ((e.target as HTMLElement).tagName === "INPUT") return;
                    // Nếu đang active và bấm lần nữa → điều hướng vào chi tiết
                    if (isActive) {
                      router.push(`/projects/${p.id}`);
                    } else {
                      // Lần đầu click → chỉ kích hoạt lên thanh converter
                      if (canEdit(p)) selectProject(p);
                      else router.push(`/projects/${p.id}`);
                    }
                  }}
                >
                  <td className={`${TD} text-center text-[10px] text-slate-500`}>{i + 1}</td>

                  <td className={`${TD} text-center`} onClick={(e) => { e.stopPropagation(); togglePin(p.id); }}>
                    <button type="button" className="cursor-pointer p-0.5 transition-transform hover:scale-125 focus:outline-none"
                      title={isPinned ? "Bỏ ghim dự án" : "Ghim dự án lên đầu bảng"}
                    >
                      {isPinned ? <StarIconSolid className="h-4 w-4 text-amber" /> : <StarIconOutline className="h-4 w-4 text-slate-300 hover:text-amber" />}
                    </button>
                  </td>

                  <td className={`${TD} whitespace-nowrap font-mono text-[13px] font-bold text-bad`}>
                    <div className="flex items-center gap-1">
                      {isActive && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />}
                      <span>{p.code}</span>
                    </div>
                  </td>
                  <td className={`${TD} font-semibold text-ink`}>
                    <div className="truncate" title={p.name}>{p.name}</div>
                  </td>

                  {/* MANUAL TIME */}
                  <td className={`${TD} whitespace-nowrap text-center`} onClick={(e) => e.stopPropagation()}>
                    {(() => {
                      const shown = edits[keyOf(p, "manual_hours")] ?? plainNumber(p.manual_hours);
                      const h = parseHours(shown) ?? 0;
                      return (
                        <div className="flex flex-col items-center">
                          <span className="text-[11px] font-bold text-ink tnum">{h > 0 ? `${hoursToDays(h)} ngày` : "0 ngày"}</span>
                          {canEdit(p) ? (
                            <span className="flex items-center justify-center text-[10px] text-muted">(
                              <span className="w-9">{cellInput(p, "manual_hours", { align: "text-center", title: "Nhập SỐ GIỜ (8 giờ = 1 ngày)" })}</span>
                              h)
                            </span>
                          ) : (
                            <span className="text-[10px] text-muted tnum">({h}h)</span>
                          )}
                        </div>
                      );
                    })()}
                  </td>

                  {/* REALTIME (AI) */}
                  <td className={`${TD} whitespace-nowrap text-center`}>
                    <div className="flex flex-col items-center">
                      <span className="text-[11px] font-bold text-ink tnum">{p.total_days && p.total_days > 0 ? `${p.total_days} ngày` : "0 ngày"}</span>
                      {p.total_hours && p.total_hours > 0 ? <span className="text-[10px] text-muted tnum">({p.total_hours}h)</span> : null}
                    </div>
                  </td>

                  {/* TIME KHÁCH HÀNG */}
                  <td className={`${TD} whitespace-nowrap text-center`} onClick={(e) => e.stopPropagation()}>
                    {canEdit(p)
                      ? cellInput(p, "client_hours", { align: "text-center", title: "Số giờ tính tiền với khách hàng" })
                      : <span className="text-[12px] font-semibold text-ink tnum">{plainNumber(p.client_hours) || "—"}</span>
                    }
                  </td>

                  {/* DOANH THU */}
                  <td className={`${TD} whitespace-nowrap text-right`}>
                    <div className="flex flex-col items-end">
                      {rev > 0 ? (
                        <>
                          <span
                            className="font-extrabold text-emerald-800 text-[12px] tnum"
                            title={`${Number(p.client_hours)}h × ${groupNumber(p.unit_price)}¥ × ${currentVcbRate.toLocaleString("vi-VN", { maximumFractionDigits: 2 })}₫/¥ = ${formatVND(rev)}`}
                          >
                            {formatVND(rev)}
                          </span>
                          <span className="text-[9px] text-slate-400 tnum">{groupNumber(p.unit_price)} ¥/h</span>
                        </>
                      ) : (
                        <span
                          className={`text-[11px] ${isActive ? "text-emerald-600 font-semibold animate-pulse" : "text-muted"}`}
                          title={isActive ? "Đang chờ nhập đơn giá Yên trên thanh chuyển đổi bên trên" : "Click hàng này để nhập đơn giá Yên"}
                        >
                          {isActive ? "← Nhập ¥ ở trên" : "—"}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>

          {rows.length > 0 && (
            <tfoot>
              <tr className="sticky bottom-0 bg-paper font-bold border-t-2 border-slate-300">
                <td className={`${TD} text-right text-[11px] uppercase tracking-wide text-muted`} colSpan={7}>
                  Tổng cộng ({rows.length} dự án)
                </td>
                <td className={`${TD} whitespace-nowrap text-right text-[14px] font-black text-emerald-800 tnum`}>
                  {formatVND(tong)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="mt-2 text-[11px] text-muted">
        <b className="text-ink">Click 1 lần</b> vào hàng dự án → nhập đơn giá Yên trên thanh chuyển đổi.{" "}
        <b className="text-ink">Click thêm lần nữa</b> → vào trang chi tiết dự án. Doanh thu = Time khách hàng × Đơn giá Yên × Tỷ giá Vietcombank Realtime.
      </p>
    </AppShell>
  );
}
