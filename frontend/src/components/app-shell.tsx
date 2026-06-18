"use client";

// Khung giao diện RESPONSIVE — dùng được cả trên điện thoại và máy tính (PC/web).
//  - Mobile (< lg): thanh tiêu đề trên + thanh điều hướng dưới + nút FAB "Chụp hóa đơn".
//  - Desktop (lg+): thanh điều hướng dọc (sidebar) bên trái với menu đầy đủ; nội dung giãn rộng.
// Menu thay đổi theo 3 tầng vai trò (Giám đốc / Quản lý / Nhân viên).

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  HomeIcon,
  FolderIcon,
  DocumentTextIcon,
  UserCircleIcon,
  CameraIcon,
  ChevronDownIcon,
  BuildingOffice2Icon,
  ClockIcon,
  UsersIcon,
  StarIcon,
  ScaleIcon,
  BanknotesIcon,
  ClipboardDocumentListIcon,
  CurrencyDollarIcon,
  CalendarDaysIcon,
  TruckIcon,
  ShieldCheckIcon,
  RectangleStackIcon,
  ArrowRightOnRectangleIcon,
} from "@heroicons/react/24/outline";
import { api, tokenStore } from "@/lib/api";
import { ROLE_LABEL, roleTier, type Tier } from "@/lib/roles";
import type { Company, User } from "@/lib/types";

type IconType = React.ComponentType<{ className?: string }>;
type NavLink = { href: string; label: string; icon: IconType };

const CAPTURE_HREF = "/invoices?capture=1";

