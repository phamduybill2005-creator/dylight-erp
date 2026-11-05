"use client";

// Trang DOANH THU — mỗi dự án có đơn giá Yên (¥/h) riêng, lưu vào trường unit_price.
// Cách nhập: click vào hàng dự án → thanh chuyển đổi Vietcombank "kích hoạt" cho dự án đó.
// Nhập số Yên ở thanh trên → chỉ cập nhật doanh thu của dự án đang chọn. Rời ô là tự lưu.
// Doanh thu (VNĐ) = Time khách hàng (h) × Đơn giá Yên (¥/h) × Tỷ giá Vietcombank Realtime.
// Xem theo Phòng Bản đồ: sau Tên dự án có cột Vùng (đồng bộ từ bảng Dự án, JSON `evaluation`)
// rồi 9 cột GIỜ theo 9 hạng mục của mẫu "Sample - Phòng Bản đồ" (Ortho / RIEGL / QLCL / DATA /
// Ground / Grid_XML / HoverMaps / トレース / TD-TN). Mỗi ô = tổng giờ realtime người làm nhập ở
// các đầu việc thuộc nhóm hạng mục đó (trang Tiến độ dự án) — CHỈ XEM, lọc tháng thì theo tháng.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useStickyState } from "@/lib/use-sticky-state";
import Link from "next/link";
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
import { isDirector, isSeniorManagerUp, canSeeRevenue } from "@/lib/roles";
import { PRESET_DEPARTMENTS } from "@/lib/departments";
import { getProjectDept, isBanDoView } from "@/lib/groups";
import { parseBanDoDetails, analysisNumber, isBanDoTicked, tickInputClass } from "@/lib/bando-details";
import { BANDO_HOUR_COLUMNS, hoursByColumn, formatGroupHours, type ProjectGroupHours } from "@/lib/bando-hours";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import { formatVND, todayLocal } from "@/lib/format";
import { pickJpyRate, computeRevenueVnd, parseJpyInput } from "@/lib/revenue";
import type { Project, User, Timesheet } from "@/lib/types";
import { revenueMobileFacts } from "@/lib/mobile-view-models";

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

