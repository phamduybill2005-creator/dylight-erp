"use client";

// Trang DOANH THU — mỗi dự án có Đơn giá Yên (¥/giờ) và Time khách hàng (giờ) riêng biệt.
// Doanh thu (VNĐ) của từng dự án = Time khách hàng × Đơn giá Yên × Tỷ giá Vietcombank Realtime.
// Tỷ giá được đồng bộ và cập nhật liên tục từ ngân hàng Vietcombank.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  StarIcon as StarIconOutline,
  ArrowPathIcon,
  ArrowRightIcon,
} from "@heroicons/react/24/outline";
import { StarIcon as StarIconSolid } from "@heroicons/react/24/solid";
import AppShell from "@/components/app-shell";
import { api } from "@/lib/api";
import { isSeniorManagerUp } from "@/lib/roles";
import { PRESET_DEPARTMENTS } from "@/lib/departments";
import { getProjectDept } from "@/lib/groups";
import { formatVND } from "@/lib/format";
import type { Project, User } from "@/lib/types";

/** "78.000" -> 78000 ; rỗng -> null. */
function parseMoney(s: string): number | null {
  const t = s.replace(/[^\d]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Số -> "1.000" để hiện trong ô nhập đơn giá Yên. */
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

  // Tỷ giá Vietcombank Realtime
  const [vcbData, setVcbData] = useState<{
    source: string;
    updated_at: string;
    jpy: { currency_code: string; currency_name: string; buy: number; transfer: number; sell: number };
  } | null>(null);
  const [vcbLoading, setVcbLoading] = useState(false);

  // Loại tỷ giá: Mua chuyển khoản (transfer - mặc định) | Mua tiền mặt (buy) | Bán (sell)
  const [rateType, setRateType] = useState<"transfer" | "buy" | "sell">(() => {
    if (typeof window === "undefined") return "transfer";
    try {
      return (localStorage.getItem("revenue_vcb_rate_type") as any) || "transfer";
    } catch {
      return "transfer";
    }
  });

  // Công cụ quy đổi nhanh ngoại tệ ở thanh tiêu đề (Test Calculator)
  const [calcJpy, setCalcJpy] = useState<string>("1000");

  // Khoá nháp là chuỗi "<id dự án>:<tên trường>".
  const [edits, setEdits] = useState<Record<string, string>>({});

  // Dự án GHIM
  const [pinnedIds, setPinnedIds] = useState<number[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const saved = localStorage.getItem("timesheet_pinned_projects");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const fetchVcb = useCallback((force = false) => {
    setVcbLoading(true);
    api.getVcbRate(force)
      .then((data) => {
        setVcbData(data);
      })
      .catch(() => {})
      .finally(() => setVcbLoading(false));
  }, []);

  useEffect(() => {
    fetchVcb();
    // Tự động kiểm tra và làm mới tỷ giá từ Vietcombank mỗi 2 phút
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

  // Tỷ giá Vietcombank đang chọn (mặc định Mua chuyển khoản)
  const currentVcbRate = useMemo(() => {
    if (!vcbData?.jpy) return 159.90;
    return vcbData.jpy[rateType] || vcbData.jpy.transfer || 159.90;
  }, [vcbData, rateType]);

  /** Doanh thu từng dự án (VNĐ) = Time khách hàng (giờ) × Đơn giá Yên của dự án × Tỷ giá Vietcombank */
  const revenueOf = useCallback((p: Project): number => {
    const h = Number(p.client_hours ?? 0);
    const jpy = Number(p.unit_price ?? 0);
    return h > 0 && jpy > 0 && currentVcbRate > 0 ? Math.round(h * jpy * currentVcbRate) : 0;
  }, [currentVcbRate]);

  const handleRateTypeChange = (t: "transfer" | "buy" | "sell") => {
    setRateType(t);
    try {
      localStorage.setItem("revenue_vcb_rate_type", t);
    } catch {}
  };

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

  const tong = useMemo(() => rows.reduce((s, p) => s + revenueOf(p), 0), [rows, revenueOf]);
  const soCoDoanhThu = useMemo(() => rows.filter((p) => revenueOf(p) > 0).length, [rows, revenueOf]);
  const tongGioKhach = useMemo(
    () => rows.reduce((s, p) => s + Number(p.client_hours ?? 0), 0),
    [rows],
  );

  type Field = "manual_hours" | "client_hours" | "unit_price";
  const keyOf = (p: Project, f: Field) => `${p.id}:${f}`;

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

  const cellInput = (p: Project, field: Field, opts: { align: string; title: string }) => {
    const k = keyOf(p, field);
    const shown = edits[k] ?? (field === "unit_price" ? groupNumber(p[field]) : plainNumber(p[field]));
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

  const TH = "border border-line font-semibold whitespace-nowrap sticky top-0 bg-paper z-10 px-2 py-2";
  const TD = "border border-line align-middle px-2 py-2";

  // Số tiền tính nhanh trên thanh công cụ
  const parsedCalcJpy = Number(calcJpy.replace(/[^\d.]/g, "")) || 0;
  const calcVndResult = Math.round(parsedCalcJpy * currentVcbRate);

  return (
    <AppShell maxWidthClass="max-w-md lg:max-w-none">
      {/* Header & Thẻ Tổng */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">Doanh thu</h1>
          <p className="mt-0.5 text-xs text-muted">
            Doanh thu = <b className="text-ink">Time khách hàng × Đơn giá Yên (¥/h) × Tỷ giá Vietcombank Realtime</b>. Gõ thẳng vào ô, rời ô là tự lưu.
          </p>
        </div>

        {/* Thẻ tổng doanh thu */}
        <div className="flex items-center gap-4 rounded-xl2 border border-line bg-white px-5 py-3 shadow-card">
          <div>
            <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted">
              Tổng doanh thu (VNĐ)
            </span>
            <span className="block text-xl font-extrabold text-emerald-700 tnum">{formatVND(tong)}</span>
          </div>
          <div className="border-l border-line pl-3.5">
            <span className="block text-[10px] text-muted">Giờ khách hàng</span>
            <span className="block text-sm font-bold text-steel tnum">
              {tongGioKhach.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}h
            </span>
          </div>
          <div className="border-l border-line pl-3.5">
            <span className="block text-[10px] text-muted">Đã tính</span>
            <span className="block text-sm font-bold text-steel tnum">
              {soCoDoanhThu}/{rows.length}
            </span>
          </div>
        </div>
      </div>

      {/* THANH THÔNG TIN TỶ GIÁ VIETCOMBANK REALTIME & QUY ĐỔI NHANH */}
      <div className="mt-4 rounded-2xl border border-emerald-200/80 bg-gradient-to-r from-emerald-50/50 via-white to-slate-50 p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-emerald-100 pb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-600 text-white font-bold text-xs shadow-sm">
              VCB
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-slate-800">Tỷ giá ngoại tệ Vietcombank (Realtime)</h2>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  1 JPY = {currentVcbRate.toLocaleString("vi-VN", { maximumFractionDigits: 2 })} ₫
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                Tỷ giá JPY/VND tự động cập nhật liên tục từ ngân hàng Vietcombank để tính Doanh thu cho từng dự án
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Các tab chọn hình thức tỷ giá: Mua chuyển khoản, Mua tiền mặt, Bán */}
            <div className="inline-flex rounded-xl bg-slate-200/70 p-0.5 text-xs font-semibold">
              <button
                type="button"
                onClick={() => handleRateTypeChange("buy")}
                className={`rounded-lg px-2.5 py-1 transition-all cursor-pointer ${
                  rateType === "buy"
                    ? "bg-emerald-600 text-white shadow-sm font-bold"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Mua tiền mặt ({vcbData?.jpy?.buy ?? 158.3}₫)
              </button>
              <button
                type="button"
                onClick={() => handleRateTypeChange("transfer")}
                className={`rounded-lg px-2.5 py-1 transition-all cursor-pointer ${
                  rateType === "transfer"
                    ? "bg-emerald-600 text-white shadow-sm font-bold"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Mua chuyển khoản ({vcbData?.jpy?.transfer ?? 159.9}₫)
              </button>
              <button
                type="button"
                onClick={() => handleRateTypeChange("sell")}
                className={`rounded-lg px-2.5 py-1 transition-all cursor-pointer ${
                  rateType === "sell"
                    ? "bg-emerald-600 text-white shadow-sm font-bold"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Bán ({vcbData?.jpy?.sell ?? 169.23}₫)
              </button>
            </div>

            {/* Thông tin cập nhật & nút làm mới */}
            <button
              type="button"
              onClick={() => fetchVcb(true)}
              disabled={vcbLoading}
              title="Lấy tỷ giá mới nhất từ Vietcombank ngay bây giờ"
              className="inline-flex items-center gap-1 rounded-xl border border-emerald-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-50 transition-colors shadow-2xs cursor-pointer disabled:opacity-50"
            >
              <ArrowPathIcon className={`h-3.5 w-3.5 ${vcbLoading ? "animate-spin text-emerald-600" : ""}`} />
              <span className="text-[11px]">
                {vcbLoading ? "Đang cập nhật…" : `Cập nhật: ${vcbData?.updated_at || "07:59 27/08/2026"}`}
              </span>
            </button>
          </div>
        </div>

        {/* Thanh công cụ quy đổi nhanh ngoại tệ (Quick Converter) */}
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 items-center gap-3">
          {/* Ô nhập JPY */}
          <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-2.5 shadow-2xs focus-within:border-emerald-500 transition-all">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">
              QUY ĐỔI NHANH: SỐ TIỀN YÊN NHẬT (JPY)
            </span>
            <div className="mt-1 flex items-center gap-2">
              <span className="inline-flex items-center gap-1 font-bold text-xs text-slate-700 bg-slate-100 px-2 py-0.5 rounded shrink-0">
                🇯🇵 JPY
              </span>
              <input
                type="text"
                value={calcJpy}
                onChange={(e) => setCalcJpy(e.target.value)}
                placeholder="Nhập số Yên thử nghiệm..."
                className="w-full text-sm font-extrabold text-slate-800 outline-none tnum"
              />
              <span className="text-xs font-medium text-slate-400">¥</span>
            </div>
          </div>

          {/* Mũi tên chuyển đổi */}
          <div className="lg:col-span-2 flex flex-col items-center justify-center">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 shadow-2xs">
              <ArrowRightIcon className="h-3.5 w-3.5 stroke-2" />
            </div>
          </div>

          {/* Ô kết quả VNĐ */}
          <div className="lg:col-span-5 rounded-xl border border-emerald-300 bg-emerald-50/70 p-2.5 shadow-2xs">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-emerald-800">
              SỐ TIỀN VNĐ TƯƠNG ĐƯƠNG (VCB)
            </span>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1 font-bold text-xs text-emerald-900 bg-emerald-200/80 px-2 py-0.5 rounded shrink-0">
                🇻🇳 VND
              </span>
              <span className="text-base font-black text-emerald-800 tnum truncate">
                {formatVND(calcVndResult)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Bộ lọc */}
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
            className="text-xs font-semibold text-steel hover:text-ink hover:underline cursor-pointer"
          >
            Xóa bộ lọc
          </button>
        )}
      </div>

      <p className="mt-2 text-xs text-muted">
        Tìm thấy: <b className="text-ink">{rows.length}</b> dự án
      </p>

      {/* Bảng Doanh thu — MỖI DỰ ÁN CÓ ĐƠN GIÁ YÊN RIÊNG BIỆT */}
      <div className="mt-3 max-h-[calc(100vh-340px)] overflow-auto rounded-xl2 border border-line bg-white shadow-card">
        <table className="w-full min-w-[1020px] table-fixed border-collapse text-[11px]">
          <colgroup>
            <col className="w-[40px]" />    {/* STT */}
            <col className="w-[26px]" />    {/* Ghim ★ */}
            <col className="w-[130px]" />   {/* Mã QL */}
            <col className="w-[300px]" />   {/* Tên dự án */}
            <col className="w-[96px]" />    {/* Manual time */}
            <col className="w-[96px]" />    {/* Realtime (AI) */}
            <col className="w-[110px]" />   {/* Time khách hàng */}
            <col className="w-[110px]" />   {/* Đơn giá Yên (¥/h) */}
            <col className="w-[150px]" />   {/* Doanh thu (VNĐ) */}
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
                Time khách hàng (h)
              </th>
              <th className={`${TH} text-right`} title="Đơn giá Yên Nhật riêng cho từng dự án (JPY/giờ)">
                Đơn giá <span className="normal-case text-[9px] text-slate-500">(¥/h)</span>
              </th>
              <th className={`${TH} text-right`} title="Time khách hàng × Đơn giá Yên × Tỷ giá Vietcombank">
                Doanh thu (VNĐ)
              </th>
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
              const rev = revenueOf(p);
              const jpy = Number(p.unit_price ?? 0);
              const hours = Number(p.client_hours ?? 0);

              return (
                <tr
                  key={p.id}
                  onClick={() => router.push(`/projects/${p.id}`)}
                  className={`cursor-pointer transition-colors ${i % 2 === 0 ? "bg-white" : "bg-slate-50/30"} hover:bg-emerald-50/40`}
                >
                  <td className={`${TD} text-center text-[10px] text-slate-500`}>{i + 1}</td>

                  {/* GHIM */}
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

                  {/* MANUAL TIME */}
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

                  {/* REALTIME (AI) */}
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

                  {/* TIME KHÁCH HÀNG — số giờ tính tiền riêng của dự án */}
                  <td
                    className={`${TD} whitespace-nowrap text-center`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {canEdit(p) ? (
                      cellInput(p, "client_hours", { align: "text-center", title: "Số giờ tính tiền với khách hàng" })
                    ) : (
                      <span className="text-[12px] font-semibold text-ink tnum">
                        {plainNumber(p.client_hours) || "—"}
                      </span>
                    )}
                  </td>

                  {/* ĐƠN GIÁ YÊN (¥/h) — NHẬP RIÊNG CHO TỪNG DỰ ÁN */}
                  <td
                    className={`${TD} whitespace-nowrap text-right`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {canEdit(p) ? (
                      cellInput(p, "unit_price", { align: "text-right", title: "Nhập Đơn giá Yên Nhật cho dự án này (¥/giờ)" })
                    ) : (
                      <span className="text-[12px] font-semibold text-ink tnum">
                        {groupNumber(p.unit_price) ? `${groupNumber(p.unit_price)} ¥` : "—"}
                      </span>
                    )}
                  </td>

                  {/* DOANH THU (VNĐ) = Time khách hàng × Đơn giá Yên × Tỷ giá Vietcombank */}
                  <td className={`${TD} whitespace-nowrap text-right`}>
                    {rev > 0 ? (
                      <span
                        className="block truncate font-extrabold text-emerald-800 text-[12px] tnum"
                        title={`${hours}h × ${groupNumber(jpy)}¥ × ${currentVcbRate.toLocaleString("vi-VN", { maximumFractionDigits: 2 })}₫/¥ = ${formatVND(rev)}`}
                      >
                        {formatVND(rev)}
                      </span>
                    ) : (
                      <span className="text-muted" title="Cần nhập cả Time khách hàng và Đơn giá Yên">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>

          {rows.length > 0 && (
            <tfoot>
              <tr className="sticky bottom-0 bg-paper font-bold border-t-2 border-slate-300">
                <td className={`${TD} text-right text-[11px] uppercase tracking-wide text-muted`} colSpan={8}>
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
        Bấm vào một hàng để xem chi tiết dự án. Doanh thu từng dự án = <b className="text-ink">Time khách hàng (h)</b> × <b className="text-ink">Đơn giá Yên (¥/h)</b> × <b className="text-ink">Tỷ giá Vietcombank Realtime</b>.
      </p>
    </AppShell>
  );
}
