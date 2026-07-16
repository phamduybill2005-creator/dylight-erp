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
  ArrowRightCircleIcon,
  ArrowLeftEndOnRectangleIcon,
} from "@heroicons/react/24/outline";
import AppShell from "@/components/app-shell";
import { api } from "@/lib/api";
import { roleTier, roleTitle, type Tier } from "@/lib/roles";
import { formatCompactVND, formatVND, todayLocal } from "@/lib/format";
import type { KpiSummary, ProjectProfit, User, Project, Attendance } from "@/lib/types";

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
  { href: "/finance", label: "Tài chính & Công nợ", icon: CurrencyDollarIcon, tint: "bg-ok/10 text-ok", tiers: ["DIRECTOR"] },
  { href: "/reconciliation", label: "Đối soát quyết toán", icon: ScaleIcon, tint: "bg-steel/10 text-steel", tiers: ["DIRECTOR"] },
  { href: "/reports", label: "Báo cáo lãi / lỗ", icon: BanknotesIcon, tint: "bg-ok/10 text-ok", tiers: ["DIRECTOR"] },
  { href: "/audit", label: "Nhật ký hoạt động", icon: ShieldCheckIcon, tint: "bg-amber/15 text-amber-deep", tiers: ["DIRECTOR"] },
];

const todayStr = todayLocal;
const fmtTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : "—";

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(api.cachedUser());
  const [projects, setProjects] = useState<Project[]>([]);
  const [kpi, setKpi] = useState<KpiSummary | null>(null);
  const [profit, setProfit] = useState<ProjectProfit[]>([]);
  const [todayAtt, setTodayAtt] = useState<Attendance | null>(null);
  const [attBusy, setAttBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    // Nạp phần dữ liệu theo tầng (không đụng /me) — dùng cho cả lần đầu lẫn polling.
    function loadDashboard(tier: Tier) {
      if (tier === "STAFF") {
        api.projects().then((d) => alive && setProjects(d)).catch(() => {});
        api.attendanceMe(todayStr(), todayStr())
          .then((recs) => alive && setTodayAtt(recs[0] ?? null))
          .catch(() => {});
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

  async function quickPunch(kind: "in" | "out") {
    setAttBusy(true);
    try {
      const rec = kind === "in" ? await api.checkIn() : await api.checkOut();
      setTodayAtt(rec);
    } catch {
      /* nuốt lỗi — màn chấm công đầy đủ ở /attendance */
    } finally {
      setAttBusy(false);
    }
  }

  if (!user) {
    return (
      <AppShell><div className="flex min-h-[70vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-steel border-t-amber" />
      </div></AppShell>
    );
  }

  const tier = roleTier(user.role);

  // ==================== GIAO DIỆN NHÂN VIÊN (STAFF) ====================
  if (tier === "STAFF") {
    return (
      <AppShell>
        {/* Lời chào */}
        <section className="relative overflow-hidden rounded-xl2 bg-gradient-to-br from-cyan-600 via-blue-700 to-indigo-900 p-5 lg:p-6 text-white shadow-lg transition-all duration-300 hover:shadow-xl">
          <div className="absolute right-0 top-0 -mr-6 -mt-6 h-28 w-28 rounded-full bg-white/10 blur-xl" />
          <div className="absolute left-1/4 bottom-0 -mb-10 h-36 w-36 rounded-full bg-cyan-400/25 blur-2xl" />
          <p className="text-xs text-yellow-300 font-bold uppercase tracking-wider">Trang nhân viên</p>
          <h1 className="mt-1 text-2xl lg:text-3xl font-bold tracking-tight">Xin chào, {user.full_name}! 👋</h1>
          <div className="relative z-10 mt-4 flex flex-col gap-1.5 text-xs text-white/85">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-yellow-300 animate-pulse-glow" />
              <span>Vai trò: <span className="font-semibold text-white">{roleTitle(user.role, user.has_subordinates)}</span></span>
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

        {/* Chấm công hôm nay */}
        <section className="mt-5">
          <div className="flex items-center gap-2 mb-2">
            <ClockIcon className="h-5 w-5 text-steel" />
            <h2 className="text-sm font-semibold text-ink">Chấm công hôm nay</h2>
          </div>
          <div className="rounded-xl2 bg-white p-4 shadow-card card-hover">
            <div className="flex items-center justify-between text-center">
              <div className="flex-1">
                <p className="text-[10px] text-muted">Giờ vào</p>
                <p className="mt-0.5 text-lg font-bold text-ink tnum">{fmtTime(todayAtt?.check_in)}</p>
              </div>
              <div className="h-8 w-px bg-line" />
              <div className="flex-1">
                <p className="text-[10px] text-muted">Giờ ra</p>
                <p className="mt-0.5 text-lg font-bold text-ink tnum">{fmtTime(todayAtt?.check_out)}</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                onClick={() => quickPunch("in")}
                disabled={attBusy || !!todayAtt?.check_in}
                className="flex items-center justify-center gap-1.5 rounded-xl2 bg-ok/90 hover:bg-ok py-2.5 text-xs font-semibold text-white shadow-sm transition-all duration-200 active:scale-95 disabled:opacity-40"
              >
                <ArrowRightCircleIcon className="h-4 w-4" /> Chấm vào
              </button>
              <button
                onClick={() => quickPunch("out")}
                disabled={attBusy}
                className="flex items-center justify-center gap-1.5 rounded-xl2 bg-ink hover:bg-ink/90 py-2.5 text-xs font-semibold text-white shadow-sm transition-all duration-200 active:scale-95 disabled:opacity-40"
              >
                <ArrowLeftEndOnRectangleIcon className="h-4 w-4" /> Chấm ra
              </button>
            </div>
            {todayAtt?.is_late && (
              <p className="mt-2 text-center text-[11px] font-semibold text-bad">Hôm nay bạn đi trễ.</p>
            )}
            <Link href="/attendance" className="mt-3 block text-center text-[11px] font-semibold text-steel hover:text-ink transition-colors">
              Xem lịch sử chấm công →
            </Link>
          </div>
        </section>

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
            <p className="text-xs text-yellow-300 font-bold uppercase tracking-wider">Ban Giám đốc</p>
            <h1 className="mt-1 text-xl lg:text-2xl font-bold tracking-tight">Xin chào Giám đốc, {user.full_name}! 👑</h1>
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
          <p className="text-xs text-yellow-300 font-bold uppercase tracking-wider">Trang quản lý</p>
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

      {/* ---- Lãi/lỗ theo dự án (CHỈ Giám đốc) ---- */}
      {isDir && (
        <section className="mt-5">
          <h2 className="mb-2 text-sm font-semibold text-ink">Lãi / lỗ theo dự án</h2>
          <div className="space-y-2 lg:space-y-0 lg:grid lg:grid-cols-2 lg:gap-3">
            {profit.length === 0 && (
              <p className="rounded-xl2 bg-white p-4 text-center text-xs text-muted shadow-card lg:col-span-2">
                Chưa có dữ liệu dự án.
              </p>
            )}
            {profit.map((p) => {
              const positive = p.profit >= 0;
              return (
                <div key={p.project_id} className="rounded-xl2 bg-white p-3 shadow-card card-hover border-t-2 border-line">
                  <div className="flex items-center justify-between">
                    <p className="min-w-0 truncate text-sm font-medium text-ink">{p.project_name}</p>
                    <span className={`ml-2 flex shrink-0 items-center gap-1 text-sm font-semibold ${positive ? "text-ok" : "text-bad"}`}>
                      {positive ? (
                        <ArrowTrendingUpIcon className="h-4 w-4" />
                      ) : (
                        <ArrowTrendingDownIcon className="h-4 w-4" />
                      )}
                      {Number(p.margin_percent || 0).toFixed(1)}%
                    </span>
                  </div>
                  <div className="mt-2 flex justify-between text-[11px] text-muted">
                    <span>GT hợp đồng: {formatCompactVND(p.contract_value)}</span>
                    <span>Chi phí: {formatCompactVND(p.cost)}</span>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line">
                    <div
                      className={positive ? "h-full bg-ok" : "h-full bg-bad"}
                      style={{
                        width: `${Math.min(100, p.contract_value > 0 ? (p.cost / p.contract_value) * 100 : 0)}%`,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </AppShell>
  );
}