/** "2026-10" -> {from: "2026-10-01", to: "2026-10-31"}; rỗng -> undefined. */
function monthRange(month: string): { from: string; to: string } | undefined {
  if (!month) return undefined;
  const [yStr, mStr] = month.split("-");
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  const lastDay = new Date(y, m, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, "0")}` };
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

  const [projects, setProjects] = useState<Project[]>([]);
  const [me, setMe] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const [searchQuery, setSearchQuery] = useStickyState("revenue.search", "");
  const [filterDept, setFilterDept] = useStickyState("revenue.dept", "");
  const [filterMonth, setFilterMonth] = useStickyState("revenue.month", "");
  const [monthTimesheets, setMonthTimesheets] = useState<Timesheet[]>([]);

  // THÁNG ĐANG XEM cho 2 cột (Month): tháng đã lọc; chưa lọc thì tháng hiện tại.
  const viewMonth = filterMonth || todayLocal().slice(0, 7);
  const monthLabel = `T${Number(viewMonth.slice(5, 7))}/${viewMonth.slice(0, 4)}`;

  // Giờ realtime nhập trong tháng đang xem (cột Time (Month)); tự nạp lại khi có người khai giờ.
  const loadMonthTimesheets = useCallback(() => {
    const range = monthRange(viewMonth);
    if (!range) {
      setMonthTimesheets([]);
      return;
    }
    api.timesheets(range)
      .then(setMonthTimesheets)
      .catch(() => setMonthTimesheets([]));
  }, [viewMonth]);
  useEffect(() => { loadMonthTimesheets(); }, [loadMonthTimesheets]);
  useAutoRefresh(loadMonthTimesheets, { topics: ["timesheet"] });

  // TIME KHÁCH HÀNG THEO THÁNG: {project_id: {"YYYY-MM": giờ}} — Customer (Month) đọc đúng
  // tháng, Customer (All) cộng mọi tháng. Backend đã ghi tổng vào project.client_hours.
  const [clientMonthHours, setClientMonthHours] = useState<Record<string, Record<string, number>>>({});
  const loadClientHours = useCallback(() => {
    api.revenueClientHours().then(setClientMonthHours).catch(() => {});
  }, []);
  useEffect(() => { loadClientHours(); }, [loadClientHours]);
  useAutoRefresh(loadClientHours, { topics: ["project"] });
  /** Giờ khách hàng của dự án: có `month` -> đúng tháng đó; không -> tổng các tháng. */
  const clientHoursOf = useCallback(
    (p: Project, month?: string): number => {
      const byMonth = clientMonthHours[String(p.id)];
      if (month) return Number(byMonth?.[month] ?? 0);
      if (byMonth) return Object.values(byMonth).reduce((s, h) => s + Number(h || 0), 0);
      return Number(p.client_hours ?? 0); // chưa tải xong -> tổng backend đã lưu sẵn
    },
    [clientMonthHours],
  );

  // Giờ realtime theo NHÓM HẠNG MỤC của từng dự án -> 9 cột Phòng Bản đồ. Lọc tháng thì
  // chỉ lấy giờ nhập trong tháng (giống cột Realtime). Tự nạp lại khi có người sửa giờ /
  // hạng mục ở trang Tiến độ (kênh trực tiếp), nên số luôn khớp mà không cần F5.
  const [groupHours, setGroupHours] = useState<ProjectGroupHours>({});
  const loadGroupHours = useCallback(() => {
    api.revenueGroupHours(monthRange(filterMonth)).then(setGroupHours).catch(() => {});
  }, [filterMonth]);
  useEffect(() => { loadGroupHours(); }, [loadGroupHours]);
  useAutoRefresh(loadGroupHours, { topics: ["timesheet", "project"] });

  // Tổng số giờ được nhập trong tháng theo từng dự án
  const monthHoursByProject = useMemo(() => {
    const map: Record<number, number> = {};
    for (const ts of monthTimesheets) {
      const h = Number(ts.hours || 0);
      map[ts.project_id] = (map[ts.project_id] || 0) + h;
    }
    return map;
  }, [monthTimesheets]);

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
    // Nạp dự án lần đầu + làm mới ~20s khi tab đang mở (như bảng Dự án) để nhóm cột
    // Phòng Bản đồ nhập bên Dự án và số giờ luôn khớp mà không cần tải lại trang.
    const loadProjects = () => api.projects().then((d) => alive && setProjects(d)).catch(() => {});
    loadProjects().finally(() => alive && setLoading(false));
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") loadProjects();
    }, 20_000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  // Bố cục Phòng Bản đồ (cùng điều kiện với bảng Dự án): thêm Vùng + 9 cột giờ chỉ xem sau Tên dự án.
  const isBanDoMode = isBanDoView(filterDept, me);
  const colCount = isBanDoMode ? 10 + BANDO_HOUR_COLUMNS.length : 9;
  // Bề rộng từng cột giờ: tên dài (HoverMaps, Grid_XML, トレース) cần rộng hơn để không bị cắt chữ.
  const BANDO_COL_W: Record<string, string> = { hovermaps: "w-[76px]", grid: "w-[66px]", trace: "w-[60px]", ground: "w-[58px]" };

  const uniqueDepts = useMemo(
    () =>
      Array.from(
        new Set([...PRESET_DEPARTMENTS, ...projects.map((p) => getProjectDept(p)).filter(Boolean)]),
      ).sort(),
    [projects],
  );

  // Tỷ giá + công thức lấy từ lib/revenue -> bảng Dự án dùng CHUNG, không lệch số.
  const currentVcbRate = useMemo(() => pickJpyRate(vcbData, rateType), [vcbData, rateType]);

  /** Giờ khách hàng dùng để TÍNH TIỀN: đang lọc tháng -> Customer (Month); không -> Customer (All). */
  const billableHoursOf = useCallback(
    (p: Project): number => clientHoursOf(p, filterMonth || undefined),
    [clientHoursOf, filterMonth],
  );
  /** Doanh thu từng dự án (VNĐ) = Time khách hàng × Đơn giá Yên × Tỷ giá Vietcombank */
  const revenueOf = useCallback(
    (p: Project): number =>
      computeRevenueVnd({ ...p, client_hours: billableHoursOf(p) }, parseJpyInput(globalJpyDraft), currentVcbRate),
    [currentVcbRate, globalJpyDraft, billableHoursOf],
  );

  const rows = useMemo(() => {
    const list = projects.filter((p) => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!(p.name || "").toLowerCase().includes(q) && !(p.code || "").toLowerCase().includes(q)) return false;
      }
      if (filterDept && getProjectDept(p) !== filterDept) return false;
      if (filterMonth) {
        const startMonth = (p.start_date || "").slice(0, 7);
        const hasHoursInMonth = (monthHoursByProject[p.id] || 0) > 0;
        // Có Time khách hàng của tháng đó cũng là "có việc trong tháng" -> vẫn hiện.
        const hasClientInMonth = clientHoursOf(p, filterMonth) > 0;
        if (startMonth !== filterMonth && !hasHoursInMonth && !hasClientInMonth) return false;
      }
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
  }, [projects, searchQuery, filterDept, filterMonth, pinnedIds, monthHoursByProject, clientHoursOf]);

  const tong = useMemo(() => rows.reduce((s, p) => s + revenueOf(p), 0), [rows, revenueOf]);
  const soCoDoanhThu = useMemo(() => rows.filter((p) => revenueOf(p) > 0).length, [rows, revenueOf]);
  const tongGioKhach = useMemo(() => rows.reduce((s, p) => s + billableHoursOf(p), 0), [rows, billableHoursOf]);

  // Số Yên global và VNĐ quy đổi tương ứng (cho widget nhỏ)
  const parsedGlobalJpy = Number(globalJpyDraft.replace(/\./g, "").replace(/,/g, "").replace(/[^\d]/g, "")) || 0;
  const calcGlobalVnd = Math.round(parsedGlobalJpy * currentVcbRate);

  // Ô nhập TIME KHÁCH HÀNG THEO THÁNG (chỉ Giám đốc). Khoá nháp: "<dự án>:<tháng>".
  const monthKey = (p: Project, month: string) => `${p.id}:${month}`;

  async function saveClientMonth(p: Project, month: string) {
    if (!isDirectorUser) {
      alert("Chỉ tài khoản Giám đốc mới có quyền nhập Time khách hàng.");
      return;
    }
    const k = monthKey(p, month);
    const draft = edits[k];
    if (draft === undefined) return;
    const clear = () => setEdits((s) => { const n = { ...s }; delete n[k]; return n; });
    const next = parseHours(draft);
    const cur = clientHoursOf(p, month) || null;
    if ((next || null) === cur) { clear(); return; }
    try {
      const res = await api.setProjectClientHours(p.id, month, next);
      setClientMonthHours((prev) => {
        const mine = { ...(prev[String(p.id)] || {}) };
        if (res.hours == null) delete mine[month]; else mine[month] = res.hours;
        return { ...prev, [String(p.id)]: mine };
      });
      // Tổng các tháng đã được backend ghi vào client_hours -> cập nhật tại chỗ cho khớp.
      setProjects((prev) => prev.map((x) => (x.id === p.id ? { ...x, client_hours: res.total_hours } : x)));
    } catch (err: any) {
      alert(err?.message || "Không lưu được, thử lại giúp mình.");
    } finally { clear(); }
  }

  const clientMonthInput = (p: Project, month: string, opts: { align: string; title: string }) => {
    const k = monthKey(p, month);
    const shown = edits[k] ?? plainNumber(clientHoursOf(p, month) || null);
    return (
      <input
        type="text" inputMode="decimal"
        value={shown}
        onChange={(e) => setEdits((st) => ({ ...st, [k]: e.target.value }))}
        onBlur={() => saveClientMonth(p, month)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
          if (e.key === "Escape") setEdits((st) => { const n = { ...st }; delete n[k]; return n; });
        }}
        placeholder="—" title={opts.title}
        className={`w-full rounded border border-transparent bg-transparent px-1 py-0.5 ${opts.align} text-[12px] font-semibold text-ink tnum outline-none transition-colors placeholder:text-line hover:border-line focus:border-steel focus:bg-white`}
      />
    );
  };

  /** Số giờ -> "12,5" gọn cho ô hiển thị. */
  const fmtH = (h: number) => h.toLocaleString("vi-VN", { maximumFractionDigits: 1 });

  const TH = "border border-line font-semibold whitespace-nowrap sticky top-0 bg-paper z-10 px-2 py-2";
  const TD = "border border-line align-middle px-2 py-2";

  // CHẶN TRUY CẬP THẲNG BẰNG URL: ẩn mục ở menu thôi chưa đủ, ai gõ /revenue
  // vẫn vào được. Dùng CHUNG canSeeRevenue với menu nên không bao giờ lệch.
  // (Trước đây còn một lớp chặn cũ chỉ cho Quản lý cấp cao trở lên đứng TRƯỚC lớp này,
  //  làm người trong danh sách chỉ định thấy mục menu nhưng mở trang lại bị từ chối.)
  if (me && !canSeeRevenue(me)) {
    return (
      <AppShell>
        <div className="rounded-xl2 border border-line bg-white p-8 text-center shadow-card">
          <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
            <LockClosedIcon className="h-6 w-6" />
          </div>
          <h1 className="text-base font-bold text-ink">Không có quyền truy cập</h1>
          <p className="mt-1 text-xs text-muted">
            Mục Doanh thu chỉ dành cho Ban Giám đốc, Quản trị hệ thống, Quản lý cấp cao và các
            nhân sự được chỉ định. Cần xem, vui lòng liên hệ Ban Giám đốc.
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell maxWidthClass="max-w-md lg:max-w-none">
      {/* Header & Thẻ Tổng */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-ink">Doanh thu</h1>
          {/* Khung tỷ giá — nằm gọn dưới tiêu đề, thu nhỏ */}
          <div className="mt-1.5">
            <div data-testid="revenue-rate-toolbar" className={`flex w-full max-w-full flex-nowrap items-center gap-1.5 overflow-hidden rounded-xl border px-2 py-1 shadow-sm transition-all sm:inline-flex sm:w-auto sm:gap-2 sm:px-2.5 ${
              parsedGlobalJpy > 0
                ? "border-emerald-300 bg-emerald-50/80 ring-1 ring-emerald-200"
                : "border-line bg-white hover:border-slate-300"
            }`}>
              {/* VCB badge + Tỷ giá */}
              <div className="flex shrink-0 items-center gap-1 sm:gap-2">
                <div className="flex h-5 w-5 items-center justify-center rounded-md bg-emerald-600 text-white font-black text-[9px] shadow-2xs">VCB</div>
                <div className="min-w-0">
                  <span className="hidden text-[8px] font-semibold uppercase leading-none text-muted sm:block">Tỷ giá JPY</span>
                  <span className="block whitespace-nowrap text-[10px] font-bold text-emerald-700 tnum sm:mt-0.5 sm:text-[11px]">
                    1¥ = {currentVcbRate.toLocaleString("vi-VN", { maximumFractionDigits: 2 })}₫
                  </span>
                </div>
              </div>

              {/* Ô nhập JPY chung (CHỈ GIÁM ĐỐC ĐƯỢC NHẬP) */}
              <div
                className={`flex min-w-0 flex-1 items-center gap-1 rounded-md border border-line px-1.5 py-0.5 transition-all sm:min-w-[120px] sm:px-2 ${
                  isDirectorUser
                    ? "bg-slate-50/70 focus-within:border-emerald-500 focus-within:bg-white"
                    : "bg-slate-100/70 opacity-80 cursor-not-allowed"
                }`}
              >
                <span className="shrink-0 text-[9px] font-bold text-slate-500 sm:hidden">JPY</span>
                <span className="hidden shrink-0 text-[11px] font-bold text-slate-500 sm:inline">🇯🇵</span>
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
                  className="min-w-0 w-full bg-transparent text-[10px] font-bold text-slate-800 outline-none tnum placeholder:text-slate-400 placeholder:font-normal disabled:cursor-not-allowed sm:text-[11px]"
                />
                <span className="hidden shrink-0 text-[10px] font-medium text-slate-400 sm:inline">¥/h</span>
              </div>

              {/* Kết quả quy đổi VNĐ */}
              <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
                <ArrowRightIcon className="h-3 w-3 text-emerald-500 shrink-0" />
                <div className="text-right">
                  <span className="hidden text-[8px] font-semibold uppercase leading-none text-muted sm:block">Quy đổi</span>
                  <span className="block whitespace-nowrap text-[10px] font-extrabold text-emerald-800 tnum sm:mt-0.5 sm:text-[11px]">
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
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-emerald-600 transition-colors hover:bg-emerald-100/60 hover:text-emerald-800 disabled:opacity-40 cursor-pointer"
              >
                <ArrowPathIcon className={`h-3 w-3 ${vcbLoading ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>
        </div>

        {/* Cột phải: thẻ tổng doanh thu */}
        <div className="flex w-full min-w-0 max-w-full flex-wrap items-center gap-3 rounded-xl2 border border-line bg-white px-3 py-2 shadow-card sm:w-auto sm:flex-nowrap sm:gap-4 sm:px-5 sm:py-3">
          <div>
            <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted">Tổng doanh thu (VNĐ)</span>
            <span className="block text-xl font-extrabold text-emerald-700 tnum">{formatVND(tong)}</span>
          </div>
          <div className="border-l border-line pl-3.5">
            <span className="block text-[10px] text-muted">Công khách hàng{filterMonth ? ` ${monthLabel}` : " (All)"}</span>
            <span className="block text-sm font-bold text-steel tnum">
              {hoursToDays(tongGioKhach)} công <span className="text-[10px] font-normal text-muted">({tongGioKhach.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}h)</span>
            </span>
          </div>
          <div className="border-l border-line pl-3.5">
            <span className="block text-[10px] text-muted">Đã tính</span>
            <span className="block text-sm font-bold text-steel tnum">{soCoDoanhThu}/{rows.length}</span>
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

      <section className="mt-3 space-y-2 lg:hidden" aria-label="Doanh thu dự án trên điện thoại">
        {loading ? (
          <p className="rounded-xl border border-line bg-white px-4 py-8 text-center text-sm text-muted">Đang tải…</p>
        ) : rows.length === 0 ? (
          <p className="rounded-xl border border-line bg-white px-4 py-8 text-center text-sm text-muted">Không tìm thấy dự án nào khớp với bộ lọc.</p>
        ) : rows.map((project, index) => {
          const revenue = revenueOf(project);
          const facts = revenueMobileFacts(project, revenue);
          const pinned = pinnedIds.includes(project.id);
          return (
            <article key={project.id} className={`rounded-xl border bg-white p-3 shadow-card ${pinned ? "border-amber/60" : "border-line"}`}>
              <div className="flex items-start gap-2">
                <span className="pt-1 font-mono text-xs font-bold text-slate-400">{index + 1}</span>
                <button type="button" onClick={(event) => { event.stopPropagation(); togglePin(project.id); }} className="flex h-11 w-9 shrink-0 items-start justify-center pt-1" aria-label={pinned ? "Bỏ ghim dự án" : "Ghim dự án"}>
                  {pinned ? <StarIconSolid className="h-5 w-5 text-amber" /> : <StarIconOutline className="h-5 w-5 text-slate-300" />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs font-bold text-bad">{project.code}</p>
                  <h2 className="mt-0.5 line-clamp-2 text-sm font-bold leading-snug text-ink">
                    <Link href={`/projects/${project.id}`} className="hover:text-steel hover:underline">{project.name}</Link>
                  </h2>
                </div>
              </div>
              <div className="mt-3 rounded-xl bg-emerald-50 px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Doanh thu</p>
                <p className="mt-0.5 text-xl font-extrabold text-emerald-800 tnum">{facts.revenue > 0 ? formatVND(facts.revenue) : "—"}</p>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-paper px-2.5 py-2"><p className="text-[10px] text-muted">Time ({monthLabel})</p><p className="mt-0.5 font-bold text-ink tnum">{fmtH(monthHoursByProject[project.id] || 0)}h</p></div>
                <div className="rounded-lg bg-paper px-2.5 py-2" onClick={(event) => event.stopPropagation()}>
                  <p className="text-[10px] text-muted">Customer ({monthLabel})</p>
                  {isDirectorUser
                    ? clientMonthInput(project, viewMonth, { align: "text-left", title: `Nhập số giờ khách hàng tháng ${monthLabel}` })
                    : <p className="mt-0.5 font-bold text-ink tnum">{fmtH(clientHoursOf(project, viewMonth))}h</p>}
                </div>
                <div className="rounded-lg bg-paper px-2.5 py-2"><p className="text-[10px] text-muted">Time (All)</p><p className="mt-0.5 font-bold text-ink tnum">{facts.actualHours.toLocaleString("vi-VN")}h</p></div>
                <div className="rounded-lg bg-paper px-2.5 py-2"><p className="text-[10px] text-muted">Customer (All)</p><p className="mt-0.5 font-bold text-ink tnum">{fmtH(clientHoursOf(project))}h</p></div>
              </div>
            </article>
          );
        })}
      </section>

      {/* BẢNG — không có cột Đơn giá, click hàng để nhập */}
      <div className="mt-3 hidden max-h-[calc(100vh-200px)] overflow-auto rounded-xl2 border border-line bg-white shadow-card lg:block">
        <table className={`w-full table-fixed border-collapse text-[11px] ${isBanDoMode ? "min-w-[1440px]" : "min-w-[980px]"}`}>
          <colgroup>
            <col className="w-[40px]" />{/* STT */}
            <col className="w-[26px]" />{/* Ghim ★ */}
            {/* Mã QL: thu nhỏ khít theo chữ */}
            <col className="w-[90px]" />{/* Mã QL */}
            {/* Tên dự án: thu nhỏ khít theo tên */}
            <col className="w-[220px]" />{/* Tên dự án */}
            {isBanDoMode && (
              <>
                {/* Nhóm cột Phòng Bản đồ: Vùng + 9 cột giờ theo hạng mục */}
                <col className="w-[60px]" />{/* Vùng */}
                {BANDO_HOUR_COLUMNS.map((c) => <col key={c.key} className={BANDO_COL_W[c.key] ?? "w-[52px]"} />)}
              </>
            )}
            <col className="w-[84px]" />{/* Time (Month) */}
            <col className="w-[100px]" />{/* Customer (Month) */}
            <col className="w-[84px]" />{/* Time (All) */}
            <col className="w-[92px]" />{/* Customer (All) */}
            <col className="w-[170px]" />{/* Doanh thu (VNĐ) */}
          </colgroup>
          <thead>
            <tr className="bg-paper text-left text-[11px] uppercase tracking-wide text-muted">
              <th className={`${TH} text-center`}>STT</th>
              <th className={`${TH} text-center text-amber`} title="Ghim yêu thích lên đầu">★</th>
              <th className={`${TH} whitespace-nowrap`}>Mã QL</th>
              <th className={`${TH} whitespace-nowrap`}>Tên dự án</th>
              {isBanDoMode && (
                <>
                  <th className={TH} title="Vùng / khu vực — nhập ở bảng Dự án">Vùng</th>
                  {BANDO_HOUR_COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      className="sticky top-0 z-10 border border-teal-200 bg-teal-50 px-0.5 py-2 text-center text-[9.5px] font-bold tracking-normal whitespace-nowrap text-teal-900"
                      title={`${c.title} — tổng giờ người làm nhập ở các đầu việc thuộc hạng mục này (trang Tiến độ dự án)${filterMonth ? `, trong tháng ${filterMonth}` : ""}`}
                    >
                      {c.label}
                    </th>
                  ))}
                </>
              )}
              <th className={`${TH} text-center`} title={`Thời gian làm thực tế người làm đã nhập trong tháng ${monthLabel}`}>
                Time <span className="block text-[9px] font-normal normal-case text-slate-500">({monthLabel})</span>
              </th>
              <th className={`${TH} text-center`} title={`Time khách hàng (công) của tháng ${monthLabel} — chỉ Giám đốc nhập`}>
                Customer <span className="block text-[9px] font-normal normal-case text-slate-500">({monthLabel})</span>
              </th>
              <th className={`${TH} text-center`} title="Tổng thời gian làm thực tế của dự án qua mọi tháng">
                Time <span className="block text-[9px] font-normal normal-case text-slate-500">(All)</span>
              </th>
              <th className={`${TH} text-center`} title="Tổng Time khách hàng (công) của dự án qua mọi tháng">
                Customer <span className="block text-[9px] font-normal normal-case text-slate-500">(All)</span>
              </th>
              <th className={`${TH} text-right whitespace-nowrap`} title="Click hàng dự án để nhập đơn giá Yên trên thanh bên trên">
                Doanh thu (VNĐ)
              </th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td className={`${TD} text-center text-muted`} colSpan={colCount}>Đang tải…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td className={`${TD} text-center text-muted`} colSpan={colCount}>Không tìm thấy dự án nào khớp với bộ lọc.</td></tr>
            )}
            {rows.map((p, i) => {
              const isPinned = pinnedIds.includes(p.id);
              const rev = revenueOf(p);

              return (
                <tr
                  key={p.id}
                  className={`transition-all duration-150 ${
                    i % 2 === 0 ? "bg-white hover:bg-emerald-50/30" : "bg-slate-50/30 hover:bg-emerald-50/30"
                  }`}
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
                    <Link
                      href={`/projects/${p.id}`}
                      className="block truncate rounded hover:text-steel hover:underline focus-visible:outline-steel"
                      title={`${p.name} — mở chi tiết dự án`}
                    >
                      {p.name}
                    </Link>
                  </td>

                  {/* NHÓM CỘT PHÒNG BẢN ĐỒ — chỉ xem: Vùng (JSON `evaluation` ở bảng Dự án)
                      + 9 cột giờ realtime gom theo nhóm hạng mục của mẫu Sample. */}
                  {isBanDoMode && (() => {
                    const bando = parseBanDoDetails(p.evaluation);
                    const hours = hoursByColumn(groupHours[String(p.id)]);
                    return (
                      <>
                        <td className="border border-line align-middle px-1 py-2">
                          <div className="truncate text-[10.5px] text-ink" title={bando.vung}>{bando.vung || "—"}</div>
                        </td>
                        {BANDO_HOUR_COLUMNS.map((c) => {
                          const h = hours[c.key];
                          const hoursTitle = h > 0 ? `${c.title}: ${h}h người làm đã nhập` : `${c.title}: chưa có giờ`;
                          const hoursEl = (
                            <span
                              className={`block font-mono text-[10.5px] tnum ${h > 0 ? "font-semibold text-ink" : "text-slate-300"}`}
                              title={hoursTitle}
                            >
                              {formatGroupHours(h)}
                            </span>
                          );
                          // Ô CHIA ĐÔI — trên là số đã nhập ở tab Dự án (JSON `evaluation`), dưới là giờ
                          // realtime như các cột khác. Ortho / RIEGL / QLCL lấy đúng cột cùng tên;
                          // DATA / Ground / Grid_XML / トレース lấy Analysis (ha); TD-TN lấy Section.
                          const analysisHa = analysisNumber(bando.analysis);
                          const entered = c.key === "ortho" || c.key === "riegl" || c.key === "qlcl"
                            ? (bando[c.key] || "").trim()
                            : c.key === "data" || c.key === "ground" || c.key === "grid" || c.key === "trace"
                              ? (analysisHa ? `${analysisHa} ha` : "")
                              : c.key === "tdtn"
                                ? bando.section.trim()
                                : null;
                          const enteredTitle = c.key === "data" || c.key === "ground" || c.key === "grid" || c.key === "trace"
                            ? (entered ? `Analysis: ${entered} — nhập ở tab Dự án` : "Analysis: chưa nhập ở tab Dự án")
                            : c.key === "tdtn"
                              ? (entered ? `Section: ${entered} — nhập ở tab Dự án` : "Section: chưa nhập ở tab Dự án")
                              : (entered ? `${c.title}: ${entered} — nhập ở tab Dự án` : `${c.title}: chưa nhập ở tab Dự án`);
                          // HoverMaps: ở tab Dự án là Ô TÍCH -> nửa trên hiện đúng trạng thái tích (chỉ xem),
                          // chưa tích thì ô mờ như bên Dự án; nửa dưới là giờ.
                          if (c.key === "hovermaps") {
                            const ticked = isBanDoTicked(bando.hovermaps);
                            return (
                              <td key={c.key} className="border border-line p-0 text-center align-middle">
                                <div
                                  className="flex items-center justify-center border-b border-line/70 px-1 py-1"
                                  title={ticked ? "HoverMaps: đã tích ở tab Dự án" : "HoverMaps: chưa tích ở tab Dự án"}
                                >
                                  <input
                                    type="checkbox"
                                    checked={ticked}
                                    readOnly
                                    tabIndex={-1}
                                    aria-label="HoverMaps"
                                    className={`h-3.5 w-3.5 rounded border ${tickInputClass(ticked)} accent-teal-700 ${ticked ? "" : "opacity-60"} pointer-events-none`}
                                  />
                                </div>
                                <div className="px-1 py-1">{hoursEl}</div>
                              </td>
                            );
                          }
                          if (entered === null) {
                            return (
                              <td key={c.key} className="border border-line align-middle px-1 py-2 text-center">{hoursEl}</td>
                            );
                          }
                          return (
                            <td key={c.key} className="border border-line p-0 text-center align-middle">
                              <div
                                className={`border-b border-line/70 px-1 py-1 text-[10.5px] tnum ${entered ? "font-semibold text-steel" : "text-slate-300"}`}
                                title={enteredTitle}
                              >
                                {entered || "—"}
                              </div>
                              <div className="px-1 py-1">{hoursEl}</div>
                            </td>
                          );
                        })}
                      </>
                    );
                  })()}

                  {/* TIME (MONTH) — giờ realtime người làm nhập trong tháng đang xem */}
                  <td className={`${TD} whitespace-nowrap text-center`}>
                    {(() => {
                      const mHours = Math.round((monthHoursByProject[p.id] || 0) * 10) / 10;
                      return (
                        <div className="flex flex-col items-center" title={`Giờ làm thực tế nhập trong tháng ${monthLabel}: ${mHours}h`}>
                          <span className={`text-[11px] font-bold tnum ${mHours > 0 ? "text-emerald-700" : "text-ink"}`}>{mHours > 0 ? `${hoursToDays(mHours)} ngày` : "0 ngày"}</span>
                          <span className={`text-[10px] font-mono tnum ${mHours > 0 ? "text-emerald-600" : "text-muted"}`}>({mHours > 0 ? `${mHours}h` : "— h"})</span>
                        </div>
                      );
                    })()}
                  </td>

                  {/* CUSTOMER (MONTH) — Time khách hàng của tháng đang xem, CHỈ GIÁM ĐỐC NHẬP */}
                  <td className={`${TD} whitespace-nowrap text-center`} onClick={(e) => e.stopPropagation()}>
                    {(() => {
                      const shown = edits[monthKey(p, viewMonth)] ?? plainNumber(clientHoursOf(p, viewMonth) || null);
                      const h = parseHours(shown) ?? 0;
                      return (
                        <div className="flex flex-col items-center">
                          <span className="text-[11px] font-bold text-ink tnum">{h > 0 ? `${hoursToDays(h)} công` : "0 công"}</span>
                          {isDirectorUser ? (
                            <span className="flex items-center justify-center text-[10px] text-muted">(
                              <span className="w-14">{clientMonthInput(p, viewMonth, { align: "text-center", title: `Nhập SỐ GIỜ khách hàng tháng ${monthLabel} (8 giờ = 1 công)` })}</span>
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

                  {/* TIME (ALL) — tổng giờ realtime của dự án qua mọi tháng */}
                  <td className={`${TD} whitespace-nowrap text-center`}>
                    <div className="flex flex-col items-center" title={`Tổng thời gian thực tế: ${p.total_hours || 0}h (${p.total_days || 0} ngày)`}>
                      <span className="text-[11px] font-bold text-ink tnum">{Number(p.total_hours || 0) > 0 ? `${hoursToDays(Number(p.total_hours))} ngày` : "0 ngày"}</span>
                      <span className="text-[10px] text-muted tnum font-mono">({p.total_hours && p.total_hours > 0 ? `${p.total_hours}h` : "— h"})</span>
                    </div>
                  </td>

                  {/* CUSTOMER (ALL) — tổng Time khách hàng các tháng (chỉ xem; nhập ở cột tháng) */}
                  <td className={`${TD} whitespace-nowrap text-center`}>
                    {(() => {
                      const all = clientHoursOf(p);
                      const months = Object.entries(clientMonthHours[String(p.id)] || {}).sort(([a], [b]) => a.localeCompare(b));
                      const tip = months.length
                        ? `Theo tháng: ${months.map(([m, h]) => `${Number(m.slice(5, 7))}/${m.slice(0, 4)} = ${h}h`).join(" · ")}`
                        : "Chưa nhập Time khách hàng tháng nào";
                      return (
                        <div className="flex flex-col items-center" title={tip}>
                          <span className="text-[11px] font-bold text-ink tnum">{all > 0 ? `${hoursToDays(all)} công` : "0 công"}</span>
                          <span className="text-[10px] text-muted tnum font-mono">({all > 0 ? `${fmtH(all)}h` : "— h"})</span>
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
                            title={`${fmtH(billableHoursOf(p))}h × ${parsedGlobalJpy > 0 ? parsedGlobalJpy : groupNumber(p.unit_price)}¥ × ${currentVcbRate.toLocaleString("vi-VN", { maximumFractionDigits: 2 })}₫/¥ = ${formatVND(rev)}`}
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
                <td className={`${TD} text-right text-[11px] uppercase tracking-wide text-muted`} colSpan={colCount - 1}>
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
        Hoặc vào trang chi tiết từng dự án để đặt đơn giá riêng. Doanh thu = Time khách hàng × Đơn giá Yên × Tỷ giá Vietcombank Realtime (đang lọc tháng thì lấy Customer của tháng đó, không lọc thì Customer (All)).
      </p>
    </AppShell>
  );
}
