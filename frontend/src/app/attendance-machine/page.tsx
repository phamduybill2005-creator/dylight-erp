"use client";

// Trang "Máy chấm công" — cổng tích hợp hệ thống chấm công khuôn mặt (Yunatt) vào ERP:
//  - Mở thẳng cổng Yunatt từ trong web công ty.
//  - Lối tắt nhập dữ liệu chấm công vào ERP (từ file CSV xuất ở Yunatt).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  FingerPrintIcon,
  ArrowTopRightOnSquareIcon,
  ArrowUpTrayIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";
import AppShell from "@/components/app-shell";
import { api } from "@/lib/api";
import { roleTier } from "@/lib/roles";
import type { User } from "@/lib/types";

const YUNATT_URL = "https://global.yunatt.com";

export default function AttendanceMachinePage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    api.me().then(setUser).catch(() => router.push("/login"));
  }, [router]);

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-steel border-t-amber" />
      </div>
    );
  }

  const isStaff = roleTier(user.role) === "STAFF";

  return (
    <AppShell>
      <header className="flex items-center gap-2 rounded-xl2 bg-ink p-4 text-white shadow-card lg:p-6">
        <FingerPrintIcon className="h-5 w-5 text-amber lg:h-6 lg:w-6" />
        <h1 className="text-base font-bold lg:text-xl">Máy chấm công</h1>
      </header>

      {/* Cổng tới hệ thống Yunatt */}
      <section className="mt-4 rounded-xl2 bg-white p-5 shadow-card lg:p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl2 bg-steel/10 text-steel">
            <FingerPrintIcon className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-ink lg:text-base">Hệ thống chấm công khuôn mặt (Yunatt)</h2>
            <p className="mt-1 text-xs text-muted">
              Thiết bị <b className="text-ink">DOSCO</b> · nhận diện khuôn mặt AI. Quản lý nhân viên, khuôn mặt và xem
              dữ liệu quẹt trên cổng Yunatt. <span className="text-muted">(Đăng nhập riêng bằng tài khoản Yunatt.)</span>
            </p>
          </div>
        </div>
        <a
          href={YUNATT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-2 rounded-xl2 bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:bg-steel"
        >
          <ArrowTopRightOnSquareIcon className="h-5 w-5" /> Mở hệ thống chấm công Yunatt
        </a>
      </section>

      {/* Nhập dữ liệu vào ERP */}
      {!isStaff && (
        <section className="mt-4 rounded-xl2 bg-white p-5 shadow-card lg:p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl2 bg-amber/15 text-amber-deep">
              <ArrowUpTrayIcon className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-ink lg:text-base">Đưa dữ liệu chấm công vào ERP</h2>
              <p className="mt-1 text-xs text-muted">
                Trên Yunatt vào <b className="text-ink">Quản lý điểm danh</b> → xuất Excel/CSV → tải lên ERP. Hệ thống tự
                ghép theo CCCD/mã nhân viên và tính ngày công, giờ làm.
              </p>
            </div>
          </div>
          <Link
            href="/attendance"
            className="mt-4 inline-flex items-center gap-2 rounded-xl2 bg-amber px-4 py-2.5 text-sm font-semibold text-ink hover:opacity-90"
          >
            <ArrowUpTrayIcon className="h-5 w-5" /> Nhập chấm công từ file
          </Link>
        </section>
      )}

      {/* Ghi chú tự động hoá */}
      {!isStaff && (
        <section className="mt-4 flex items-start gap-2 rounded-xl2 border border-line bg-white p-4 text-[11px] text-muted shadow-card">
          <InformationCircleIcon className="h-4 w-4 shrink-0 text-steel" />
          <p>
            Đồng bộ <b className="text-ink">tự động (realtime)</b> cần API của Yunatt hoặc cho máy đẩy thẳng về ERP — đang
            chờ Yunatt cấp API/cho đổi địa chỉ máy chủ. Khi có, dữ liệu sẽ tự chảy vào, không cần xuất file.
          </p>
        </section>
      )}
    </AppShell>
  );
}
