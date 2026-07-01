"use client";

// Trang Tiến độ dự án (dạng bảng Excel to) cho Giám đốc:
// người thực hiện, quản lý, thời gian, % tiến độ (theo thời gian), còn lại/quá hạn, trạng thái.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PresentationChartLineIcon, XMarkIcon } from "@heroicons/react/24/outline";
import AppShell from "@/components/app-shell";
import { api } from "@/lib/api";
import { isDirector } from "@/lib/roles";
import type { Project, User } from "@/lib/types";

const STATUS: Record<string, { label: string; cls: string }> = {
  PLANNING: { label: "Chuẩn bị", cls: "bg-line text-muted" },
  ACTIVE: { label: "Đang thực hiện", cls: "bg-steel/10 text-steel" },
  ON_HOLD: { label: "Tạm dừng", cls: "bg-amber/20 text-amber-deep" },
  COMPLETED: { label: "Đã hoàn thành", cls: "bg-ok/15 text-ok" },
  CANCELLED: { label: "Đã hủy", cls: "bg-bad/15 text-bad" },
};

const DAY = 86_400_000;
const fmt = (s?: string | null) => (s ? new Date(s + "T00:00:00").toLocaleDateString("vi-VN") : "—");
const diffDays = (a?: string | null, b?: string | null) => {
  if (!a || !b) return null;
  return Math.round((new Date(a + "T00:00:00").getTime() - new Date(b + "T00:00:00").getTime()) / DAY);
};
const todayISO = () => new Date().toISOString().slice(0, 10);

export default function ProjectProgressPage() {
  const router = useRouter();
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    api.me()
      .then((u: User) => {
        if (!alive) return;
        if (!isDirector(u.role)) { setDenied(true); setLoading(false); return; }
        api.projects().then((d) => alive && setProjects(d)).catch(() => {}).finally(() => alive && setLoading(false));
        // Poll lại % tiến độ (BE tính) mỗi ~20s, không bật spinner để tránh nháy.
        timer = setInterval(() => {
          if (document.visibilityState === "visible") {
            api.projects().then((d) => alive && setProjects(d)).catch(() => {});
          }
        }, 20_000);
      })
      .catch(() => router.push("/login"));
    return () => { alive = false; if (timer) clearInterval(timer); };
  }, [router]);

  if (denied) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-paper p-4 text-center">
        <XMarkIcon className="h-16 w-16 text-bad" />
        <h1 className="mt-4 text-lg font-bold text-ink">Không có quyền truy cập</h1>
        <p className="mt-2 text-sm text-muted">Trang theo dõi tiến độ chỉ dành cho Ban Giám đốc.</p>
        <button onClick={() => router.push("/")} className="mt-4 rounded-xl2 bg-ink px-4 py-2 text-xs font-semibold text-white">Về trang chủ</button>
      </div>
    );
  }
  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-paper"><div className="h-8 w-8 animate-spin rounded-full border-4 border-steel border-t-amber" /></div>;
  }

  const TH = "border border-line px-3 py-2 font-semibold whitespace-nowrap text-left";
  const TD = "border border-line px-3 py-2 align-middle";

  return (
    <AppShell>
      <header className="flex items-center gap-2 rounded-xl2 bg-ink p-4 text-white shadow-card lg:p-6">
        <PresentationChartLineIcon className="h-5 w-5 text-amber lg:h-6 lg:w-6" />
        <h1 className="text-base font-bold lg:text-xl">Tiến độ dự án</h1>
      </header>

      <p className="mt-2 text-[11px] text-muted">
        Dòng <span className="font-semibold text-bad">đỏ</span> = đã quá hạn ·
        <span className="font-semibold text-amber-deep"> vàng</span> = còn ≤ 5 ngày.
      </p>

      <div className="mt-3 overflow-x-auto rounded-xl2 border border-line bg-white shadow-card">
        <table className="w-full min-w-[1040px] border-collapse text-sm">
          <thead>
            <tr className="bg-paper text-[11px] uppercase tracking-wide text-muted">
              <th className={`${TH} w-10 text-center`}>STT</th>
              <th className={TH}>Mã DA</th>
              <th className={TH}>Tên dự án</th>
              <th className={TH}>Quản lý</th>
              <th className={TH}>Người thực hiện</th>
              <th className={`${TH} text-center`}>Bắt đầu</th>
              <th className={`${TH} text-center`}>Hạn</th>
              <th className={`${TH} text-center`}>Thời gian</th>
              <th className={TH}>Tiến độ (thực tế)</th>
              <th className={`${TH} text-center`}>Còn lại</th>
              <th className={`${TH} text-center`}>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {projects.length === 0 && (
              <tr><td className={`${TD} text-center text-muted`} colSpan={11}>Chưa có dự án nào.</td></tr>
            )}
            {projects.map((p, i) => {
              const st = STATUS[p.status] ?? STATUS.PLANNING;
              const done = p.status === "COMPLETED";
              const total = diffDays(p.end_date, p.start_date);
              const left = diffDays(p.end_date, todayISO());
              // % TIẾN ĐỘ THỰC = trung bình % các mốc (BE tính, field progress_percent).
              // Dự án đã hoàn thành coi như 100% dù chưa nhập đủ mốc.
              const realPct = Math.max(0, Math.min(100, Math.round(Number(p.progress_percent ?? 0))));
              const pct = done ? 100 : realPct;
              const overdue = !done && left != null && left < 0;
              const soon = !done && left != null && left >= 0 && left <= 5;
              const rowCls = overdue ? "bg-bad/5" : soon ? "bg-amber/10" : i % 2 ? "bg-paper/40" : "bg-white";
              const members = (p.members || []).map((m) => m.full_name).join(", ");
              return (
                <tr key={p.id} className={rowCls}>
                  <td className={`${TD} text-center text-muted tnum`}>{i + 1}</td>
                  <td className={`${TD} font-mono text-[12px] text-steel whitespace-nowrap`}>{p.code}</td>
                  <td className={`${TD} font-semibold text-ink`}>{p.name}</td>
                  <td className={`${TD} whitespace-nowrap text-muted`}>{p.manager_name || "—"}</td>
                  <td className={`${TD} text-xs text-muted`}>{members || "—"}</td>
                  <td className={`${TD} text-center whitespace-nowrap text-xs`}>{fmt(p.start_date)}</td>
                  <td className={`${TD} text-center whitespace-nowrap text-xs font-semibold`}>{fmt(p.end_date)}</td>
                  <td className={`${TD} text-center whitespace-nowrap tnum`}>{total != null ? `${total} ngày` : "—"}</td>
                  <td className={TD}>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                        <div className={`h-full ${done ? "bg-ok" : overdue ? "bg-bad" : "bg-steel"}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-9 shrink-0 text-right text-[11px] tnum text-muted">{pct}%</span>
                    </div>
                  </td>
                  <td className={`${TD} text-center whitespace-nowrap tnum text-xs font-bold ${overdue ? "text-bad" : soon ? "text-amber-deep" : "text-ink"}`}>
                    {done ? "—" : left == null ? "—" : left < 0 ? `Quá ${-left}n` : left === 0 ? "Hôm nay" : `Còn ${left}n`}
                  </td>
                  <td className={`${TD} text-center`}>
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${st.cls}`}>{st.label}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
