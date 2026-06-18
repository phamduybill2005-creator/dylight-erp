"use client";

// Menu tài khoản: bấm vào ảnh + tên (góc trái sidebar / góc phải header mobile)
// để xem nhanh thông tin cá nhân + tài khoản, vào Trang cá nhân/đổi mật khẩu, đăng xuất.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  UserCircleIcon,
  ArrowRightOnRectangleIcon,
  IdentificationIcon,
  PhoneIcon,
  CalendarDaysIcon,
  BuildingOffice2Icon,
  UserGroupIcon,
  Cog6ToothIcon,
  ChevronUpDownIcon,
  EnvelopeIcon,
} from "@heroicons/react/24/outline";
import { ROLE_LABEL } from "@/lib/roles";
import type { User } from "@/lib/types";

type IconType = React.ComponentType<{ className?: string }>;

function Row({ icon: Icon, label, value }: { icon: IconType; label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-2.5 px-4 py-1.5">
      <Icon className="h-4 w-4 shrink-0 text-muted" />
      <div className="min-w-0">
        <p className="text-[10px] leading-none text-muted">{label}</p>
        <p className="mt-0.5 truncate text-xs font-semibold text-ink">{value}</p>
      </div>
    </div>
  );
}

export default function AccountMenu({
  user,
  onLogout,
  variant,
}: {
  user: User | null;
  onLogout: () => void;
  variant: "sidebar" | "header";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const role = user?.role ? ROLE_LABEL[user.role] : "";

  const panel = (
    <div
      className={`absolute z-50 w-72 overflow-hidden rounded-xl2 bg-white text-ink shadow-card ${
        variant === "sidebar" ? "bottom-full left-0 mb-2" : "right-0 top-full mt-2"
      }`}
    >
      <div className="flex items-center gap-3 bg-ink px-4 py-3 text-white">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber text-ink">
          <UserCircleIcon className="h-7 w-7" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold">{user?.full_name ?? "—"}</p>
          <p className="truncate text-[10px] font-semibold text-amber">{role}</p>
        </div>
      </div>

      <div className="py-1">
        <Row icon={EnvelopeIcon} label="Email đăng nhập" value={user?.email} />
        <Row icon={PhoneIcon} label="Số điện thoại" value={user?.phone} />
        <Row icon={IdentificationIcon} label="CCCD / Hộ chiếu" value={user?.identity_card} />
        <Row
          icon={CalendarDaysIcon}
          label="Ngày sinh"
          value={user?.dob ? new Date(user.dob).toLocaleDateString("vi-VN") : null}
        />
        <Row icon={BuildingOffice2Icon} label="Bộ phận / Phòng ban" value={user?.department} />
        <Row icon={UserGroupIcon} label="Người quản lý" value={user?.manager_name} />
      </div>

      <div className="border-t border-line p-2">
        <Link
          href="/profile"
          onClick={() => setOpen(false)}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-ink hover:bg-paper"
        >
          <Cog6ToothIcon className="h-4 w-4 text-steel" /> Trang cá nhân & đổi mật khẩu
        </Link>
        <button
          onClick={() => { setOpen(false); onLogout(); }}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-bad hover:bg-bad/5"
        >
          <ArrowRightOnRectangleIcon className="h-4 w-4" /> Đăng xuất
        </button>
      </div>
    </div>
  );

  if (variant === "header") {
    return (
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="Tài khoản"
          className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-amber text-ink"
        >
          <UserCircleIcon className="h-5 w-5" />
        </button>
        {open && panel}
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-xl2 px-2 py-2 text-left hover:bg-white/10"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber text-ink">
          <UserCircleIcon className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-white">{user?.full_name ?? "—"}</p>
          <p className="truncate text-[10px] text-white/50">{role}</p>
        </div>
        <ChevronUpDownIcon className="h-4 w-4 shrink-0 text-white/40" />
      </button>
      {open && panel}
    </div>
  );
}
