"use client";

// Khung giao diện RESPONSIVE — dùng được cả trên điện thoại và máy tính (PC/web).
//  - Desktop (lg+): thanh tiêu đề với menu ngang đầy đủ.
//  - Điện thoại (< lg): CÙNG menu đầy đủ đó, xếp thành dải cuộn ngang ngay dưới tiêu đề
//    (mục đang mở tự cuộn vào giữa). Không còn thanh 3-4 mục dưới đáy như trước.
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
  EyeIcon,
  Squares2X2Icon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { api, previewRole, tokenStore } from "@/lib/api";
import { roleTier, canSeeRevenue, ROLE_LABEL } from "@/lib/roles";
import type { Role, User } from "@/lib/types";
import NotificationsBell from "./notifications-bell";
import ChatWidget from "./chat-widget";
import AccountMenu from "./account-menu";
import DeadlineAlert from "./deadline-alert";
import EvaluationAlert from "./evaluation-alert";
import { buildMobileNavigation } from "@/lib/mobile-navigation";

type IconType = React.ComponentType<{ className?: string }>;
type NavLink = { href: string; label: string; icon: IconType };

// Menu đầy đủ — dùng CHUNG cho máy tính và điện thoại.
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
      { href: "/attendance", label: "Chấm công", icon: ClockIcon },
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
    { href: "/attendance", label: "Chấm công", icon: ClockIcon },
    { href: "/attendance-machine", label: "Máy chấm công", icon: FingerPrintIcon },
    { href: "/leave", label: "Nghỉ phép", icon: CalendarDaysIcon },
    { href: "/evaluations", label: "Đánh giá", icon: StarIcon },
    { href: "/employees", label: "Nhân sự", icon: UsersIcon },
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
  const [moreOpen, setMoreOpen] = useState(false);
  const tier = roleTier(user?.role);
  // Đang XEM GIAO DIỆN với vai trò khác? Đọc sau khi mount (sessionStorage không có khi render phía máy chủ).
  const [previewing, setPreviewing] = useState<Role | null>(null);
  useEffect(() => { setPreviewing(previewRole.get()); }, []);

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

  function exitPreview() {
    previewRole.set(null);
    window.location.reload();
  }

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href.split("?")[0]);

  useEffect(() => setMoreOpen(false), [pathname]);

  const mobileNavigation = buildMobileNavigation(deskNav(user), pathname);

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
                      ? "bg-gradient-to-r from-amber to-amber-deep text-white shadow-sm shadow-amber/30 ring-1 ring-inset ring-amber/40"
                      : "text-white/75 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  <item.icon className={`h-4 w-4 shrink-0 ${active ? "text-white" : "text-white/70"}`} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* RIGHT: Tin nhắn + Thông báo + Tài khoản. Điện thoại: 2 nút nằm ngay trên thanh này
              (theo thiết kế mobile, không nổi che dữ liệu); máy tính: 2 nút tự thành nút NỔI
              góc dưới-phải như trước (lg:fixed đặt trong từng component). */}
          <div className="flex items-center gap-1 shrink-0">
            <ChatWidget />
            <NotificationsBell />
            <AccountMenu user={user} onLogout={logout} variant="topbar" />
          </div>
        </div>
      </header>

      {/* Thanh báo: Giám đốc / Quản trị đang XEM GIAO DIỆN với vai trò khác (chỉ đổi giao diện) */}
      {previewing && (
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-amber/40 bg-amber/15 px-3 py-1.5 text-center text-[11px] font-semibold text-amber-deep">
          <EyeIcon className="h-4 w-4 shrink-0" />
          <span>
            Đang xem giao diện với vai trò <b className="text-ink">{ROLE_LABEL[previewing]}</b> — mọi thao tác vẫn thực hiện bằng tài khoản thật
            {api.realUser()?.full_name ? ` (${api.realUser()!.full_name})` : ""}.
          </span>
          <button
            type="button"
            onClick={exitPreview}
            className="rounded-full border border-amber-deep/40 bg-white px-2.5 py-0.5 text-[11px] font-bold text-amber-deep hover:bg-amber/20"
          >
            Thoát chế độ xem
          </button>
        </div>
      )}

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

      <nav aria-label="Điều hướng chính" className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-1 pb-[max(0.35rem,env(safe-area-inset-bottom))] pt-1 shadow-[0_-8px_24px_rgba(15,23,42,0.10)] backdrop-blur lg:hidden">
        <div className="mx-auto grid max-w-md grid-cols-5">
          {mobileNavigation.primary.map((item) => {
            const active = isActive(item.href);
            return (
              <Link key={item.href} href={item.href} className={`flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-[10px] font-semibold ${active ? "text-steel" : "text-slate-500"}`}>
                <item.icon className={`h-5 w-5 ${active ? "text-amber-deep" : "text-slate-500"}`} />
                <span className="max-w-full truncate">{item.href === "/work-schedule" ? "Lịch" : item.label}</span>
              </Link>
            );
          })}
          <button type="button" onClick={() => setMoreOpen(true)} className={`flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-[10px] font-semibold ${mobileNavigation.moreActive ? "text-steel" : "text-slate-500"}`} aria-expanded={moreOpen}>
            <Squares2X2Icon className={`h-5 w-5 ${mobileNavigation.moreActive ? "text-amber-deep" : "text-slate-500"}`} />
            <span>Thêm</span>
          </button>
        </div>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-ink/45 lg:hidden" onClick={() => setMoreOpen(false)}>
          <section className="w-full rounded-t-3xl bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 shadow-2xl" onClick={(event) => event.stopPropagation()} aria-label="Các chức năng khác">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-bold text-ink">Các chức năng khác</h2>
              <button type="button" onClick={() => setMoreOpen(false)} className="flex h-11 w-11 items-center justify-center rounded-full bg-paper text-muted" aria-label="Đóng menu">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {mobileNavigation.secondary.map((item) => {
                const active = isActive(item.href);
                return (
                  <Link key={item.href} href={item.href} className={`flex min-h-20 flex-col items-center justify-center gap-2 rounded-xl border px-2 py-3 text-center text-xs font-semibold ${active ? "border-amber bg-amber/10 text-ink" : "border-line bg-paper text-slate-600"}`}>
                    <item.icon className={`h-6 w-6 ${active ? "text-amber-deep" : "text-steel"}`} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </section>
        </div>
      )}

      <DeadlineAlert user={user} />
      <EvaluationAlert user={user} />
    </div>
  );
}
