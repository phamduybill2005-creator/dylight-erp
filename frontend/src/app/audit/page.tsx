"use client";

// Trang Nhật ký hoạt động (audit) — vết hành động hệ thống.
// NHẠY CẢM: chỉ Giám đốc (isDirector). Vai trò khác bị chặn.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheckIcon, XMarkIcon } from "@heroicons/react/24/outline";
import AppShell from "@/components/app-shell";
import { api } from "@/lib/api";
import { isDirector } from "@/lib/roles";
import type { ActivityLog, User } from "@/lib/types";

export default function AuditPage() {
  const router = useRouter();
  const [me, setMe] = useState<User | null>(api.cachedUser());
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<ActivityLog[]>([]);

  useEffect(() => {
    api.me()
      .then((u) => {
        setMe(u);
        if (!isDirector(u.role)) { setDenied(true); setLoading(false); return; }
        api.auditLogs().then(setLogs).catch(() => {}).finally(() => setLoading(false));
      })
      .catch(() => router.push("/login"));
  }, [router]);

  if (denied) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-paper p-4 text-center">
        <XMarkIcon className="h-16 w-16 text-bad" />
        <h1 className="mt-4 text-lg font-bold text-ink">Không có quyền truy cập</h1>
        <p className="mt-2 max-w-xs text-sm text-muted">Nhật ký hoạt động chỉ dành cho Ban Giám đốc.</p>
        <button onClick={() => router.push("/")} className="mt-4 rounded-xl2 bg-ink px-4 py-2 text-xs font-semibold text-white">Về trang chủ</button>
      </div>
    );
  }
  if (loading || !me) {
    return <AppShell><div className="flex min-h-[70vh] items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-steel border-t-amber" /></div></AppShell>;
  }

  return (
    <AppShell>
      <header className="flex items-center gap-2 rounded-xl2 bg-ink p-4 lg:p-6 text-white shadow-card">
        <ShieldCheckIcon className="h-5 w-5 text-amber" />
        <h1 className="text-base lg:text-xl font-bold">Nhật ký hoạt động</h1>
      </header>

      {/* Bảng nhật ký — mới nhất ở trên (API đã sắp sẵn) */}
      <div className="mt-4 overflow-x-auto rounded-xl2 border border-line bg-white shadow-card">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="bg-paper text-left text-[11px] uppercase tracking-wide text-muted">
              <th className="border border-line px-3 py-2">Thời gian</th>
              <th className="border border-line px-3 py-2">Người dùng</th>
              <th className="border border-line px-3 py-2">Hành động</th>
              <th className="border border-line px-3 py-2">Đối tượng</th>
              <th className="border border-line px-3 py-2">Chi tiết</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && (
              <tr><td colSpan={5} className="border border-line px-3 py-6 text-center text-muted">Chưa có hoạt động nào.</td></tr>
            )}
            {logs.map((l) => (
              <tr key={l.id} className="odd:bg-white even:bg-paper/40 hover:bg-amber/10">
                <td className="border border-line px-3 py-2 whitespace-nowrap text-muted">{new Date(l.created_at).toLocaleString("vi-VN")}</td>
                <td className="border border-line px-3 py-2 font-semibold text-ink">{l.user_name || "—"}</td>
                <td className="border border-line px-3 py-2 font-mono text-[12px] text-steel">{l.action}</td>
                <td className="border border-line px-3 py-2 text-muted whitespace-nowrap">
                  {l.entity_type ? `${l.entity_type}${l.entity_id ? ` #${l.entity_id}` : ""}` : "—"}
                </td>
                <td className="border border-line px-3 py-2 text-muted">{l.detail || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
