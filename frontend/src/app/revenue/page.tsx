"use client";

// Trang DOANH THU — mỗi dự án có đơn giá Yên (¥/h) riêng, lưu vào trường unit_price.
// Cách nhập: click vào hàng dự án → thanh chuyển đổi Vietcombank "kích hoạt" cho dự án đó.
// Nhập số Yên ở thanh trên → chỉ cập nhật doanh thu của dự án đang chọn. Rời ô là tự lưu.
// Doanh thu (VNĐ) = Time khách hàng (h) × Đơn giá Yên (¥/h) × Tỷ giá Vietcombank Realtime.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  StarIcon as StarIconOutline,
  ArrowPathIcon,
  ArrowRightIcon,
  LockClosedIcon,
  BanknotesIcon,
} from "@heroicons/react/24/outline";
import { StarIcon as StarIconSolid } from "@heroicons/react/24/solid";
import AppShell from "@/components/app-shell";
import { api } from "@/lib/api";
import { isDirector, isSeniorManagerUp } from "@/lib/roles";
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

  // Đơn giá Yên chung cho TẤT CẢ dự án (lưu localStorage & đồng bộ backend giữa mọi tài khoản)
  const [globalJpyDraft, setGlobalJpyDraft] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    try {
      return localStorage.getItem("revenue_global_jpy") || "";
    } catch {
      return "";
    }
  });

  const isDirectorUser = me?.role === "DIRECTOR";

  // Tải đơn giá chung từ backend khi vào trang để đồng bộ với Giám đốc
  useEffect(() => {
    api.getGlobalUnitPrice()
      .then((res) => {
        if (res.unit_price != null && Number(res.unit_price) > 0) {
          const str = String(Math.round(Number(res.unit_price)));
          setGlobalJpyDraft(str);
          try { localStorage.setItem("revenue_global_jpy", str); } catch {}
        }
      })
      .catch(() => {});
  }, []);

  const saveGlobalJpyToBackend = useCallback((val: string) => {
    const rawNum = val.replace(/\./g, "").replace(/,/g, "").replace(/[^\d]/g, "");
    const num = rawNum ? Number(rawNum) : null;
    api.setGlobalUnitPrice(num).catch(() => {});
  }, []);

  const handleGlobalJpyChange = (val: string) => {
    setGlobalJpyDraft(val);
    try {
      localStorage.setItem("revenue_global_jpy", val);
    } catch {}
    if (isDirectorUser) {
      saveGlobalJpyToBackend(val);
    }
  };

  // Khóa nháp cho ô Time khách hàng / Manual time trong bảng
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

  /** Doanh thu từng dự án (VNĐ) = Time khách hàng × Đơn giá Yên × Tỷ giá Vietcombank */
  const revenueOf = useCallback((p: Project): number => {
    const h = Number(p.client_hours ?? 0);
    // Ưu tiên globalJpy nếu có, không thì dùng unit_price của dự án
    const globalJpy = Number(globalJpyDraft.replace(/\./g, "").replace(/,/g, "").replace(/[^\d]/g, "")) || 0;
    const jpy = globalJpy > 0 ? globalJpy : Number(p.unit_price ?? 0);
    return h > 0 && jpy > 0 ? Math.round(h * jpy * currentVcbRate) : 0;
  }, [currentVcbRate, globalJpyDraft]);

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

  // Số Yên global và VNĐ quy đổi tương ứng (cho widget nhỏ)
  const parsedGlobalJpy = Number(globalJpyDraft.replace(/\./g, "").replace(/,/g, "").replace(/[^\d]/g, "")) || 0;
  const calcGlobalVnd = Math.round(parsedGlobalJpy * currentVcbRate);

  type RowField = "manual_hours" | "client_hours";
  const keyOf = (p: Project, f: RowField) => `${p.id}:${f}`;

  async function saveRowField(p: Project, field: RowField) {
    if (field === "client_hours" && me?.role !== "DIRECTOR") {
      alert("Chỉ tài khoản Giám đốc mới có quyền nhập Time khách hàng.");
      return;
    }
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

  if (!loading && !isSeniorManagerUp(me)) {
    return (
      <AppShell>
        <div className="mx-auto max-w-md text-center py-16">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 mb-4 shadow-sm">
            <LockClosedIcon className="h-7 w-7" />
          </div>
          <h2 className="text-lg font-bold text-ink">Không có quyền truy cập</h2>
          <p className="mt-1 text-xs text-muted">
            Trang Doanh thu chỉ hiển thị cho Quản lý cấp cao, Quản trị hệ thống và Ban Giám đốc.
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell maxWidthClass="max-w-md lg:max-w-none">
      {/* Header & Thẻ Tổng */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">Doanh thu</h1>
          <p className="mt-0.5 text-xs text-muted">
            Doanh thu = <b className="text-ink">Time khách hàng × Đơn giá Yên × Tỷ giá Vietcombank Realtime</b>.
          </p>
        </div>

        {/* Cột phải: Thẻ tổng + Widget converter nhỏ bên dưới */}
        <div className="flex flex-col gap-1.5" style={{ minWidth: 320 }}>
          {/* Thẻ tổng doanh thu */}
          <div className="flex items-center gap-4 rounded-xl2 border border-line bg-white px-5 py-3 shadow-card">
            <div>
              <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted">Tổng doanh thu (VNĐ)</span>
              <span className="block text-xl font-extrabold text-emerald-700 tnum">{formatVND(tong)}</span>
            </div>
            <div className="border-l border-line pl-3.5">
              <span className="block text-[10px] text-muted">Công khách hàng</span>
              <span className="block text-sm font-bold text-steel tnum">
                {hoursToDays(tongGioKhach)} công <span className="text-[10px] font-normal text-muted">({tongGioKhach.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}h)</span>
              </span>
            </div>
            <div className="border-l border-line pl-3.5">
              <span className="block text-[10px] text-muted">Đã tính</span>
              <span className="block text-sm font-bold text-steel tnum">{soCoDoanhThu}/{rows.length}</span>
            </div>
          </div>

          {/* Widget converter — chiều ngang bằng thẻ Tổng doanh thu */}
          <div className="w-full">
            <div className={`flex flex-wrap items-center justify-between gap-2.5 rounded-xl2 border px-3.5 py-2 shadow-sm transition-all ${
              parsedGlobalJpy > 0
                ? "border-emerald-300 bg-emerald-50/80 ring-1 ring-emerald-200"
                : "border-line bg-white hover:border-slate-300"
            }`}>
              {/* VCB badge + Tỷ giá */}
              <div className="flex items-center gap-2 shrink-0">
                <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-600 text-white font-black text-[10px] shadow-2xs">VCB</div>
                <div>
                  <span className="block text-[9px] font-semibold text-muted uppercase leading-none">Tỷ giá JPY</span>
                  <span className="block text-xs font-bold text-emerald-700 tnum mt-0.5">
                    1 ¥ = {currentVcbRate.toLocaleString("vi-VN", { maximumFractionDigits: 2 })} ₫
                  </span>
                </div>
              </div>

              {/* Ô nhập JPY chung (CHỈ GIÁM ĐỐC ĐƯỢC NHẬP) */}
              <div
                className={`flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 transition-all flex-1 min-w-[130px] ${
                  isDirectorUser
                    ? "bg-slate-50/70 focus-within:border-emerald-500 focus-within:bg-white"
                    : "bg-slate-100/70 opacity-80 cursor-not-allowed"
                }`}
              >
                <span className="text-[11px] font-bold text-slate-500 shrink-0">🇯🇵</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={globalJpyDraft}
                  disabled={!isDirectorUser}
                  onChange={(e) => handleGlobalJpyChange(e.target.value)}
                  onBlur={(e) => isDirectorUser && saveGlobalJpyToBackend(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && isDirectorUser) {
                      saveGlobalJpyToBackend((e.target as HTMLInputElement).value);
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  placeholder={isDirectorUser ? "Đơn giá chung (¥/h)..." : "Chỉ Giám đốc được nhập"}
                  title={
                    isDirectorUser
                      ? "Nhập đơn giá Yên/giờ chung cho tất cả dự án"
                      : "Chỉ tài khoản Giám đốc mới có quyền nhập đơn giá chung"
                  }
                  className="w-full text-xs font-bold text-slate-800 outline-none tnum bg-transparent placeholder:text-slate-400 placeholder:font-normal disabled:cursor-not-allowed"
                />
                <span className="text-[10px] font-medium text-slate-400 shrink-0">¥/h</span>
              </div>

              {/* Kết quả quy đổi VNĐ */}
              <div className="flex items-center gap-1.5 shrink-0">
                <ArrowRightIcon className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                <div className="text-right">
                  <span className="block text-[9px] font-semibold text-muted uppercase leading-none">Quy đổi</span>
                  <span className="block text-xs font-extrabold text-emerald-800 tnum mt-0.5 whitespace-nowrap">
                    {parsedGlobalJpy > 0 ? `${formatVND(calcGlobalVnd)}/h` : "— ₫/h"}
                  </span>
                </div>
              </div>

              {/* Nút refresh tỷ giá */}
              <button
                type="button"
                onClick={() => fetchVcb(true)}
                disabled={vcbLoading}
                title={vcbData?.updated_at ? `Cập nhật lúc: ${vcbData.updated_at}` : "Cập nhật tỷ giá"}
                className="shrink-0 rounded-lg p-1 text-emerald-600 hover:bg-emerald-100/60 hover:text-emerald-800 transition-colors disabled:opacity-40 cursor-pointer"
              >
                <ArrowPathIcon className={`h-3.5 w-3.5 ${vcbLoading ? "animate-spin" : ""}`} />
              </button>
            </div>
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
            <col className="w-[40px]" />   {/* STT */}
            <col className="w-[26px]" />   {/* Ghim ★ */}
            {/* Mã QL: thu nhỏ khít theo chữ */}
            <col className="w-[90px]" />   {/* Mã QL */}
            {/* Tên dự án: thu nhỏ khít theo tên */}
            <col className="w-[220px]" />  {/* Tên dự án */}
            <col className="w-[96px]" />   {/* Manual time */}
            <col className="w-[96px]" />   {/* Realtime (AI) */}
            <col className="w-[120px]" />  {/* Time khách hàng */}
            <col className="w-[170px]" />  {/* Doanh thu (VNĐ) */}
          </colgroup>
          <thead>
            <tr className="bg-paper text-left text-[11px] uppercase tracking-wide text-muted">
              <th className={`${TH} text-center`}>STT</th>
              <th className={`${TH} text-center text-amber`} title="Ghim yêu thích lên đầu">★</th>
              <th className={`${TH} whitespace-nowrap`}>Mã QL</th>
              <th className={`${TH} whitespace-nowrap`}>Tên dự án</th>
              <th className={`${TH} text-center whitespace-nowrap`}>Manual time</th>
              <th className={`${TH} text-center whitespace-nowrap`}>Realtime (AI)</th>
              <th className={`${TH} text-center whitespace-nowrap`}>Time khách hàng (công)</th>
              <th className={`${TH} text-right whitespace-nowrap`} title="Click hàng dự án để nhập đơn giá Yên trên thanh bên trên">
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

              return (
                <tr
                  key={p.id}
                  className={`cursor-pointer transition-all duration-150 ${
                    i % 2 === 0 ? "bg-white hover:bg-emerald-50/30" : "bg-slate-50/30 hover:bg-emerald-50/30"
                  }`}
                  onClick={(e) => {
                    // Nếu click vào ô đang edit (input) thì không chuyển trang
                    if ((e.target as HTMLElement).tagName === "INPUT") return;
                    router.push(`/projects/${p.id}`);
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

                  <td className={`${TD} whitespace-nowrap font-mono text-xs font-bold text-bad`}>
                    <div className="truncate" title={p.code}>{p.code}</div>
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
                              <span className="w-14">{cellInput(p, "manual_hours", { align: "text-center", title: "Nhập SỐ GIỜ (8 giờ = 1 ngày)" })}</span>
                              h)
                            </span>
                          ) : (
                            <span className="text-[10px] text-muted tnum font-mono">({h > 0 ? `${h}h` : "— h"})</span>
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

                  {/* TIME KHÁCH HÀNG — CHỈ GIÁM ĐỐC NHẬP */}
                  <td className={`${TD} whitespace-nowrap text-center`} onClick={(e) => e.stopPropagation()}>
                    {(() => {
                      const shown = edits[keyOf(p, "client_hours")] ?? plainNumber(p.client_hours);
                      const h = parseHours(shown) ?? 0;
                      return (
                        <div className="flex flex-col items-center">
                          <span className="text-[11px] font-bold text-ink tnum">{h > 0 ? `${hoursToDays(h)} công` : "0 công"}</span>
                          {isDirectorUser ? (
                            <span className="flex items-center justify-center text-[10px] text-muted">(
                              <span className="w-14">{cellInput(p, "client_hours", { align: "text-center", title: "Nhập SỐ GIỜ (8 giờ = 1 công)" })}</span>
                              h)
                            </span>
                          ) : (
                            <span className="text-[10px] text-muted tnum font-mono" title="Chỉ tài khoản Giám đốc mới có quyền nhập Time khách hàng">
                              ({h > 0 ? `${h}h` : "— h"})
                            </span>
                          )}
                        </div>
                      );
                    })()}
                  </td>

                  {/* DOANH THU */}
                  <td className={`${TD} whitespace-nowrap text-right`}>
                    <div className="flex flex-col items-end">
                      {rev > 0 ? (
                        <>
                          <span
                            className="font-extrabold text-emerald-800 text-[12px] tnum"
                            title={`${Number(p.client_hours)}h × ${parsedGlobalJpy > 0 ? parsedGlobalJpy : groupNumber(p.unit_price)}¥ × ${currentVcbRate.toLocaleString("vi-VN", { maximumFractionDigits: 2 })}₫/¥ = ${formatVND(rev)}`}
                          >
                            {formatVND(rev)}
                          </span>
                          <span className="text-[9px] text-slate-400 tnum">{parsedGlobalJpy > 0 ? parsedGlobalJpy : groupNumber(p.unit_price)} ¥/h</span>
                        </>
                      ) : (
                        <span className="text-[11px] text-muted" title="Nhập đơn giá Yên chung ở ô bên phải hoặc vào trang dự án">
                          —
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
        <b className="text-ink">Nhập đơn giá ¥/h</b> vào ô nhỏ bên góc phải để tính doanh thu cho toàn bộ dự án.{" "}
        Hoặc vào trang chi tiết từng dự án để đặt đơn giá riêng. Doanh thu = Time khách hàng × Đơn giá Yên × Tỷ giá Vietcombank Realtime.
      </p>
    </AppShell>
  );
}
