"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ScaleIcon,
  ArrowDownTrayIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  BanknotesIcon,
  BuildingOfficeIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import AppShell from "@/components/app-shell";
import { api } from "@/lib/api";
import { isDirector } from "@/lib/roles";
import { formatVND, formatDate } from "@/lib/format";
import type { Project, Contract, Payment, Invoice } from "@/lib/types";

export default function ReconciliationPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);

  function loadData() {
    setLoading(true);
    Promise.all([
      api.projects(),
      api.contracts(),
      api.invoices("VERIFIED"),
      api.payments(),
    ])
      .then(([projs, contrs, invs, pmts]) => {
        setProjects(projs);
        setContracts(contrs);
        setInvoices(invs);
        setPayments(pmts);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  // Đối soát quyết toán lộ doanh thu/dòng tiền -> chỉ Giám đốc.
  useEffect(() => {
    api.me()
      .then((me) => {
        if (!isDirector(me.role)) {
          setDenied(true);
          setLoading(false);
          return;
        }
        loadData();
      })
      .catch(() => router.push("/login"));
  }, [router]);

  if (denied) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-paper p-4 text-center">
        <XMarkIcon className="h-16 w-16 text-bad" />
        <h1 className="mt-4 text-lg font-bold text-ink">Không có quyền truy cập</h1>
        <p className="mt-2 max-w-xs text-sm text-muted">
          Đối soát quyết toán (doanh thu / dòng tiền) chỉ dành cho Ban Giám đốc.
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

  // Export CSV
  function exportCSV() {
    const headers = [
      "Mã hợp đồng",
      "Tên hợp đồng",
      "Dự án",
      "Đối tác",
      "Giá trị chưa VAT (VND)",
      "VAT (%)",
      "Giá trị có VAT (VND)",
      "Chi phí thực tế (HĐ đã duyệt)",
      "Dòng tiền đã thu (VND)",
      "Dư nợ CĐT còn lại (VND)",
      "Tỷ lệ đã thu (%)",
    ];

    const rows = contracts.map((c) => {
      const proj = projects.find((p) => p.id === c.project_id);
      const valWithVat = Number(c.value_no_vat) * (1 + Number(c.vat_percent) / 100);
      const cost = invoices
        .filter((i) => i.contract_id === c.id)
        .reduce((acc, i) => acc + Number(i.total_amount), 0);
      const collected = payments
        .filter((p) => p.contract_id === c.id && p.direction === "IN")
        .reduce((acc, p) => acc + Number(p.amount), 0);
      const remaining = valWithVat - collected;
      const collectPercent = valWithVat > 0 ? (collected / valWithVat) * 100 : 0;

      return [
        c.code,
        `"${c.name.replace(/"/g, '""')}"`,
        `"${(proj?.name || "").replace(/"/g, '""')}"`,
        `"${(c.partner || "").replace(/"/g, '""')}"`,
        c.value_no_vat,
        c.vat_percent,
        valWithVat.toFixed(2),
        cost.toFixed(2),
        collected.toFixed(2),
        remaining.toFixed(2),
        collectPercent.toFixed(1),
      ];
    });

    const csvContent =
      "\uFEFF" + // UTF-8 BOM for Excel Vietnamese characters
      [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Doi_soat_quyet_toan_${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <AppShell>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-ink lg:text-2xl">Đối soát quyết toán</h1>
          <p className="text-xs text-muted">Theo dõi thanh toán hợp đồng và thu hồi công nợ.</p>
        </div>
        <button
          onClick={exportCSV}
          disabled={contracts.length === 0}
          className="flex items-center gap-1.5 rounded-xl2 bg-steel px-3 py-2 text-xs font-semibold text-white shadow hover:bg-ink transition-all disabled:opacity-50"
        >
          <ArrowDownTrayIcon className="h-4 w-4" />
          Xuất báo cáo
        </button>
      </div>

      <div className="mt-4 space-y-4">
        {loading ? (
          <p className="py-20 text-center text-xs text-muted">Đang tải báo cáo đối soát...</p>
        ) : contracts.length === 0 ? (
          <p className="rounded-xl2 bg-white p-8 text-center text-xs text-muted shadow-card">
            Chưa có hợp đồng nào để đối soát.
          </p>
        ) : (
          <div className="space-y-4 lg:grid lg:grid-cols-2 lg:gap-4 lg:space-y-0 xl:grid-cols-3">
          {contracts.map((c) => {
            const proj = projects.find((p) => p.id === c.project_id);
            const valWithVat = Number(c.value_no_vat) * (1 + Number(c.vat_percent) / 100);
            const cost = invoices
              .filter((i) => i.contract_id === c.id)
              .reduce((acc, i) => acc + Number(i.total_amount), 0);
            const collected = payments
              .filter((p) => p.contract_id === c.id && p.direction === "IN")
              .reduce((acc, p) => acc + Number(p.amount), 0);
            const remaining = valWithVat - collected;
            const collectPercent = valWithVat > 0 ? (collected / valWithVat) * 100 : 0;
            const fullyCollected = remaining <= 0;

            return (
              <div key={c.id} className="rounded-xl2 bg-white p-4 shadow-card border border-line/50 lg:p-5">
                <div className="flex items-start justify-between">
                  <div className="min-w-0">
                    <span className="font-mono text-[9px] text-muted">{c.code}</span>
                    <h3 className="truncate text-sm font-semibold text-ink leading-snug">{c.name}</h3>
                    <p className="text-[11px] text-muted truncate mt-0.5">Dự án: {proj?.name || "—"}</p>
                  </div>
                  {fullyCollected ? (
                    <span className="flex items-center gap-1 rounded-full bg-ok/10 px-2 py-0.5 text-[9px] font-bold text-ok">
                      <CheckCircleIcon className="h-3 w-3" />
                      Đã tất toán
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 rounded-full bg-amber/15 px-2 py-0.5 text-[9px] font-bold text-amber-deep">
                      <ExclamationCircleIcon className="h-3 w-3" />
                      Chờ thanh toán
                    </span>
                  )}
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line/50 pt-3">
                  <div>
                    <span className="text-[10px] text-muted block">Tổng giá trị HĐ (đã thuế)</span>
                    <span className="text-xs font-semibold text-ink tnum">{formatVND(valWithVat)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted block">Chi phí thi công (Đã duyệt)</span>
                    <span className="text-xs font-semibold text-ink tnum">{formatVND(cost)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted block">Tiền đã thu về</span>
                    <span className="text-xs font-bold text-ok tnum">{formatVND(collected)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted block">Công nợ CĐT còn lại</span>
                    <span className={`text-xs font-bold tnum ${remaining > 0 ? "text-bad" : "text-ok"}`}>
                      {formatVND(remaining)}
                    </span>
                  </div>
                </div>

                {/* Thanh tiến trình thu hồi công nợ */}
                <div className="mt-4">
                  <div className="flex justify-between text-[10px] text-muted mb-1">
                    <span>Tiến độ thu hồi công nợ:</span>
                    <span className="font-bold text-ink">{collectPercent.toFixed(1)}%</span>
                  </div>
                  <div className="h-1.5 w-full bg-line rounded-full overflow-hidden">
                    <div
                      className={`h-full ${collectPercent >= 100 ? "bg-ok" : "bg-steel"}`}
                      style={{ width: `${Math.min(100, collectPercent)}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
