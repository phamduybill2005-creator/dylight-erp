"use client";

// Trang Tổng quan (Dashboard) — chia theo 3 tầng giao diện:
//  - DIRECTOR (Giám đốc): đầy đủ KPI tài chính + lãi/lỗ + báo cáo.
//  - MANAGER  (Quản lý)  : KHÔNG có doanh thu/lãi-lỗ; tập trung vận hành + nhân sự + chấm công + đánh giá.
//  - STAFF    (Nhân viên): việc cá nhân — chấm công, lịch làm, dự án, đánh giá quản lý.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  FolderOpenIcon,
  ScaleIcon,
  BanknotesIcon,
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  ClockIcon,
  StarIcon,
  CurrencyDollarIcon,
  CalendarDaysIcon,
  ShieldCheckIcon,
} from "@heroicons/react/24/outline";
import AppShell from "@/components/app-shell";
import CompanyOrgChart from "@/components/company-org-chart";
import { api } from "@/lib/api";
import { roleTier, roleTitle, type Tier } from "@/lib/roles";
import { formatCompactVND, formatVND } from "@/lib/format";
import type { KpiSummary, ProjectProfit, User, Project } from "@/lib/types";

type ModuleDef = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  tint: string;
  tiers: Tier[];
};

// Lưới chức năng — mỗi mục khai báo tầng được phép thấy.
// "Đối soát quyết toán" & "Báo cáo lãi/lỗ" lộ doanh thu nên chỉ Giám đốc thấy.
const MODULES: ModuleDef[] = [
  { href: "/projects", label: "Dự án", icon: FolderOpenIcon, tint: "bg-steel/10 text-steel", tiers: ["DIRECTOR", "MANAGER"] },
  { href: "/attendance", label: "Chấm công", icon: ClockIcon, tint: "bg-steel/10 text-steel", tiers: ["DIRECTOR", "MANAGER"] },
  { href: "/evaluations", label: "Đánh giá nhân sự", icon: StarIcon, tint: "bg-amber/15 text-amber-deep", tiers: ["DIRECTOR", "MANAGER"] },
  { href: "/leave", label: "Nghỉ phép", icon: CalendarDaysIcon, tint: "bg-steel/10 text-steel", tiers: ["DIRECTOR", "MANAGER"] },
  { href: "/audit", label: "Nhật ký hoạt động", icon: ShieldCheckIcon, tint: "bg-amber/15 text-amber-deep", tiers: ["DIRECTOR"] },
];

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(api.cachedUser());
  const [projects, setProjects] = useState<Project[]>([]);
  const [kpi, setKpi] = useState<KpiSummary | null>(null);
  const [profit, setProfit] = useState<ProjectProfit[]>([]);

  useEffect(() => {
    let alive = true;
    // Nạp phần dữ liệu theo tầng (không đụng /me) — dùng cho cả lần đầu lẫn polling.
    function loadDashboard(tier: Tier) {
      if (tier === "STAFF") {
        api.projects().then((d) => alive && setProjects(d)).catch(() => {});
      } else if (tier === "MANAGER") {
        // Quản lý: KHÔNG gọi /dashboard/summary|profit (đã chặn ở backend) — chỉ dữ liệu vận hành.
        api.projects().then((d) => alive && setProjects(d)).catch(() => {});
      } else {
        api.kpiSummary().then((d) => alive && setKpi(d)).catch(() => {});
        api.profitByProject().then((d) => alive && setProfit(d)).catch(() => {});
        api.projects().then((d) => alive && setProjects(d)).catch(() => {});
      }
    }

    let timer: ReturnType<typeof setInterval> | undefined;
    api.me().then((u) => {
      if (!alive) return;
      setUser(u);
      const tier = roleTier(u.role);
      loadDashboard(tier);
      // Cập nhật gần thời gian thực (~20s). Không nạp lại /me để tránh nháy màn hình.
      timer = setInterval(() => {
        if (document.visibilityState === "visible") loadDashboard(tier);
      }, 20_000);
    }).catch(() => {
      router.push("/login");
    });
    return () => { alive = false; if (timer) clearInterval(timer); };
  }, [router]);

  if (!user) {
    return (
      <AppShell><div className="flex min-h-[70vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-steel border-t-amber" />
      </div></AppShell>
    );
  }

  const tier = roleTier(user.role);

  const isMUUser = Boolean(
    user.full_name?.toUpperCase().includes("DUNG") ||
    user.full_name?.toUpperCase().includes("P.A.DUNG") ||
    user.email?.toLowerCase().includes("hientruong")
  );

  // ==================== GIAO DIỆN NHÂN VIÊN (STAFF) ====================
  if (tier === "STAFF") {
    return (
      <AppShell>
        {/* Họa vết logo Manchester United chuẩn làm background watermark mờ sang trọng cho riêng trang Tổng quan của P.A.DUNG */}
        {isMUUser && (
          <div className="pointer-events-none fixed inset-0 z-0 flex items-center justify-center overflow-hidden opacity-15">
            <img
              src="/mu_logo.png?v=7"
              alt="Official Manchester United Crest Watermark"
              className="h-[550px] w-[550px] lg:h-[700px] lg:w-[700px] max-w-none object-contain filter drop-shadow-[0_0_60px_rgba(218,2,14,0.35)]"
            />
          </div>
        )}

        <div className="relative z-10 space-y-4">
          {/* Lời chào — Giao diện Manchester United Red Devils Độc quyền cho P.A.DUNG */}
          {isMUUser ? (
            <section className="relative overflow-hidden rounded-xl2 bg-gradient-to-r from-[#800000] via-[#DA020E] to-[#120002] p-5 lg:p-6 text-white shadow-2xl border border-yellow-500/40 transition-all duration-300 hover:shadow-red-900/60">
              {/* Lớp hoa văn sọc bóng đá MU & Watermark logo MU căng rộng ra chính giữa */}
              <div className="absolute inset-0 opacity-20 bg-[linear-gradient(45deg,#000_25%,transparent_25%,transparent_50%,#000_50%,#000_75%,transparent_75%,transparent)] bg-[size:24px_24px] pointer-events-none" />
              <img
                src="/mu_logo.png?v=7"
                alt="MU Crest Center Watermark"
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-48 w-48 sm:h-56 sm:w-56 lg:h-64 lg:w-64 object-contain opacity-25 pointer-events-none filter drop-shadow-2xl"
              />
              <div className="absolute right-0 top-0 -mr-10 -mt-10 h-44 w-44 rounded-full bg-red-500/30 blur-3xl pointer-events-none" />
              <div className="absolute left-1/3 bottom-0 -mb-10 h-40 w-40 rounded-full bg-yellow-500/20 blur-2xl pointer-events-none" />
              
              <div className="relative z-10 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-black/60 border border-yellow-400 px-3 py-0.5 text-[10px] font-extrabold uppercase tracking-widest text-yellow-300 shadow-md">
                      ⚽ MANCHESTER UNITED EDITION 👹
                    </span>
                    <span className="text-[11px] text-yellow-200 font-bold tracking-wider">GLORY GLORY MAN UNITED</span>
                  </div>
                  <h1 className="mt-2 text-2xl lg:text-3xl font-extrabold tracking-tight text-white drop-shadow-md">
                    Xin chào, {user.full_name}! 👹 
                  </h1>
                  <p className="mt-1 text-xs text-yellow-200 font-medium italic">
                    "Old Trafford Special Theme — Giao diện độc quyền Red Devils!" 🏆
                  </p>
                </div>

                {/* Hình ảnh Cristiano Ronaldo CR7 Manchester United — HD Phóng to sắc nét */}
                <div className="relative flex items-center justify-center shrink-0 my-1">
                  <div className="absolute -inset-2 rounded-2xl bg-gradient-to-r from-yellow-400 via-red-500 to-yellow-300 blur-md opacity-90 animate-pulse" />
                  <img
                    src="/ronaldo.png?v=4"
                    alt="CR7 Manchester United"
                    className="relative h-32 w-32 sm:h-36 sm:w-36 lg:h-44 lg:w-44 object-cover object-top rounded-2xl border-3 border-yellow-400 shadow-2xl transition-transform duration-300 hover:scale-105"
                  />
                </div>
              </div>

              <div className="relative z-10 mt-4 flex flex-wrap items-center gap-4 text-xs text-white/95 border-t border-red-500/40 pt-3">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-yellow-400 animate-pulse" />
                  <span>Vai trò: <span className="font-bold text-white">{roleTitle(user.role, user.has_subordinates, !user.manager_id && !user.manager_ids)}</span></span>
                </div>
                {user.manager_name && (
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-yellow-400" />
                    <span>Người quản lý: <span className="font-bold text-white">{user.manager_name}</span></span>
                  </div>
                )}
                {user.phone && (
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-yellow-400" />
                    <span>SĐT liên hệ: <span className="font-bold text-white">{user.phone}</span></span>
                  </div>
                )}
              </div>
            </section>
          ) : (
            <section className="relative overflow-hidden rounded-xl2 bg-gradient-to-br from-cyan-600 via-blue-700 to-indigo-900 p-5 lg:p-6 text-white shadow-lg transition-all duration-300 hover:shadow-xl">
              <div className="absolute right-0 top-0 -mr-6 -mt-6 h-28 w-28 rounded-full bg-white/10 blur-xl" />
              <div className="absolute left-1/4 bottom-0 -mb-10 h-36 w-36 rounded-full bg-cyan-400/25 blur-2xl" />
              <p className="text-xs text-yellow-300 font-bold uppercase tracking-wider">DOSCO COMPANY LIMITED</p>
              <h1 className="mt-1 text-2xl lg:text-3xl font-bold tracking-tight">Xin chào, {user.full_name}! 👋</h1>
              <div className="relative z-10 mt-4 flex flex-col gap-1.5 text-xs text-white/85">
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-yellow-300 animate-pulse-glow" />
                  <span>Vai trò: <span className="font-semibold text-white">{roleTitle(user.role, user.has_subordinates, !user.manager_id && !user.manager_ids)}</span></span>
                </div>
                {user.manager_name && (
                  <div className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-yellow-300" />
                    <span>Người quản lý: <span className="font-semibold text-white">{user.manager_name}</span></span>
                  </div>
                )}
                {user.phone && (
                  <div className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-yellow-300" />
                    <span>SĐT liên hệ: <span className="font-semibold text-white">{user.phone}</span></span>
                  </div>
                )}
              </div>
            </section>
          )}

        {/* Đánh giá quản lý */}
        <section className="mt-5">
          <Link
            href="/evaluations"
            className="flex items-center justify-between rounded-xl2 bg-white p-4 shadow-card border-l-4 border-amber card-hover"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl2 bg-amber/15 text-amber-deep">
                <StarIcon className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink">Đánh giá quản lý</p>
                <p className="text-[11px] text-muted">Chấm điểm & nhận xét quản lý trực tiếp</p>
              </div>
            </div>
            <span className="text-steel transition-transform duration-200 hover:translate-x-1">→</span>
          </Link>
        </section>

        {/* Đơn nghỉ phép */}
        <section className="mt-3">
          <Link
            href="/leave"
            className="flex items-center justify-between rounded-xl2 bg-white p-4 shadow-card border-l-4 border-steel card-hover"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl2 bg-steel/10 text-steel">
                <CalendarDaysIcon className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink">Đơn nghỉ phép</p>
                <p className="text-[11px] text-muted">Xin nghỉ & theo dõi trạng thái duyệt</p>
              </div>
            </div>
            <span className="text-steel transition-transform duration-200 hover:translate-x-1">→</span>
          </Link>
        </section>

        {/* Lịch làm việc */}
        <section className="mt-5">
          <div className="flex items-center gap-2 mb-2">
            <ClockIcon className="h-5 w-5 text-steel" />
            <h2 className="text-sm font-semibold text-ink">Lịch làm việc của bạn</h2>
          </div>
          <div className="rounded-xl2 bg-white p-4 shadow-card card-hover">
            {user.schedule ? (
              <div className="whitespace-pre-line text-sm text-ink leading-relaxed font-medium">
                {user.schedule}
              </div>
            ) : (
              <p className="text-center text-xs text-muted py-3">
                Chưa có lịch làm việc được phân công tuần này.
              </p>
            )}
          </div>
        </section>

        {/* Danh sách dự án */}
        <section className="mt-5">
          <div className="flex items-center gap-2 mb-2">
            <FolderOpenIcon className="h-5 w-5 text-steel" />
            <h2 className="text-sm font-semibold text-ink">Dự án của công ty</h2>
          </div>
          <div className="space-y-3 lg:space-y-0 lg:grid lg:grid-cols-2 xl:grid-cols-3 lg:gap-3">
            {projects.length === 0 ? (
              <p className="rounded-xl2 bg-white p-4 text-center text-xs text-muted shadow-card lg:col-span-2 xl:col-span-3">
                Chưa có dự án nào trong hệ thống.
              </p>
            ) : (
              projects.map((proj) => (
                <div key={proj.id} className="rounded-xl2 bg-white p-4 shadow-card border-l-4 border-amber card-hover">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="inline-block rounded-md bg-steel/10 px-2 py-0.5 text-[10px] font-bold text-steel">
                        {proj.code}
                      </span>
                      <h3 className="mt-1 text-sm font-semibold text-ink">{proj.name}</h3>
                      {proj.location && (
                        <p className="mt-1 text-xs text-muted">📍 Địa điểm: {proj.location}</p>
                      )}
                    </div>
                    <span className="rounded-full bg-ok/10 px-2.5 py-0.5 text-[10px] font-semibold text-ok uppercase tracking-wider">
                      {proj.status}
                    </span>
                  </div>
                  {(proj.start_date || proj.end_date) && (
                    <div className="mt-3 flex items-center justify-between border-t border-line pt-2 text-[10px] text-muted">
                      <span>Bắt đầu: {proj.start_date || "—"}</span>
                      <span>Kết thúc: {proj.end_date || "—"}</span>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </section>

        {/* Sơ đồ tổ chức công ty */}
        <section className="mt-5">
          <CompanyOrgChart />
        </section>
        </div>
      </AppShell>
    );
  }

  // ============ GIAO DIỆN GIÁM ĐỐC & QUẢN LÝ (dùng chung khung) ============
  const isDir = tier === "DIRECTOR";
  const modules = MODULES.filter((m) => m.tiers.includes(tier));

  return (
    <AppShell>
      {isDir ? (
        <>
          {/* Lời chào Giám đốc */}
          <section className="relative overflow-hidden mb-4 rounded-xl2 bg-gradient-to-br from-amber-600 via-amber-700 to-slate-900 p-5 lg:p-6 text-white shadow-lg transition-all duration-300 hover:shadow-xl">
            <div className="absolute right-0 top-0 -mr-6 -mt-6 h-28 w-28 rounded-full bg-white/10 blur-xl" />
            <div className="absolute left-1/3 bottom-0 -mb-10 h-36 w-36 rounded-full bg-yellow-400/25 blur-2xl" />
            <p className="text-xs text-yellow-300 font-bold uppercase tracking-wider">DOSCO COMPANY LIMITED</p>
            <h1 className="mt-1 text-xl lg:text-2xl font-bold tracking-tight">Xin chào, {user.full_name}! 👑</h1>
            <p className="relative z-10 mt-2 text-xs text-white/80">
              Hệ thống quản trị tài chính & điều hành doanh nghiệp thời gian thực.
            </p>
          </section>

          {/* ---- Hai thẻ KPI chính (chỉ Giám đốc) ---- */}
          <section className="grid grid-cols-2 gap-3 lg:gap-4">
            <div className="rounded-xl2 bg-gradient-to-br from-slate-900 to-ink p-4 lg:p-6 text-white card-hover border border-white/5">
              <p className="text-xs text-white/60">Hợp đồng đang quản lý</p>
              <p className="mt-2 text-3xl lg:text-4xl font-bold tnum text-amber">{kpi?.active_contracts ?? "—"}</p>
              <p className="mt-1 text-[11px] text-white/50">gói thầu / dự án</p>
            </div>
            <div className="rounded-xl2 bg-gradient-to-br from-steel to-slate-800 p-4 lg:p-6 text-white card-hover border border-white/5">
              <p className="text-xs text-white/70">Tổng giá trị HĐ</p>
              <p className="mt-2 text-3xl lg:text-4xl font-bold tnum text-amber">
                {kpi ? formatCompactVND(kpi.total_contract_value) : "—"}
              </p>
              <p className="mt-1 text-[11px] text-white/60">chưa gồm VAT</p>
            </div>
          </section>

          {/* ---- Dải lợi nhuận ước tính (chỉ Giám đốc) ---- */}
          <section className="mt-3 lg:mt-4 rounded-xl2 bg-white p-4 lg:p-6 shadow-card card-hover border-l-4 border-ok">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted">Lợi nhuận ước tính</p>
                <p className={`mt-1 text-2xl font-bold tnum ${(kpi?.estimated_profit ?? 0) >= 0 ? "text-ok" : "text-bad"}`}>
                  {kpi ? formatVND(kpi.estimated_profit) : "—"}
                </p>
              </div>
              <div className="text-right text-[11px] text-muted">
                <p>Đã thu</p>
                <p className="font-semibold text-ink">{kpi ? formatCompactVND(kpi.total_collected) : "—"}</p>
              </div>
            </div>
          </section>
        </>
      ) : (
        /* ---- Header vận hành cho Quản lý (không có tiền) ---- */
        <section className="relative overflow-hidden rounded-xl2 bg-gradient-to-br from-violet-600 via-purple-700 to-slate-900 p-5 lg:p-6 text-white shadow-lg transition-all duration-300 hover:shadow-xl">
          <div className="absolute right-0 top-0 -mr-6 -mt-6 h-28 w-28 rounded-full bg-white/10 blur-xl" />
          <div className="absolute left-1/3 bottom-0 -mb-10 h-36 w-36 rounded-full bg-purple-400/25 blur-2xl" />
          <p className="text-xs text-yellow-300 font-bold uppercase tracking-wider">DOSCO COMPANY LIMITED</p>
          <h1 className="mt-1 text-xl lg:text-2xl font-bold tracking-tight">Xin chào, {user.full_name}! 👔</h1>
          <p className="relative z-10 mt-2 text-xs text-white/80">
            Điều hành dự án, nhân sự và chấm công. (Số liệu doanh thu/lãi-lỗ do Ban Giám đốc quản lý.)
          </p>
          <div className="relative z-10 mt-4 grid grid-cols-2 gap-3 lg:max-w-md">
            <div className="rounded-xl2 bg-white/10 p-3 card-hover">
              <p className="text-[11px] text-white/60">Dự án</p>
              <p className="mt-1 text-2xl font-bold tnum">{projects.length}</p>
            </div>
          </div>
        </section>
      )}

      {/* ---- Lưới chức năng (lọc theo tầng) ---- */}
      <section className="mt-5">
        <h2 className="mb-2 text-sm font-semibold text-ink">Chức năng</h2>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6 lg:gap-4">
          {modules.map((m, i) => (
            <Link
              key={i}
              href={m.href}
              className="flex flex-col items-center gap-2 rounded-xl2 bg-white p-3 lg:p-4 text-center shadow-card card-hover"
            >
              <span className={`flex h-11 w-11 items-center justify-center rounded-xl2 transition-transform duration-300 hover:scale-110 ${m.tint}`}>
                <m.icon className="h-6 w-6" />
              </span>
              <span className="text-[11px] font-medium leading-tight text-ink">{m.label}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* Sơ đồ tổ chức công ty */}
      <section className="mt-6">
        <CompanyOrgChart />
      </section>

    </AppShell>
  );
}
