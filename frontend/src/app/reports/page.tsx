"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BanknotesIcon,
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  ChartPieIcon,
  ArrowRightIcon,
  ArrowLeftIcon,
  ArrowDownTrayIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import AppShell from "@/components/app-shell";
import { api } from "@/lib/api";
import { isDirector } from "@/lib/roles";
import { formatCompactVND, formatVND } from "@/lib/format";
import type { ProjectProfit } from "@/lib/types";

export default function ReportsPage() {
  const router = useRouter();
  const [profitData, setProfitData] = useState<ProjectProfit[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [sortBy, setSortBy] = useState<"lowest_margin" | "highest_margin" | "largest_profit">("lowest_margin");

  // Báo cáo lãi/lỗ lộ doanh thu -> chỉ Giám đốc. Kiểm tra vai trò trước khi tải.
  useEffect(() => {
    api.me()
      .then((me) => {
        if (!isDirector(me.role)) {
          setDenied(true);
          setLoading(false);
          return;
        }
        api.profitByProject()
          .then(setProfitData)
          .catch(() => {})
          .finally(() => setLoading(false));
      })
      .catch(() => router.push("/login"));
  }, [router]);

  if (denied) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-paper p-4 text-center">
        <XMarkIcon className="h-16 w-16 text-bad" />
        <h1 className="mt-4 text-lg font-bold text-ink">Không có quyền truy cập</h1>
        <p className="mt-2 max-w-xs text-sm text-muted">
          Báo cáo doanh thu / lãi-lỗ chỉ dành cho Ban Giám đốc.
        </p>
        <button
          onClick={() => router.push("/")}
          className="mt-4 rounded-xl2 bg-ink px-4 py-2 text-xs font-semibold text-white"
        >
          Về trang chủ
        </button>
      </div>
    );
  }

  // Calculate Company-wide Summaries
  const totalRevenue = profitData.reduce((acc, p) => acc + Number(p.contract_value), 0);
  const totalCost = profitData.reduce((acc, p) => acc + Number(p.cost), 0);
  const totalProfit = totalRevenue - totalCost;
  const avgMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

  // Sort
  const sortedData = [...profitData].sort((a, b) => {
    if (sortBy === "lowest_margin") {
      return a.margin_percent - b.margin_percent;
    }
    if (sortBy === "highest_margin") {
      return b.margin_percent - a.margin_percent;
    }
    if (sortBy === "largest_profit") {
      return b.profit - a.profit;
    }
    return 0;
  });

  // Xuất báo cáo ra CSV (mở được bằng Excel, có BOM cho tiếng Việt)
  function exportCSV() {
    const headers = [
      "Dự án",
      "Giá trị hợp đồng (VND)",
      "Chi phí đã duyệt (VND)",
      "Lãi / lỗ (VND)",
      "Biên lợi nhuận (%)",
    ];

    const rows = sortedData.map((p) => [
      `"${(p.project_name || "").replace(/"/g, '""')}"`,
      Number(p.contract_value).toFixed(0),
      Number(p.cost).toFixed(0),
      Number(p.profit).toFixed(0),
      Number(p.margin_percent || 0).toFixed(1),
    ]);

    // Dòng tổng kết toàn công ty
    const totalRow = [
      '"TỔNG CỘNG"',
      totalRevenue.toFixed(0),
      totalCost.toFixed(0),
      totalProfit.toFixed(0),
      avgMargin.toFixed(1),
    ];

    const csvContent =
      "﻿" + // UTF-8 BOM giúp Excel đọc đúng tiếng Việt
      [headers.join(","), ...rows.map((e) => e.join(",")), totalRow.join(",")].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Bao_cao_lai_lo_${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return (
    <AppShell>
      {/* Nút quay lại */}
      <button
        onClick={() => router.push("/")}
        className="flex items-center gap-1 text-xs text-muted hover:text-ink mb-4 font-semibold"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Quay lại tổng quan
      </button>

      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-ink lg:text-2xl">Báo cáo lãi / lỗ</h1>
          <p className="text-xs text-muted lg:text-sm">Báo cáo kết quả hoạt động tài chính theo dự án.</p>
        </div>
        <button
          onClick={exportCSV}
          disabled={loading || profitData.length === 0}
          className="flex shrink-0 items-center gap-1.5 rounded-xl2 bg-steel px-3 py-2 text-xs font-semibold text-white shadow hover:bg-ink transition-all disabled:opacity-50"
        >
          <ArrowDownTrayIcon className="h-4 w-4" />
          Xuất Excel
        </button>
      </div>

      {loading ? (
        <p className="py-20 text-center text-xs text-muted">Đang tải báo cáo tài chính...</p>
      ) : (
        <div className="mt-4 space-y-4">
          {/* Card Tổng quan công ty */}
          <div className="rounded-xl2 bg-white p-4 shadow-card border border-line/50 lg:p-6">
            <h2 className="text-xs font-semibold text-muted uppercase tracking-wider flex items-center gap-1.5">
              <ChartPieIcon className="h-4 w-4 text-steel" />
              Tổng kết hoạt động toàn công ty
            </h2>
            
            <div className="mt-4 grid grid-cols-2 gap-4 divide-y divide-line/60 lg:grid-cols-4 lg:gap-6 lg:divide-y-0">
              <div className="pt-0">
                <span className="text-[10px] text-muted block lg:text-xs">Tổng doanh thu HĐ</span>
                <span className="text-base font-bold text-ink tnum lg:text-xl">{formatVND(totalRevenue)}</span>
              </div>
              <div className="pt-0">
                <span className="text-[10px] text-muted block lg:text-xs">Tổng chi phí thực tế</span>
                <span className="text-base font-bold text-ink tnum lg:text-xl">{formatVND(totalCost)}</span>
              </div>
              <div className="pt-3 lg:pt-0">
                <span className="text-[10px] text-muted block lg:text-xs">Tổng lợi nhuận ròng</span>
                <span className={`text-base font-bold tnum lg:text-xl ${totalProfit >= 0 ? "text-ok" : "text-bad"}`}>
                  {formatVND(totalProfit)}
                </span>
              </div>
              <div className="pt-3 lg:pt-0">
                <span className="text-[10px] text-muted block lg:text-xs">Biên lợi nhuận bình quân</span>
                <span className={`text-base font-bold tnum lg:text-xl ${avgMargin >= 0 ? "text-ok" : "text-bad"}`}>
                  {avgMargin.toFixed(1)}%
                </span>
              </div>
            </div>
          </div>

          {/* Sắp xếp */}
          <div className="flex items-center justify-between text-xs mt-6">
            <span className="font-semibold text-ink">Lợi nhuận theo dự án ({profitData.length})</span>
            <select
              value={sortBy}
              onChange={(e: any) => setSortBy(e.target.value)}
              className="rounded-xl2 border border-line bg-white px-2 py-1.5 focus:border-amber focus:outline-none"
            >
              <option value="lowest_margin">Biên lãi từ thấp đến cao</option>
              <option value="highest_margin">Biên lãi từ cao đến thấp</option>
              <option value="largest_profit">Số tiền lãi nhiều nhất</option>
            </select>
          </div>

          {/* Danh sách dự án */}
          <div className="space-y-3 lg:space-y-0 lg:grid lg:grid-cols-2 lg:gap-3 xl:grid-cols-3">
            {sortedData.length === 0 ? (
              <p className="rounded-xl2 bg-white p-8 text-center text-xs text-muted shadow-card lg:col-span-2 xl:col-span-3">
                Chưa có dữ liệu dự án.
              </p>
            ) : (
              sortedData.map((p) => {
                const positive = p.profit >= 0;
                // Low margin alert
                const lowMargin = p.margin_percent < 10;
                const progressWidth = Math.min(100, p.contract_value > 0 ? (p.cost / p.contract_value) * 100 : 0);

                return (
                  <div
                    key={p.project_id}
                    onClick={() => router.push(`/projects/${p.project_id}`)}
                    className="rounded-xl2 bg-white p-4 shadow-card border border-line/50 hover:border-amber/40 transition-all cursor-pointer block"
                  >
                    <div className="flex items-start justify-between">
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-semibold text-ink leading-tight">{p.project_name}</h3>
                      </div>
                      <span className={`flex items-center gap-1.5 text-xs font-bold ${positive ? "text-ok" : "text-bad"}`}>
                        {positive ? (
                          <ArrowTrendingUpIcon className="h-4 w-4 text-ok" />
                        ) : (
                          <ArrowTrendingDownIcon className="h-4 w-4 text-bad" />
                        )}
                        {Number(p.margin_percent || 0).toFixed(1)}%
                      </span>
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs border-b border-line pb-3">
                      <div>
                        <p className="text-[9px] text-muted">Giá trị thầu</p>
                        <p className="font-semibold text-ink tnum">{formatCompactVND(p.contract_value)}</p>
                      </div>
                      <div>
                        <p className="text-[9px] text-muted">Chi phí (đã duyệt)</p>
                        <p className="font-semibold text-ink tnum">{formatCompactVND(p.cost)}</p>
                      </div>
                      <div>
                        <p className="text-[9px] text-muted">Lãi / lỗ</p>
                        <p className={`font-bold tnum ${positive ? "text-ok" : "text-bad"}`}>
                          {formatCompactVND(p.profit)}
                        </p>
                      </div>
                    </div>

                    {/* Biểu đồ chi phí trên doanh thu */}
                    <div className="mt-3">
                      <div className="flex justify-between text-[10px] text-muted mb-1">
                        <span>Tỷ lệ Chi phí / Hợp đồng:</span>
                        <span className={`font-bold ${progressWidth >= 100 ? "text-bad" : "text-ink"}`}>
                          {progressWidth.toFixed(1)}%
                        </span>
                      </div>
                      <div className="h-2 w-full bg-line rounded-full overflow-hidden">
                        <div
                          className={`h-full ${!positive ? "bg-bad" : lowMargin ? "bg-amber" : "bg-ok"}`}
                          style={{ width: `${progressWidth}%` }}
                        />
                      </div>
                    </div>

                    <div className="mt-3 pt-2.5 flex items-center justify-end text-[10px] font-bold text-steel hover:text-ink">
                      Xem chi tiết dự án
                      <ArrowRightIcon className="h-3 w-3 ml-1" />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}
