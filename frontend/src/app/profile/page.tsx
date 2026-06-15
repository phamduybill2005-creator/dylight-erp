"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  UserIcon,
  PhoneIcon,
  IdentificationIcon,
  CalendarDaysIcon,
  MapPinIcon,
  AcademicCapIcon,
  BriefcaseIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";
import AppShell from "@/components/app-shell";
import { api } from "@/lib/api";
import { ROLE_LABEL } from "@/lib/roles";
import type { User } from "@/lib/types";

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.me()
      .then((u) => {
        setUser(u);
        setLoading(false);
      })
      .catch(() => {
        router.push("/login");
      });
  }, [router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-steel border-t-amber" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper p-4 text-center">
        <p className="text-sm text-bad">Không tìm thấy thông tin phiên đăng nhập.</p>
      </div>
    );
  }

  return (
    <AppShell>
      {/* Hồ sơ cá nhân Header */}
      <div className="space-y-5 lg:space-y-6">
        <section className="flex flex-col items-center rounded-xl2 bg-gradient-to-br from-ink to-steel p-6 text-white shadow-card lg:p-8">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-amber text-ink shadow-fab ring-4 ring-white/10 lg:h-24 lg:w-24">
            <UserIcon className="h-10 w-10 lg:h-12 lg:w-12" />
          </div>
          <h1 className="mt-4 text-xl font-bold lg:text-2xl">{user.full_name}</h1>
          <p className="text-xs text-white/60 font-mono mt-1">{user.email}</p>
          <span className="mt-3 inline-block rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-amber">
            {ROLE_LABEL[user.role] || user.role}
          </span>
        </section>

        {/* Thông tin cơ bản */}
        <section className="rounded-xl2 bg-white p-5 shadow-card space-y-4 lg:p-6">
          <h2 className="text-sm font-bold text-ink border-b border-line pb-2 flex items-center gap-2">
            <IdentificationIcon className="h-5 w-5 text-steel" />
            Thông tin cá nhân
          </h2>

          <div className="grid gap-3.5 text-sm lg:grid-cols-2 lg:gap-x-6 lg:gap-y-4">
            <div className="flex items-center gap-3">
              <PhoneIcon className="h-4 w-4 text-muted shrink-0" />
              <div>
                <p className="text-[11px] text-muted leading-none">Số điện thoại</p>
                <p className="mt-1 font-semibold text-ink">{user.phone || "—"}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <IdentificationIcon className="h-4 w-4 text-muted shrink-0" />
              <div>
                <p className="text-[11px] text-muted leading-none">Số CCCD / Hộ chiếu</p>
                <p className="mt-1 font-semibold text-ink">{user.identity_card || "—"}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <CalendarDaysIcon className="h-4 w-4 text-muted shrink-0" />
              <div>
                <p className="text-[11px] text-muted leading-none">Ngày sinh</p>
                <p className="mt-1 font-semibold text-ink">
                  {user.dob ? new Date(user.dob).toLocaleDateString("vi-VN") : "—"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <MapPinIcon className="h-4 w-4 text-muted shrink-0" />
              <div>
                <p className="text-[11px] text-muted leading-none">Địa chỉ thường trú</p>
                <p className="mt-1 font-medium text-ink">{user.address || "—"}</p>
              </div>
            </div>

            <div className="flex items-center gap-3 border-t border-line/60 pt-3 lg:col-span-2">
              <UserGroupIcon className="h-4 w-4 text-muted shrink-0" />
              <div>
                <p className="text-[11px] text-muted leading-none">Người quản lý trực tiếp</p>
                <p className="mt-1 font-bold text-steel">
                  {user.manager_name || "Chưa phân công"}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Sơ yếu lý lịch (CV) */}
        <section className="rounded-xl2 bg-white p-5 shadow-card space-y-4 lg:p-6">
          <h2 className="text-sm font-bold text-ink border-b border-line pb-2 flex items-center gap-2">
            <AcademicCapIcon className="h-5 w-5 text-steel" />
            Sơ yếu lý lịch & Kinh nghiệm
          </h2>
          {user.cv_details ? (
            <div className="whitespace-pre-line text-sm text-ink leading-relaxed font-medium">
              {user.cv_details}
            </div>
          ) : (
            <p className="text-center text-xs text-muted py-4">
              Chưa cập nhật thông tin sơ yếu lý lịch.
            </p>
          )}
        </section>
      </div>
    </AppShell>
  );
}