// Menu đầy đủ cho sidebar desktop (mobile dùng bản rút gọn 4 mục bên dưới).
function deskNav(tier: Tier): NavLink[] {
  if (tier === "STAFF") {
    return [
      { href: "/", label: "Trang chủ", icon: HomeIcon },
      { href: "/attendance", label: "Chấm công", icon: ClockIcon },
      { href: "/leave", label: "Nghỉ phép", icon: CalendarDaysIcon },
      { href: "/evaluations", label: "Đánh giá quản lý", icon: StarIcon },
      { href: "/profile", label: "Cá nhân", icon: UserCircleIcon },
    ];
  }
  const items: NavLink[] = [
    { href: "/", label: "Tổng quan", icon: HomeIcon },
    { href: "/bids", label: "Đấu thầu", icon: ClipboardDocumentListIcon },
    { href: "/projects", label: "Dự án & Hợp đồng", icon: FolderIcon },
    { href: "/design-docs", label: "Hồ sơ thiết kế", icon: RectangleStackIcon },
    { href: "/invoices", label: "Hóa đơn", icon: DocumentTextIcon },
    { href: "/attendance", label: "Chấm công", icon: ClockIcon },
    { href: "/leave", label: "Nghỉ phép", icon: CalendarDaysIcon },
    { href: "/evaluations", label: "Đánh giá nhân sự", icon: StarIcon },
    { href: "/equipment", label: "Thiết bị", icon: TruckIcon },
    { href: "/employees", label: "Nhân sự", icon: UsersIcon },
  ];
  if (tier === "DIRECTOR") {
    items.push(
      { href: "/partners", label: "Đối tác", icon: BuildingOffice2Icon },
      { href: "/payroll", label: "Bảng lương", icon: UsersIcon },
      { href: "/finance", label: "Tài chính & Công nợ", icon: CurrencyDollarIcon },
      { href: "/reconciliation", label: "Đối soát quyết toán", icon: ScaleIcon },
      { href: "/reports", label: "Báo cáo lãi / lỗ", icon: BanknotesIcon },
      { href: "/audit", label: "Nhật ký hoạt động", icon: ShieldCheckIcon }
    );
  }
  return items;
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (!tokenStore.get()) {
      router.replace("/login");
      return;
    }
    api.me().then(setUser).catch(() => router.replace("/login"));
    api.companies().then(setCompanies).catch(() => {});
  }, [router]);

  const activeCompany =
    companies.find((c) => c.id === user?.company_id) ?? companies[0];
  const tier = roleTier(user?.role);

  function logout() {
    tokenStore.clear();
    router.replace("/login");
  }

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href.split("?")[0]);

  return (
    <div className="min-h-screen bg-paper lg:flex">
      {/* ====================== SIDEBAR (DESKTOP) ====================== */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-ink text-white lg:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <img src="/logo.png" alt="DOSCO" className="h-10 w-auto rounded-lg bg-white/95 px-3 py-1.5 object-contain" />
          <p className="text-[10px] leading-tight text-white/60">Hệ thống<br />quản lý dự án</p>
        </div>

        {/* Chọn công ty / chi nhánh */}
        <div className="relative px-3">
          <button
            onClick={() => setPickerOpen((v) => !v)}
            className="flex w-full items-center gap-2 rounded-xl2 bg-white/10 px-3 py-2 text-xs hover:bg-white/15"
          >
            <BuildingOffice2Icon className="h-4 w-4 shrink-0 text-amber" />
            <span className="truncate text-left">{activeCompany?.name ?? "Đang tải…"}</span>
            <ChevronDownIcon className="ml-auto h-3.5 w-3.5 shrink-0" />
          </button>
          {pickerOpen && companies.length > 0 && (
            <div className="absolute left-3 right-3 z-40 mt-2 overflow-hidden rounded-xl2 bg-white text-ink shadow-card">
              {companies.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setPickerOpen(false)}
                  className={`flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-paper ${
                    c.id === activeCompany?.id ? "font-semibold" : ""
                  }`}
                >
                  <span className="truncate">{c.name}</span>
                  <span className="ml-2 font-mono text-[11px] text-muted">{c.code}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Nút Chụp hóa đơn nổi bật */}
        <div className="px-3 pt-4">
          <Link
            href={CAPTURE_HREF}
            className="flex items-center justify-center gap-2 rounded-xl2 bg-amber py-2.5 text-sm font-semibold text-ink shadow-fab"
          >
            <CameraIcon className="h-5 w-5" /> Chụp hóa đơn
          </Link>
        </div>

        {/* Menu dọc */}
        <nav className="mt-4 flex-1 space-y-1 overflow-y-auto px-3 pb-4">
          {deskNav(tier).map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.label}
                href={item.href}
                className={`flex items-center gap-3 rounded-xl2 px-3 py-2.5 text-sm transition-colors ${
                  active ? "bg-white/15 font-semibold text-white" : "text-white/70 hover:bg-white/10 hover:text-white"
                }`}
              >
                <item.icon className="h-5 w-5 shrink-0" />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Người dùng + Đăng xuất */}
        <div className="border-t border-white/10 px-3 py-3">
          <div className="flex items-center gap-2 px-2 py-1">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber text-ink">
              <UserCircleIcon className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-white">{user?.full_name ?? "—"}</p>
              <p className="truncate text-[10px] text-white/50">{user?.role ? ROLE_LABEL[user.role] : ""}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="mt-2 flex w-full items-center gap-2 rounded-xl2 px-3 py-2 text-xs text-white/70 hover:bg-white/10 hover:text-white"
          >
            <ArrowRightOnRectangleIcon className="h-4 w-4" /> Đăng xuất
          </button>
        </div>
      </aside>

      {/* ====================== CỘT NỘI DUNG ====================== */}
      <div className="flex min-h-screen flex-1 flex-col lg:pl-64">
        {/* ---- Thanh tiêu đề (chỉ MOBILE) ---- */}
        <header className="sticky top-0 z-30 bg-ink text-white lg:hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2">
              <img src="/logo.png" alt="DOSCO" className="h-9 w-auto rounded-lg bg-white/95 px-3 py-1.5 object-contain" />
              <div className="leading-tight">
                <p className="text-[10px] text-white/60">Hệ thống quản lý dự án</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <button
                  onClick={() => setPickerOpen((v) => !v)}
                  className="flex max-w-[150px] items-center gap-1 rounded-xl2 bg-white/10 px-3 py-1.5 text-xs"
                >
                  <BuildingOffice2Icon className="h-4 w-4 shrink-0 text-amber" />
                  <span className="truncate">{activeCompany?.name ?? "Đang tải…"}</span>
                  <ChevronDownIcon className="h-3.5 w-3.5 shrink-0" />
                </button>
                {pickerOpen && companies.length > 0 && (
                  <div className="absolute right-0 mt-2 w-60 overflow-hidden rounded-xl2 bg-white text-ink shadow-card">
                    {companies.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => setPickerOpen(false)}
                        className={`flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-paper ${
                          c.id === activeCompany?.id ? "font-semibold" : ""
                        }`}
                      >
                        <span className="truncate">{c.name}</span>
                        <span className="ml-2 font-mono text-[11px] text-muted">{c.code}</span>
                      </button>
                    ))}
                    <div className="border-t border-line px-4 py-2 text-[11px] text-muted font-normal text-slate-700">
                      Đăng nhập: {user?.full_name} · {user?.role ? ROLE_LABEL[user.role] : ""}
                    </div>
                  </div>
                )}
              </div>
              <button
                onClick={logout}
                className="flex h-[30px] w-[30px] items-center justify-center rounded-xl2 bg-white/10 text-white hover:bg-white/20 transition-colors"
                title="Đăng xuất"
              >
                <ArrowRightOnRectangleIcon className="h-4 w-4" />
              </button>
            </div>
          </div>
        </header>

        {/* ---- Nội dung trang ---- */}
        <motion.main
          key={pathname}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="flex-1 px-4 pb-28 pt-4 lg:px-8 lg:pb-12 lg:pt-8"
        >
          <div className="mx-auto w-full max-w-md lg:max-w-6xl">{children}</div>
        </motion.main>

        {/* ---- Thanh điều hướng dưới + FAB (chỉ MOBILE) ---- */}
        <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-md lg:hidden">
          <div className="relative mx-3 mb-3 flex items-center justify-between rounded-xl2 bg-white px-6 py-2 shadow-card">
            {tier === "STAFF" ? (
              <>
                <NavItem href="/" label="Trang chủ" icon={HomeIcon} active={pathname === "/"} />
                <NavItem href="/attendance" label="Chấm công" icon={ClockIcon} active={pathname.startsWith("/attendance")} />
                <div className="w-14" aria-hidden />
                <NavItem href="/evaluations" label="Đánh giá" icon={StarIcon} active={pathname.startsWith("/evaluations")} />
                <NavItem href="/profile" label="Cá nhân" icon={UserCircleIcon} active={pathname === "/profile"} />
              </>
            ) : (
              <>
                <NavItem href="/" label="Tổng quan" icon={HomeIcon} active={pathname === "/"} />
                <NavItem href="/projects" label="Dự án" icon={FolderIcon} active={pathname.startsWith("/projects")} />
                <div className="w-14" aria-hidden />
                <NavItem href="/invoices" label="Hóa đơn" icon={DocumentTextIcon} active={pathname.startsWith("/invoices")} />
                <NavItem href="/employees" label="Nhân sự" icon={UsersIcon} active={pathname.startsWith("/employees")} />
              </>
            )}

            {/* FAB Chụp hóa đơn */}
            <Link href={CAPTURE_HREF} className="absolute -top-7 left-1/2 -translate-x-1/2">
              <motion.div
                whileTap={{ scale: 0.92 }}
                className="flex h-16 w-16 flex-col items-center justify-center rounded-full bg-amber text-ink shadow-fab ring-4 ring-paper"
              >
                <CameraIcon className="h-6 w-6" />
                <span className="text-[9px] font-semibold leading-none">Chụp</span>
              </motion.div>
            </Link>
          </div>
        </nav>
      </div>
    </div>
  );
}

function NavItem({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: IconType;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex flex-col items-center gap-0.5 ${active ? "text-steel" : "text-muted"}`}
    >
      <Icon className="h-6 w-6" />
      <span className="text-[10px]">{label}</span>
    </Link>
  );
}
