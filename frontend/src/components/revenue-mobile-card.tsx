"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronDownIcon, MapPinIcon, StarIcon as StarOutline, CheckIcon, MinusIcon } from "@heroicons/react/24/outline";
import { StarIcon as StarSolid } from "@heroicons/react/24/solid";
import { parseBanDoDetails, isBanDoTicked, revenueBandoValue } from "@/lib/bando-details";
import { BANDO_HOUR_COLUMNS, hoursByColumn, formatGroupHours, type GroupHours } from "@/lib/bando-hours";
import { formatVND } from "@/lib/format";
import { revenueMobileFacts } from "@/lib/mobile-view-models";
import type { Project } from "@/lib/types";

const formatHours = (hours: number) => hours.toLocaleString("vi-VN", { maximumFractionDigits: 1 });

export default function RevenueMobileCard({
  project, index, pinned, onTogglePin, revenue, jpyUnitPrice, exchangeRate, revenuePeriodLabel,
  monthLabel, monthActualHours, monthClientHours, totalClientHours, clientMonthEditor, clientHoursByMonth = {},
  isBanDoMode, groupHours, groupHoursPeriodLabel,
}: {
  project: Project;
  index: number;
  pinned: boolean;
  onTogglePin: () => void;
  revenue: number;
  jpyUnitPrice: number;
  exchangeRate: number;
  revenuePeriodLabel: string;
  monthLabel: string;
  monthActualHours: number;
  monthClientHours: number;
  totalClientHours: number;
  clientMonthEditor?: ReactNode;
  clientHoursByMonth?: Record<string, number>;
  isBanDoMode: boolean;
  groupHours?: GroupHours;
  groupHoursPeriodLabel: string;
}) {
  const facts = revenueMobileFacts(project, revenue);
  const bando = parseBanDoDetails(project.evaluation);
  const hours = hoursByColumn(groupHours);
  const manualHours = Number(project.manual_hours || 0);
  const clientMonths = Object.entries(clientHoursByMonth).sort(([a], [b]) => a.localeCompare(b));

  return (
    <article aria-label={`Doanh thu dự án ${project.code}`} className={`min-w-0 overflow-hidden rounded-2xl border bg-white p-3 shadow-card ${pinned ? "border-amber/60" : "border-line"}`}>
      <header className="flex items-start gap-2">
        <span className="pt-1 font-mono text-[11px] text-slate-400">{index}</span>
        <div className="min-w-0 flex-1">
          <p className="break-all font-mono text-xs font-bold text-bad">{project.code}</p>
          <h2 className="mt-0.5 break-words text-sm font-bold leading-snug text-ink">
            <Link href={`/projects/${project.id}`} className="hover:text-steel hover:underline">{project.name}</Link>
          </h2>
        </div>
        <button type="button" onClick={onTogglePin} className="-mr-1 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl hover:bg-amber/10" aria-label={pinned ? "Bỏ ghim dự án" : "Ghim dự án"}>
          {pinned ? <StarSolid className="h-5 w-5 text-amber" /> : <StarOutline className="h-5 w-5 text-slate-300" />}
        </button>
      </header>

      <section className="mt-3 rounded-xl bg-emerald-50 px-3 py-2.5" aria-label="Doanh thu và đơn giá">
        <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] text-emerald-700">
          <h3 className="font-semibold uppercase tracking-wide">Doanh thu</h3>
          <span>{revenuePeriodLabel}</span>
        </div>
        <p className="mt-0.5 break-all text-xl font-extrabold text-emerald-800 tnum">{facts.revenue > 0 ? formatVND(facts.revenue) : "—"}</p>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-emerald-800">
          <span>Đơn giá: <b className="tnum">{jpyUnitPrice > 0 ? `${jpyUnitPrice.toLocaleString("vi-VN")} ¥/h` : "—"}</b></span>
          <span className="tnum">1 ¥ = {exchangeRate.toLocaleString("vi-VN", { maximumFractionDigits: 2 })} ₫</span>
        </div>
      </section>

      <section className="mt-2 overflow-hidden rounded-xl border border-line/70" aria-label="Thời gian thực tế và khách hàng">
        <div className="flex flex-wrap items-center justify-between gap-1 bg-slate-50 px-2.5 py-2 text-[11px]">
          <h3 className="text-muted">Manual time</h3>
          <p className="font-bold text-ink tnum">
            {manualHours > 0 ? <>{formatHours(Math.round(manualHours / 8 * 10) / 10)} ngày <span className="font-normal text-muted">({formatHours(manualHours)}h)</span></> : "—"}
          </p>
        </div>
        <table className="w-full table-fixed text-xs" aria-label="Giờ thực tế và khách hàng">
          <colgroup><col className="w-[30%]" /><col className="w-[28%]" /><col className="w-[42%]" /></colgroup>
          <thead className="border-y border-line/60 bg-white text-[10px] text-muted">
            <tr><th scope="col" className="px-2.5 py-2 text-left font-medium">Thời gian</th><th scope="col" className="px-2 py-2 text-right font-medium">Thực tế</th><th scope="col" className="px-2.5 py-2 text-right font-medium">Khách hàng</th></tr>
          </thead>
          <tbody className="tnum">
            <tr className="border-b border-line/50">
              <th scope="row" className="px-2.5 py-2 text-left text-[11px] font-medium text-muted">{monthLabel}</th>
              <td className="px-2 py-2 text-right font-bold text-ink">{formatHours(monthActualHours)}h</td>
              <td className="px-2.5 py-1 text-right font-bold text-ink">
                {clientMonthEditor ? <div className="flex min-w-0 items-center justify-end gap-0.5">{clientMonthEditor}<span className="shrink-0">h</span></div> : `${formatHours(monthClientHours)}h`}
              </td>
            </tr>
            <tr className="bg-slate-50/60">
              <th scope="row" className="px-2.5 py-2.5 text-left text-[11px] font-medium text-muted">Toàn bộ</th>
              <td className="px-2 py-2.5 text-right font-bold text-ink">{formatHours(facts.actualHours)}h</td>
              <td className="px-2.5 py-2.5 text-right font-bold text-ink">{formatHours(totalClientHours)}h</td>
            </tr>
          </tbody>
        </table>
        {clientMonths.length > 0 && (
          <details className="group border-t border-line/60">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-2.5 py-2 text-[11px] font-medium text-steel [&::-webkit-details-marker]:hidden">
              Khách hàng theo tháng
              <ChevronDownIcon className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
            </summary>
            <dl className="border-t border-line/50 px-2.5 py-1">
              {clientMonths.map(([month, value]) => (
                <div key={month} className="flex items-center justify-between gap-2 py-1.5 text-[11px]">
                  <dt className="text-muted">{Number(month.slice(5, 7))}/{month.slice(0, 4)}</dt>
                  <dd className="font-semibold text-ink tnum">{formatHours(value)}h</dd>
                </div>
              ))}
            </dl>
          </details>
        )}
      </section>

      {isBanDoMode && (
        <details open className="group mt-2 rounded-xl border border-teal-100 bg-teal-50/50">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-2.5 py-2 text-xs font-semibold text-teal-900 [&::-webkit-details-marker]:hidden">
            <span>Chi tiết hạng mục</span>
            <span className="ml-auto text-[10px] font-normal text-teal-700">{groupHoursPeriodLabel}</span>
            <ChevronDownIcon className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t border-teal-100 px-2.5 pb-2.5">
            <p className="flex items-start gap-1.5 py-2 text-xs text-teal-900"><MapPinIcon className="h-4 w-4 shrink-0" /><span className="min-w-0 break-words">Vùng: <b>{bando.vung || "—"}</b></span></p>
            <p className="mb-2 text-[10px] leading-relaxed text-muted">Số liệu dự án ở trên · Giờ thực tế ở dưới</p>
            <dl className="grid grid-cols-3 gap-1.5">
              {BANDO_HOUR_COLUMNS.map(column => {
                const entered = revenueBandoValue(bando, column.key);
                const ticked = isBanDoTicked(bando.hovermaps);
                return (
                  <div key={column.key} data-revenue-metric={column.key} className="min-w-0 rounded-lg border border-teal-100 bg-white px-1.5 py-2 text-center" title={column.title}>
                    <dt className="break-words text-[10px] font-semibold text-teal-800">{column.label}</dt>
                    <dd className="mt-1">
                      {column.key === "hovermaps" ? (
                        <span className={`flex min-h-5 items-center justify-center gap-0.5 text-[10px] ${ticked ? "font-semibold text-teal-700" : "text-muted"}`}>
                          {ticked ? <CheckIcon className="h-3 w-3 shrink-0" /> : <MinusIcon className="h-3 w-3 shrink-0" />}{ticked ? "Đã tích" : "Chưa tích"}
                        </span>
                      ) : <span className={`block min-h-5 break-words text-[11px] tnum ${entered ? "font-semibold text-steel" : "text-slate-400"}`}>{entered || "—"}</span>}
                      <span className={`mt-1 block border-t border-line/50 pt-1 text-xs tnum ${hours[column.key] > 0 ? "font-bold text-ink" : "text-slate-400"}`}>{formatGroupHours(hours[column.key])}</span>
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        </details>
      )}
    </article>
  );
}
