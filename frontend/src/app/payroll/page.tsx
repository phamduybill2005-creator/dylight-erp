"use client";

// Trang Bảng lương — cấu hình lương + tính lương theo kỳ từ chấm công.
// NHẠY CẢM: chỉ Giám đốc / Quản trị (isDirector).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BanknotesIcon, XMarkIcon, CalculatorIcon, CheckIcon, ArrowDownTrayIcon } from "@heroicons/react/24/outline";
import AppShell from "@/components/app-shell";
import { api } from "@/lib/api";
import { isDirector } from "@/lib/roles";
import { formatVND, monthLocal } from "@/lib/format";
import type { Payroll, SalaryConfig, SalaryType, User } from "@/lib/types";

const monthStr = monthLocal;

export default function PayrollPage() {
  const router = useRouter();
  const [me, setMe] = useState<User | null>(api.cachedUser());
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(true);

  const [staff, setStaff] = useState<SalaryConfig[]>([]);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [period, setPeriod] = useState(monthStr());
  const [rows, setRows] = useState<Payroll[]>([]);
  const [generating, setGenerating] = useState(false);
  const [shared, setShared] = useState(false);
  const [sharingBusy, setSharingBusy] = useState(false);

  useEffect(() => {
    api.me()
      .then((u) => {
        setMe(u);
        if (!isDirector(u.role)) { setDenied(true); setLoading(false); return; }
        Promise.all([api.salaryStaff(), api.payrollList(monthStr()), api.payrollSharing()])
          .then(([s, p, sh]) => { setStaff(s); setRows(p); setShared(sh.shared); })
          .catch(() => {})
          .finally(() => setLoading(false));
      })
      .catch(() => router.push("/login"));
  }, [router]);

  async function toggleSharing() {
    setSharingBusy(true);
    try { const r = await api.setPayrollSharing(!shared); setShared(r.shared); }
    catch { /* noop */ } finally { setSharingBusy(false); }
  }

  function patchLocal(id: number, field: keyof SalaryConfig, value: any) {
    setStaff((xs) => xs.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
  }

  async function saveRow(s: SalaryConfig) {
    setSavingId(s.id);
    try {
      await api.setSalary(s.id, {
        base_salary: Number(s.base_salary) || 0,
        salary_type: s.salary_type,
        allowance: Number(s.allowance) || 0,
        num_dependents: Number(s.num_dependents) || 0,
      });
    } catch { /* noop */ } finally { setSavingId(null); }
  }

  async function generate() {
    setGenerating(true);
    try { setRows(await api.generatePayroll(period)); } catch { /* noop */ } finally { setGenerating(false); }
  }

  function exportCSV() {
    const headers = ["Nhân viên", "Ngày công", "Lương theo công", "Phụ cấp", "Tổng thu nhập", "Bảo hiểm (10.5%)", "Thuế TNCN", "Thực nhận"];
    const lines = rows.map((r) => [
      `"${(r.user_name || "").replace(/"/g, '""')}"`,
      Number(r.working_days), Number(r.base_amount).toFixed(0), Number(r.allowance).toFixed(0),
      Number(r.gross).toFixed(0), Number(r.insurance).toFixed(0), Number(r.personal_income_tax).toFixed(0), Number(r.net).toFixed(0),
    ].join(","));
    const csv = "﻿" + [headers.join(","), ...lines].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a"); a.href = url; a.download = `Bang_luong_${period}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  if (denied) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-paper p-4 text-center">
        <XMarkIcon className="h-16 w-16 text-bad" />
        <h1 className="mt-4 text-lg font-bold text-ink">Không có quyền truy cập</h1>
        <p className="mt-2 max-w-xs text-sm text-muted">Bảng lương chỉ dành cho Ban Giám đốc.</p>
        <button onClick={() => router.push("/")} className="mt-4 rounded-xl2 bg-ink px-4 py-2 text-xs font-semibold text-white">Về trang chủ</button>
      </div>
    );
  }
  if (loading || !me) {
    return <AppShell><div className="flex min-h-[70vh] items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-steel border-t-amber" /></div></AppShell>;
  }

  const totals = rows.reduce((a, r) => ({ gross: a.gross + Number(r.gross), ins: a.ins + Number(r.insurance), pit: a.pit + Number(r.personal_income_tax), net: a.net + Number(r.net) }), { gross: 0, ins: 0, pit: 0, net: 0 });
  const inputCls = "w-full rounded border border-line bg-white px-2 py-1 text-xs text-right tnum outline-none focus:border-steel";

  return (
    <AppShell>
      <header className="flex items-center gap-2 rounded-xl2 bg-ink p-4 lg:p-6 text-white shadow-card">
        <BanknotesIcon className="h-5 w-5 text-amber" />
        <h1 className="text-base lg:text-xl font-bold">Bảng lương</h1>
      </header>

      {/* Công tắc chia sẻ phiếu lương cho nhân viên */}
      <section className="mt-3 flex items-center justify-between gap-3 rounded-xl2 border border-line bg-white p-4 shadow-card">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">Chia sẻ phiếu lương cho nhân viên</p>
          <p className="mt-0.5 text-[11px] text-muted">
            {shared
              ? "Đang bật: mỗi người tự xem phiếu lương CỦA MÌNH ở mục Cá nhân (không thấy của người khác)."
              : "Đang tắt: chỉ Giám đốc thấy bảng lương. Bật để mỗi nhân viên xem được phiếu lương của chính họ."}
          </p>
        </div>
        <button
          onClick={toggleSharing}
          disabled={sharingBusy}
          role="switch"
          aria-checked={shared}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${shared ? "bg-ok" : "bg-line"}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${shared ? "left-[22px]" : "left-0.5"}`} />
        </button>
      </section>

      {/* 1. Cấu hình lương */}
      <section className="mt-4">
        <h2 className="mb-2 text-sm font-semibold text-ink">1. Cấu hình lương nhân viên</h2>
        <div className="overflow-x-auto rounded-xl2 border border-line bg-white shadow-card">
          <table className="w-full min-w-[680px] border-collapse text-sm">
            <thead>
              <tr className="bg-paper text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="border border-line px-3 py-2">Nhân viên</th>
                <th className="border border-line px-3 py-2 text-right">Lương cơ bản</th>
                <th className="border border-line px-3 py-2">Hình thức</th>
                <th className="border border-line px-3 py-2 text-right">Phụ cấp</th>
                <th className="border border-line px-3 py-2 text-center">Phụ thuộc</th>
                <th className="border border-line px-3 py-2 text-center w-16"></th>
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.id} className="odd:bg-white even:bg-paper/40">
                  <td className="border border-line px-3 py-2 font-semibold text-ink whitespace-nowrap">{s.full_name}</td>
                  <td className="border border-line px-2 py-1"><input type="number" value={Number(s.base_salary)} onChange={(e) => patchLocal(s.id, "base_salary", e.target.value)} className={inputCls} /></td>
                  <td className="border border-line px-2 py-1">
                    <select value={s.salary_type} onChange={(e) => patchLocal(s.id, "salary_type", e.target.value as SalaryType)} className="w-full rounded border border-line bg-white px-2 py-1 text-xs outline-none focus:border-steel">
                      <option value="MONTHLY">Lương tháng</option>
                      <option value="DAILY">Công nhật</option>
                    </select>
                  </td>
                  <td className="border border-line px-2 py-1"><input type="number" value={Number(s.allowance)} onChange={(e) => patchLocal(s.id, "allowance", e.target.value)} className={inputCls} /></td>
                  <td className="border border-line px-2 py-1"><input type="number" value={Number(s.num_dependents)} onChange={(e) => patchLocal(s.id, "num_dependents", e.target.value)} className={`${inputCls} text-center`} /></td>
                  <td className="border border-line px-2 py-1 text-center">
                    <button onClick={() => saveRow(s)} disabled={savingId === s.id} className="rounded bg-ink px-2 py-1 text-[10px] font-semibold text-white disabled:opacity-50">
                      {savingId === s.id ? "…" : "Lưu"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 2. Tính lương theo kỳ */}
      <section className="mt-6">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">2. Bảng lương theo kỳ</h2>
          <div className="flex items-center gap-2">
            <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="rounded-xl2 border border-line bg-white px-2 py-1.5 text-xs outline-none focus:border-steel" />
            <button onClick={generate} disabled={generating} className="flex items-center gap-1.5 rounded-xl2 bg-amber px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-50">
              <CalculatorIcon className="h-4 w-4" /> {generating ? "Đang tính…" : "Tính lương"}
            </button>
            <button onClick={exportCSV} disabled={rows.length === 0} className="flex items-center gap-1.5 rounded-xl2 bg-steel px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
              <ArrowDownTrayIcon className="h-4 w-4" /> CSV
            </button>
          </div>
        </div>
        <div className="overflow-x-auto rounded-xl2 border border-line bg-white shadow-card">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="bg-paper text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="border border-line px-3 py-2">Nhân viên</th>
                <th className="border border-line px-3 py-2 text-center">Công</th>
                <th className="border border-line px-3 py-2 text-right">Lương theo công</th>
                <th className="border border-line px-3 py-2 text-right">Phụ cấp</th>
                <th className="border border-line px-3 py-2 text-right">Tổng thu nhập</th>
                <th className="border border-line px-3 py-2 text-right">Bảo hiểm</th>
                <th className="border border-line px-3 py-2 text-right">Thuế TNCN</th>
                <th className="border border-line px-3 py-2 text-right">Thực nhận</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={8} className="border border-line px-3 py-6 text-center text-muted">Chưa có bảng lương kỳ này. Bấm “Tính lương”.</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="odd:bg-white even:bg-paper/40">
                  <td className="border border-line px-3 py-2 font-semibold text-ink whitespace-nowrap">{r.user_name}</td>
                  <td className="border border-line px-3 py-2 text-center tnum">{Number(r.working_days)}</td>
                  <td className="border border-line px-3 py-2 text-right tnum whitespace-nowrap">{formatVND(r.base_amount)}</td>
                  <td className="border border-line px-3 py-2 text-right tnum whitespace-nowrap">{formatVND(r.allowance)}</td>
                  <td className="border border-line px-3 py-2 text-right tnum whitespace-nowrap font-semibold">{formatVND(r.gross)}</td>
                  <td className="border border-line px-3 py-2 text-right tnum whitespace-nowrap text-muted">{formatVND(r.insurance)}</td>
                  <td className="border border-line px-3 py-2 text-right tnum whitespace-nowrap text-muted">{formatVND(r.personal_income_tax)}</td>
                  <td className="border border-line px-3 py-2 text-right tnum whitespace-nowrap font-bold text-ok">{formatVND(r.net)}</td>
                </tr>
              ))}
              {rows.length > 0 && (
                <tr className="bg-ink/5 font-bold text-ink">
                  <td className="border border-line px-3 py-2" colSpan={4}>TỔNG CỘNG</td>
                  <td className="border border-line px-3 py-2 text-right tnum whitespace-nowrap">{formatVND(totals.gross)}</td>
                  <td className="border border-line px-3 py-2 text-right tnum whitespace-nowrap">{formatVND(totals.ins)}</td>
                  <td className="border border-line px-3 py-2 text-right tnum whitespace-nowrap">{formatVND(totals.pit)}</td>
                  <td className="border border-line px-3 py-2 text-right tnum whitespace-nowrap text-ok">{formatVND(totals.net)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-muted">Ngày công lấy tự động từ chấm công. BHXH+BHYT+BHTN 10,5%; thuế TNCN lũy tiến; giảm trừ bản thân 11tr + 4,4tr/người phụ thuộc.</p>
      </section>
    </AppShell>
  );
}
