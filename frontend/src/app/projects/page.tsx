"use client";

// Trang Dự án & Hợp đồng. Liệt kê dự án kèm trạng thái và số liệu tài chính
// (ghép với báo cáo lãi/lỗ theo dự án từ backend).

import { useEffect, useState } from "react";
import Link from "next/link";
import { MapPinIcon, UserIcon } from "@heroicons/react/24/outline";
import AppShell from "@/components/app-shell";
import { api } from "@/lib/api";
import { isDirector } from "@/lib/roles";
import { formatCompactVND } from "@/lib/format";
import type { Project, ProjectProfit } from "@/lib/types";

const PROJECT_STATUS: Record<string, { label: string; cls: string }> = {
  PLANNING: { label: "Chuẩn bị", cls: "bg-line text-muted" },
  ACTIVE: { label: "Đang thi công", cls: "bg-steel/10 text-steel" },
  ON_HOLD: { label: "Tạm dừng", cls: "bg-amber/20 text-amber-deep" },
  COMPLETED: { label: "Hoàn thành", cls: "bg-ok/15 text-ok" },
  CANCELLED: { label: "Đã hủy", cls: "bg-bad/15 text-bad" },
};

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [profit, setProfit] = useState<Record<number, ProjectProfit>>({});

  useEffect(() => {
    api.projects().then(setProjects).catch(() => {});
    // Số liệu lãi/lỗ theo dự án chỉ dành cho Giám đốc — Quản lý sẽ không tải (tránh 403).
    api.me()
      .then((me) => {
        if (!isDirector(me.role)) return;
        api
          .profitByProject()
          .then((rows) =>
            setProfit(Object.fromEntries(rows.map((r) => [r.project_id, r])))
          )
          .catch(() => {});
      })
      .catch(() => {});
  }, []);

  return (
    <AppShell>
      <h1 className="text-lg font-semibold text-ink lg:text-2xl">Dự án & Hợp đồng</h1>
      <p className="mt-0.5 text-xs text-muted lg:text-sm">
        Theo dõi vòng đời dự án từ đấu thầu tới quyết toán.
      </p>

      <div className="mt-4 space-y-3 lg:space-y-0 lg:grid lg:grid-cols-2 lg:gap-4 xl:grid-cols-3">
        {projects.length === 0 && (
          <p className="rounded-xl2 bg-white p-4 text-center text-xs text-muted shadow-card lg:col-span-full">
            Chưa có dự án nào.
          </p>
        )}
        {projects.map((p) => {
          const st = PROJECT_STATUS[p.status] ?? PROJECT_STATUS.PLANNING;
          const fin = profit[p.id];
          return (
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              className="block rounded-xl2 bg-white p-4 lg:p-5 shadow-card hover:border-amber/50 border border-transparent transition-all"
            >
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <p className="font-mono text-[11px] text-muted">{p.code}</p>
                  <p className="truncate text-sm font-semibold text-ink">{p.name}</p>
                </div>
                <span className={`ml-2 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${st.cls}`}>
                  {st.label}
                </span>
              </div>

              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
                {p.location && (
                  <span className="inline-flex items-center gap-1">
                    <MapPinIcon className="h-3.5 w-3.5" />
                    {p.location}
                  </span>
                )}
                {p.manager_name && (
                  <span className="inline-flex items-center gap-1">
                    <UserIcon className="h-3.5 w-3.5" />
                    {p.manager_name}
                  </span>
                )}
              </div>

              {fin && (
                <div className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3 text-center">
                  <div>
                    <p className="text-[10px] text-muted">Giá trị HĐ</p>
                    <p className="text-xs font-semibold text-ink">
                      {formatCompactVND(fin.contract_value)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted">Chi phí</p>
                    <p className="text-xs font-semibold text-ink">
                      {formatCompactVND(fin.cost)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted">Lãi/lỗ</p>
                    <p
                      className={`text-xs font-semibold ${
                        fin.profit >= 0 ? "text-ok" : "text-bad"
                      }`}
                    >
                      {formatCompactVND(fin.profit)}
                    </p>
                  </div>
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </AppShell>
  );
}
