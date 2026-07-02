"use client";

// Trang Tài chính & Công nợ — tổng quan thu/chi và bảng công nợ theo hợp đồng.
// NHẠY CẢM: CHỈ Giám đốc (isDirector). Vai trò khác bị chặn.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CurrencyDollarIcon, XMarkIcon } from "@heroicons/react/24/outline";
import AppShell from "@/components/app-shell";
import { api } from "@/lib/api";
import { isDirector } from "@/lib/roles";
import { formatVND } from "@/lib/format";
import type { FinanceSummary, DebtRow, User } from "@/lib/types";

export default function FinancePage() {
  const router = useRouter();
  const [me, setMe] = useState<User | null>(api.cachedUser());
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [debts, setDebts] = useState<DebtRow[]>([]);

  useEffect(() => {
    api.me()
      .then((u) => {
        setMe(u);
        if (!isDirector(u.role)) { setDenied(true); setLoading(false); return; }
        Promise.all([
          api.financeSummary().then(setSummary).catch(() => {}),
          api.debts().then(setDebts).catch(() => {}),
        ]).finally(() => setLoading(false));
      })
      .catch(() => router.push("/login"));
  }, [router]);

  if (denied) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-paper p-4 text-center">
        <XMarkIcon className="h-16 w-16 text-bad" />
        <h1 className="mt-4 text-lg font-bold text-ink">Không có quyền truy cập</h1>
        <p className="mt-2 max-w-xs text-sm text-muted">Dữ liệu tài chính chỉ dành cho Ban Giám đốc.</p>
        <button onClick={() => router.push("/")} className="mt-4 rounded-xl2 bg-ink px-4 py-2 text-xs font-semibold text-white">Về trang chủ</button>
      </div>
    );
  }
  if (loading || !me) {
    return <AppShell><div className="flex min-h-[70vh] items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-steel border-t-amber" /></div></AppShell>;
  }

  const totals = debts.reduce(
    (acc, d) => {
      acc.contract_value += d.contract_value || 0;
      acc.collected += d.collected || 0;
      acc.remaining += d.remaining || 0;
      return acc;
    },
    { contract_value: 0, collected: 0, remaining: 0 },
  );

  return (
    <AppShell>
      <header className="flex items-center gap-2 rounded-xl2 bg-ink p-4 lg:p-6 text-white shadow-card">
        <CurrencyDollarIcon className="h-5 w-5 text-amber" />
        <h1 className="text-base lg:text-xl font-bold">Tài chính & Công nợ</h1>
      </header>

      {/* Lưới thẻ tổng quan */}
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <SummaryCard label="Tổng thu" value={summary?.total_in} valueCls="text-ok" />
        <SummaryCard label="Tổng chi" value={summary?.total_out} valueCls="text-bad" />
        <SummaryCard label="Số dư" value={summary?.balance} valueCls="text-ink" />
        <SummaryCard label="Tổng giá trị HĐ" value={summary?.total_contract_value} valueCls="text-ink" />
        <SummaryCard label="Tổng chi phí" value={summary?.total_cost} valueCls="text-ink" />
      </div>

      {/* Bảng công nợ */}
      <div className="mt-6 overflow-x-auto rounded-xl2 border border-line bg-white shadow-card">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="bg-paper text-left text-[11px] uppercase tracking-wide text-muted">
              <th className="border border-line px-3 py-2 text-center w-12">STT</th>
              <th className="border border-line px-3 py-2">Mã HĐ</th>
              <th className="border border-line px-3 py-2">Dự án</th>
              <th className="border border-line px-3 py-2">Chủ đầu tư</th>
              <th className="border border-line px-3 py-2 text-right">Giá trị HĐ</th>
              <th className="border border-line px-3 py-2 text-right">Đã thu</th>
              <th className="border border-line px-3 py-2 text-right">Còn phải thu</th>
              <th className="border border-line px-3 py-2 text-right">Tỷ lệ thu</th>
            </tr>
          </thead>
          <tbody>
            {debts.length === 0 && (
              <tr><td colSpan={8} className="border border-line px-3 py-6 text-center text-muted">Chưa có dữ liệu công nợ.</td></tr>
            )}
            {debts.map((d, i) => (
              <tr key={d.contract_id} className="odd:bg-white even:bg-paper/40 hover:bg-amber/10">
                <td className="border border-line px-3 py-2 text-center text-muted tnum">{i + 1}</td>
                <td className="border border-line px-3 py-2 font-semibold text-ink whitespace-nowrap">{d.contract_code}</td>
                <td className="border border-line px-3 py-2 text-muted">{d.project_name || "—"}</td>
                <td className="border border-line px-3 py-2 text-muted">{d.partner || "—"}</td>
                <td className="border border-line px-3 py-2 text-right tnum">{formatVND(d.contract_value)}</td>
                <td className="border border-line px-3 py-2 text-right tnum text-ok">{formatVND(d.collected)}</td>
                <td className={`border border-line px-3 py-2 text-right tnum font-bold ${d.remaining > 0 ? "text-bad" : "text-ink"}`}>{formatVND(d.remaining)}</td>
                <td className="border border-line px-3 py-2 text-right tnum">{d.collect_percent}%</td>
              </tr>
            ))}
          </tbody>
          {debts.length > 0 && (
            <tfoot>
              <tr className="bg-paper font-bold text-ink">
                <td className="border border-line px-3 py-2 text-center" colSpan={4}>TỔNG CỘNG</td>
                <td className="border border-line px-3 py-2 text-right tnum">{formatVND(totals.contract_value)}</td>
                <td className="border border-line px-3 py-2 text-right tnum text-ok">{formatVND(totals.collected)}</td>
                <td className={`border border-line px-3 py-2 text-right tnum ${totals.remaining > 0 ? "text-bad" : "text-ink"}`}>{formatVND(totals.remaining)}</td>
                <td className="border border-line px-3 py-2 text-right tnum">—</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </AppShell>
  );
}

function SummaryCard({ label, value, valueCls }: { label: string; value?: number; valueCls: string }) {
  return (
    <div className="rounded-xl2 border border-line bg-white p-4 shadow-card">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-base lg:text-lg font-bold tnum ${valueCls}`}>{formatVND(value ?? 0)}</div>
    </div>
  );
}
