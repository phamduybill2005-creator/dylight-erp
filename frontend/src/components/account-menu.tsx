"use client";

// Menu tài khoản: bấm vào ảnh + tên (góc trái sidebar / góc phải header mobile)
// để xem ĐẦY ĐỦ thông tin cá nhân + tài khoản và ĐỔI MẬT KHẨU ngay tại chỗ.
// Dùng chung cho mọi vai trò (Giám đốc / Quản lý / Nhân viên).

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  UserCircleIcon,
  ArrowRightOnRectangleIcon,
  IdentificationIcon,
  PhoneIcon,
  CalendarDaysIcon,
  MapPinIcon,
  BuildingOffice2Icon,
  UserGroupIcon,
  AcademicCapIcon,
  KeyIcon,
  ChevronUpDownIcon,
  ChevronDownIcon,
  EnvelopeIcon,
} from "@heroicons/react/24/outline";
import { api } from "@/lib/api";
import { ROLE_LABEL } from "@/lib/roles";
import type { User } from "@/lib/types";

type IconType = React.ComponentType<{ className?: string }>;

function Row({ icon: Icon, label, value }: { icon: IconType; label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2.5 px-4 py-1.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
      <div className="min-w-0">
        <p className="text-[10px] leading-none text-muted">{label}</p>
        <p className="mt-0.5 break-words text-xs font-semibold text-ink">{value}</p>
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

  // Đổi mật khẩu ngay trong menu.
  const [showPw, setShowPw] = useState(false);
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwMsg, setPwMsg] = useState("");
  const [pwErr, setPwErr] = useState(false);
  const [changing, setChanging] = useState(false);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  async function changePassword() {
    if (newPw.length < 6) {
      setPwErr(true);
      setPwMsg("Mật khẩu mới tối thiểu 6 ký tự.");
      return;
    }
    setChanging(true);
    setPwMsg("");
    setPwErr(false);
    try {
      await api.changePassword(oldPw, newPw);
      setPwErr(false);
      setPwMsg("Đổi mật khẩu thành công.");
      setOldPw("");
      setNewPw("");
    } catch (e: unknown) {
      setPwErr(true);
      setPwMsg(e instanceof Error ? e.message : "Không đổi được mật khẩu.");
    } finally {
      setChanging(false);
    }
  }

  const role = user?.role ? ROLE_LABEL[user.role] : "";

  const panel = (
    <div
      className={`absolute z-50 flex max-h-[85vh] w-72 flex-col overflow-hidden rounded-xl2 bg-white text-ink shadow-card ${
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

      <div className="flex-1 overflow-y-auto">
        <div className="py-1">
          <p className="px-4 pb-0.5 pt-2 text-[10px] font-bold uppercase tracking-wider text-muted">Thông tin cá nhân</p>
          <Row icon={EnvelopeIcon} label="Email đăng nhập" value={user?.email} />
          <Row icon={PhoneIcon} label="Số điện thoại" value={user?.phone} />
          <Row icon={IdentificationIcon} label="CCCD / Hộ chiếu" value={user?.identity_card} />
          <Row
            icon={CalendarDaysIcon}
            label="Ngày sinh"
            value={user?.dob ? new Date(user.dob).toLocaleDateString("vi-VN") : null}
          />
          <Row icon={MapPinIcon} label="Địa chỉ thường trú" value={user?.address} />
          <Row icon={BuildingOffice2Icon} label="Bộ phận / Phòng ban" value={user?.department} />
          <Row icon={UserGroupIcon} label="Người quản lý" value={user?.manager_name} />
        </div>

        {/* Đổi mật khẩu ngay tại đây */}
        <div className="border-t border-line">
          <button
            onClick={() => { setShowPw((v) => !v); setPwMsg(""); }}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-xs font-semibold text-ink hover:bg-paper"
          >
            <KeyIcon className="h-4 w-4 text-steel" />
            Đổi mật khẩu
            <ChevronDownIcon className={`ml-auto h-4 w-4 text-muted transition-transform ${showPw ? "rotate-180" : ""}`} />
          </button>
          {showPw && (
            <div className="space-y-2 px-4 pb-3">
              <input
                type="password"
                value={oldPw}
                onChange={(e) => setOldPw(e.target.value)}
                placeholder="Mật khẩu hiện tại"
                className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
              />
              <input
                type="password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                placeholder="Mật khẩu mới (≥6 ký tự)"
                className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
              />
              {pwMsg && <p className={`text-[11px] font-semibold ${pwErr ? "text-bad" : "text-ok"}`}>{pwMsg}</p>}
              <button
                onClick={changePassword}
                disabled={changing || !oldPw || !newPw}
                className="w-full rounded-xl2 bg-ink py-2 text-xs font-semibold text-white hover:bg-steel disabled:opacity-50"
              >
                {changing ? "Đang đổi…" : "Cập nhật mật khẩu"}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-line p-2">
        <Link
          href="/profile"
          onClick={() => setOpen(false)}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-ink hover:bg-paper"
        >
          <AcademicCapIcon className="h-4 w-4 text-steel" /> Hồ sơ đầy đủ (sơ yếu lý lịch)
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
