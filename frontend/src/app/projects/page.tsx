"use client";

// Trang Dự án & Hợp đồng — trình bày dạng BẢNG (kiểu Excel): kẻ ô, hàng/cột,
// có dòng tổng cộng. Cột tài chính (Giá trị HĐ / Chi phí / Lãi-lỗ) chỉ hiện cho
// Giám đốc; Quản lý thấy bảng vận hành (không có tiền). Bấm 1 hàng để mở chi tiết.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [profit, setProfit] = useState<Record<number, ProjectProfit>>({});
  const [showFinance, setShowFinance] = useState(false);

  useEffect(() => {
    api.projects().then(setProjects).catch(() => {});
    // Số liệu lãi/lỗ theo dự án chỉ dành cho Giám đốc — Quản lý không tải (tránh 403).
    api.me()
      .then((me) => {
        if (!isDirector(me.role)) return;
        setShowFinance(true);
        api
          .profitByProject()
          .then((rows) =>
            setProfit(Object.fromEntries(rows.map((r) => [r.project_id, r])))
          )
          .catch(() => {});
      })
      .catch(() => {});
  }, []);

  // Tổng cộng các cột tài chính (chỉ tính dự án có dữ liệu lãi/lỗ).
  const totals = projects.reduce(
    (acc, p) => {
      const fin = profit[p.id];
      if (fin) {
        acc.contract += Number(fin.contract_value);
        acc.cost += Number(fin.cost);
        acc.profit += Number(fin.profit);
      }
      return acc;
    },
    { contract: 0, cost: 0, profit: 0 }
  );
  const totalMargin = totals.contract > 0 ? (totals.profit / totals.contract) * 100 : 0;

  const TH = "border border-line px-3 py-2 font-semibold whitespace-nowrap";
  const TD = "border border-line px-3 py-2 align-middle";
  // Số cột phần "thông tin" (trước các cột tiền) để gộp ô cho dòng TỔNG CỘNG.
  const infoCols = 6;

  return (
    <AppShell>
      <h1 className="text-lg font-semibold text-ink lg:text-2xl">Dự án & Hợp đồng</h1>
      <p className="mt-0.5 text-xs text-muted lg:text-sm">
        Theo dõi vòng đời dự án từ đấu thầu tới quyết toán.
      </p>

      <div className="mt-4 overflow-x-auto rounded-xl2 border border-line bg-white shadow-card">
        <table className="w-full min-w-[680px] border-collapse text-sm">
          <thead>
            <tr className="bg-paper text-left text-[11px] uppercase tracking-wide text-muted">
              <th className={`${TH} w-10 text-center`}>STT</th>
              <th className={TH}>Mã DA</th>
              <th className={TH}>Tên dự án</th>
              <th className={TH}>Địa điểm</th>
              <th className={TH}>Quản lý</th>
              <th className={TH}>Trạng thái</th>
              {showFinance && <th className={`${TH} text-right`}>Giá trị HĐ</th>}
              {showFinance && <th className={`${TH} text-right`}>Chi phí</th>}
              {showFinance && <th className={`${TH} text-right`}>Lãi / lỗ</th>}
              {showFinance && <th className={`${TH} text-right`}>Biên %</th>}
            </tr>
          </thead>
          <tbody>
            {projects.length === 0 && (
              <tr>
                <td className={`${TD} text-center text-muted`} colSpan={showFinance ? infoCols + 4 : infoCols}>
                  Chưa có dự án nào.
                </td>
              </tr>
            )}

            {projects.map((p, i) => {
              const st = PROJECT_STATUS[p.status] ?? PROJECT_STATUS.PLANNING;
              const fin = profit[p.id];
              const positive = fin ? Number(fin.profit) >= 0 : true;
              return (
                <tr
                  key={p.id}
                  onClick={() => router.push(`/projects/${p.id}`)}
                  className="cursor-pointer transition-colors odd:bg-white even:bg-paper/40 hover:bg-amber/10"
                >
                  <td className={`${TD} text-center text-muted tnum`}>{i + 1}</td>
                  <td className={`${TD} font-mono text-[12px] text-steel whitespace-nowrap`}>{p.code}</td>
                  <td className={`${TD} font-semibold text-ink`}>{p.name}</td>
                  <td className={`${TD} text-muted`}>{p.location || "—"}</td>
                  <td className={`${TD} text-muted whitespace-nowrap`}>{p.manager_name || "—"}</td>
                  <td className={TD}>
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${st.cls}`}>
                      {st.label}
                    </span>
                  </td>
                  {showFinance && (
                    <td className={`${TD} text-right tnum whitespace-nowrap`}>
                      {fin ? formatCompactVND(fin.contract_value) : "—"}
                    </td>
                  )}
                  {showFinance && (
                    <td className={`${TD} text-right tnum whitespace-nowrap`}>
                      {fin ? formatCompactVND(fin.cost) : "—"}
                    </td>
                  )}
                  {showFinance && (
                    <td className={`${TD} text-right tnum whitespace-nowrap font-semibold ${positive ? "text-ok" : "text-bad"}`}>
                      {fin ? formatCompactVND(fin.profit) : "—"}
                    </td>
                  )}
                  {showFinance && (
                    <td className={`${TD} text-right tnum whitespace-nowrap font-semibold ${positive ? "text-ok" : "text-bad"}`}>
                      {fin ? `${Number(fin.margin_percent).toFixed(1)}%` : "—"}
                    </td>
                  )}
                </tr>
              );
            })}

            {/* Dòng TỔNG CỘNG (chỉ Giám đốc) */}
            {showFinance && projects.length > 0 && (
              <tr className="bg-ink/5 font-bold text-ink">
                <td className={`${TD} text-right`} colSpan={infoCols}>
                  TỔNG CỘNG
                </td>
                <td className={`${TD} text-right tnum whitespace-nowrap`}>{formatCompactVND(totals.contract)}</td>
                <td className={`${TD} text-right tnum whitespace-nowrap`}>{formatCompactVND(totals.cost)}</td>
                <td className={`${TD} text-right tnum whitespace-nowrap ${totals.profit >= 0 ? "text-ok" : "text-bad"}`}>
                  {formatCompactVND(totals.profit)}
                </td>
                <td className={`${TD} text-right tnum whitespace-nowrap ${totalMargin >= 0 ? "text-ok" : "text-bad"}`}>
                  {totalMargin.toFixed(1)}%
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[11px] text-muted">Bấm vào một hàng để xem chi tiết dự án.</p>
    </AppShell>
  );
}
