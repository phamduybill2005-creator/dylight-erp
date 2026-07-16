"use client";

// Khung giao diện RESPONSIVE — dùng được cả trên điện thoại và máy tính (PC/web).
//  - Mobile (< lg): thanh tiêu đề trên + thanh điều hướng dưới.
//  - Desktop (lg+): thanh điều hướng dọc (sidebar) bên trái với menu đầy đủ; nội dung giãn rộng.
// Menu thay đổi theo 3 tầng vai trò (Giám đốc / Quản lý / Nhân viên).

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  HomeIcon,
  FolderIcon,
  UserCircleIcon,
  ChevronDownIcon,
  BuildingOffice2Icon,
  ClockIcon,
  FingerPrintIcon,
  UsersIcon,
  UserGroupIcon,
  StarIcon,
  CalendarDaysIcon,
  TableCellsIcon,
} from "@heroicons/react/24/outline";
import { api, tokenStore } from "@/lib/api";
import { roleTitle, roleTier, type Tier } from "@/lib/roles";
import type { Company, User } from "@/lib/types";
import NotificationsBell from "./notifications-bell";
import ChatWidget from "./chat-widget";
import AccountMenu from "./account-menu";
import DeadlineAlert from "./deadline-alert";
import EvaluationAlert from "./evaluation-alert";

type IconType = React.ComponentType<{ className?: string }>;
type NavLink = { href: string; label: string; icon: IconType };

// Menu đầy đủ cho sidebar desktop (mobile dùng bản rút gọn 4 mục bên dưới).
function deskNav(tier: Tier): NavLink[] {
  if (tier === "STAFF") {
    return [
      { href: "/", label: "Trang chủ", icon: HomeIcon },
      { href: "/projects", label: "Dự án", icon: FolderIcon },
      { href: "/timesheet", label: "Nhân công", icon: TableCellsIcon },
      { href: "/attendance", label: "Chấm công", icon: ClockIcon },
      { href: "/leave", label: "Nghỉ phép", icon: CalendarDaysIcon },
      { href: "/evaluations", label: "Đánh giá quản lý", icon: StarIcon },
      { href: "/colleagues", label: "Đồng nghiệp", icon: UserGroupIcon },
      { href: "/profile", label: "Cá nhân", icon: UserCircleIcon },
    ];
  }
  const items: NavLink[] = [
    { href: "/", label: "Tổng quan", icon: HomeIcon },
    { href: "/projects", label: "Dự án", icon: FolderIcon },
    { href: "/timesheet", label: "Nhân công", icon: TableCellsIcon },
    { href: "/attendance", label: "Chấm công", icon: ClockIcon },
    { href: "/attendance-machine", label: "Máy chấm công", icon: FingerPrintIcon },
    { href: "/leave", label: "Nghỉ phép", icon: CalendarDaysIcon },
    { href: "/evaluations", label: "Đánh giá nhân sự", icon: StarIcon },
    { href: "/employees", label: "Nhân sự", icon: UsersIcon },
    { href: "/colleagues", label: "Đồng nghiệp", icon: UserGroupIcon },
  ];
  return items;
}

export default function AppShell({
  children,
  maxWidthClass = "max-w-md lg:max-w-6xl",
}: {
  children: React.ReactNode;
  maxWidthClass?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(api.cachedUser());
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
        <div className="flex items-center justify-center px-5 py-5">
          <img src="/logo.png" alt="DOSCO" className="h-12 w-auto rounded-lg bg-white/95 px-3 py-1.5 object-contain" />
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

        {/* Menu dọc */}
        <nav className="mt-4 flex-1 space-y-1 overflow-y-auto px-3 pb-4">
          {deskNav(tier).map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.label}
                href={item.href}
                className={`flex items-center gap-3 rounded-xl2 px-3 py-2.5 text-sm transition-all duration-200 hover:translate-x-1.5 ${
                  active
                    ? "bg-gradient-to-r from-amber/95 to-amber-deep font-semibold text-white shadow-md shadow-amber/20"
                    : "text-white/70 hover:bg-white/5 hover:text-white"
                }`}
              >
                <item.icon className={`h-5 w-5 shrink-0 transition-transform duration-200 ${active ? "scale-110" : ""}`} />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Tài khoản — bấm vào ảnh + tên để xem thông tin cá nhân / đổi mật khẩu / đăng xuất */}
        <div className="border-t border-white/10 px-3 py-3">
          <AccountMenu user={user} onLogout={logout} variant="sidebar" />
        </div>
      </aside>

      {/* ====================== CỘT NỘI DUNG ====================== */}
      <div className="flex min-h-screen flex-1 flex-col lg:pl-64">
        {/* ---- Thanh tiêu đề (chỉ MOBILE) ---- */}
        <header className="sticky top-0 z-30 bg-ink text-white lg:hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2">
              <img src="/logo.png" alt="DOSCO" className="h-10 w-auto rounded-lg bg-white/95 px-3 py-1.5 object-contain" />
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
                      Đăng nhập: {user?.full_name} · {roleTitle(user?.role, user?.has_subordinates)}
                    </div>
                  </div>
                )}
              </div>
              <AccountMenu user={user} onLogout={logout} variant="header" />
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
          <div className={`mx-auto w-full ${maxWidthClass}`}>{children}</div>
        </motion.main>

        {/* ---- Thanh điều hướng dưới + FAB (chỉ MOBILE) ---- */}
        <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-md lg:hidden">
          <div className="relative mx-3 mb-3 flex items-center justify-around rounded-xl2 bg-white px-6 py-2 shadow-card">
            {tier === "STAFF" ? (
              <>
                <NavItem href="/" label="Trang chủ" icon={HomeIcon} active={pathname === "/"} />
                <NavItem href="/projects" label="Dự án" icon={FolderIcon} active={pathname.startsWith("/projects")} />
                <NavItem href="/attendance" label="Chấm công" icon={ClockIcon} active={pathname.startsWith("/attendance")} />
                <NavItem href="/profile" label="Cá nhân" icon={UserCircleIcon} active={pathname === "/profile"} />
              </>
            ) : (
              <>
                <NavItem href="/" label="Tổng quan" icon={HomeIcon} active={pathname === "/"} />
                <NavItem href="/projects" label="Dự án" icon={FolderIcon} active={pathname.startsWith("/projects")} />
                <NavItem href="/employees" label="Nhân sự" icon={UsersIcon} active={pathname.startsWith("/employees")} />
              </>
            )}
          </div>
        </nav>
      </div>

      <NotificationsBell />
      <ChatWidget />
      <DeadlineAlert user={user} />
      <EvaluationAlert user={user} />
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
      className={`flex flex-col items-center gap-0.5 transition-all duration-200 active:scale-95 ${
        active ? "text-amber scale-105 font-medium" : "text-muted hover:text-ink"
      }`}
    >
      <Icon className={`h-6 w-6 transition-transform duration-200 ${active ? "stroke-[2.5]" : ""}`} />
      <span className="text-[10px]">{label}</span>
    </Link>
  );
}
