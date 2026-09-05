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
  ClockIcon,
  FingerPrintIcon,
  UsersIcon,
  UserGroupIcon,
  StarIcon,
  CalendarDaysIcon,
  CalendarIcon,
  TableCellsIcon,
  BanknotesIcon,
} from "@heroicons/react/24/outline";
import { api, tokenStore } from "@/lib/api";
import { roleTier, canSeeRevenue } from "@/lib/roles";
import type { User } from "@/lib/types";
import NotificationsBell from "./notifications-bell";
import ChatWidget from "./chat-widget";
import AccountMenu from "./account-menu";
import DeadlineAlert from "./deadline-alert";
import EvaluationAlert from "./evaluation-alert";

type IconType = React.ComponentType<{ className?: string }>;
type NavLink = { href: string; label: string; icon: IconType };

// Menu đầy đủ cho sidebar desktop (mobile dùng bản rút gọn 4 mục bên dưới).
function deskNav(user: User | null): NavLink[] {
  const tier = roleTier(user?.role);
  const showRevenue = canSeeRevenue(user);   // lãnh đạo + danh sách chỉ định (lib/roles)

  if (tier === "STAFF") {
    const items: NavLink[] = [
      { href: "/", label: "Trang chủ", icon: HomeIcon },
      { href: "/projects", label: "Dự án", icon: FolderIcon },
      { href: "/timesheet", label: "Tiến độ", icon: TableCellsIcon },
    ];
    if (showRevenue) {
      items.push({ href: "/revenue", label: "Doanh thu", icon: BanknotesIcon });
    }
    items.push(
      { href: "/work-schedule", label: "Lịch làm việc", icon: CalendarIcon },
      { href: "/attendance", label: "Tổng hợp", icon: ClockIcon },
      { href: "/leave", label: "Nghỉ phép", icon: CalendarDaysIcon },
      { href: "/evaluations", label: "Đánh giá", icon: StarIcon },
      { href: "/colleagues", label: "Đồng nghiệp", icon: UserGroupIcon },
      { href: "/profile", label: "Cá nhân", icon: UserCircleIcon },
    );
    return items;
  }

  const items: NavLink[] = [
    { href: "/", label: "Tổng quan", icon: HomeIcon },
    { href: "/projects", label: "Dự án", icon: FolderIcon },
    { href: "/timesheet", label: "Tiến độ", icon: TableCellsIcon },
  ];
  if (showRevenue) {
    items.push({ href: "/revenue", label: "Doanh thu", icon: BanknotesIcon });
  }
  items.push(
    { href: "/work-schedule", label: "Lịch làm việc", icon: CalendarIcon },
    { href: "/attendance", label: "Tổng hợp", icon: ClockIcon },
    { href: "/attendance-machine", label: "Máy chấm công", icon: FingerPrintIcon },
    { href: "/leave", label: "Nghỉ phép", icon: CalendarDaysIcon },
    { href: "/evaluations", label: "Đánh giá", icon: StarIcon },
    { href: "/employees", label: "Profile", icon: UsersIcon },
    { href: "/colleagues", label: "Đồng nghiệp", icon: UserGroupIcon },
  );
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
  const tier = roleTier(user?.role);

  useEffect(() => {
    if (!tokenStore.get()) {
      router.replace("/login");
      return;
    }
    api.me().then(setUser).catch(() => router.replace("/login"));
  }, [router]);

  function logout() {
    tokenStore.clear();
    router.replace("/login");
  }

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href.split("?")[0]);

  return (
    <div className="min-h-screen bg-paper flex flex-col">
      {/* ====================== TOP NAVBAR (DESKTOP & MOBILE) ====================== */}
      <header className="sticky top-0 z-40 bg-ink text-white shadow-md border-b border-white/10">
        <div className="flex h-14 items-center justify-between px-3 lg:px-6 gap-2 lg:gap-4">
          
          {/* LEFT: Logo */}
          <div className="flex items-center gap-3 shrink-0">
            <Link href="/" className="flex items-center">
              <img src="/logo.png" alt="DOSCO" className="h-9 w-auto rounded-lg bg-white/95 px-2.5 py-1 object-contain" />
            </Link>
          </div>

          {/* MIDDLE: Horizontal Nav Items (DESKTOP) */}
          <nav className="hidden lg:flex items-center gap-1 flex-1 justify-center overflow-x-auto no-scrollbar py-1">
            {deskNav(user).map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-all duration-150 ${
                    active
                      ? "bg-gradient-to-r from-amber to-amber-deep text-white shadow-sm shadow-amber/30 scale-105"
                      : "text-white/75 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  <item.icon className={`h-4 w-4 shrink-0 ${active ? "text-white" : "text-white/70"}`} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* RIGHT: User Account Menu & Action Buttons */}
          <div className="flex items-center gap-2 shrink-0">
            <AccountMenu user={user} onLogout={logout} variant="topbar" />
          </div>
        </div>
      </header>

      {/* ====================== MAIN CONTENT AREA ====================== */}
      <motion.main
        key={pathname}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="flex-1 w-full px-3 sm:px-4 lg:px-6 pb-24 lg:pb-8 pt-4"
      >
        <div className={`mx-auto w-full ${maxWidthClass}`}>{children}</div>
      </motion.main>

      {/* ====================== MOBILE BOTTOM NAV ====================== */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-md lg:hidden">
        <div className="relative mx-3 mb-3 flex items-center justify-around rounded-xl2 bg-white px-6 py-2 shadow-card border border-line">
          {tier === "STAFF" ? (
            <>
              <NavItem href="/" label="Trang chủ" icon={HomeIcon} active={pathname === "/"} />
              <NavItem href="/projects" label="Dự án" icon={FolderIcon} active={pathname.startsWith("/projects")} />
              <NavItem href="/attendance" label="Tổng hợp" icon={ClockIcon} active={pathname.startsWith("/attendance")} />
              <NavItem href="/profile" label="Cá nhân" icon={UserCircleIcon} active={pathname === "/profile"} />
            </>
          ) : (
            <>
              <NavItem href="/" label="Tổng quan" icon={HomeIcon} active={pathname === "/"} />
              <NavItem href="/projects" label="Dự án" icon={FolderIcon} active={pathname.startsWith("/projects")} />
              <NavItem href="/employees" label="Profile" icon={UsersIcon} active={pathname.startsWith("/employees")} />
            </>
          )}
        </div>
      </nav>

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
