"use client";

// Biểu đồ TIẾN ĐỘ THEO NGÀY — vẽ đường % hoàn thành theo thời gian.
// 1 đường "Toàn dự án" + mỗi phòng ban 1 đường -> xem từng ngày ai/phòng nào
// làm tới đâu, và mất bao nhiêu ngày để hoàn thành. Dữ liệu tự chốt mỗi ngày.

import { useEffect, useMemo, useState } from "react";
import { PresentationChartLineIcon, ArrowPathIcon } from "@heroicons/react/24/outline";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { ProgressPoint } from "@/lib/types";

const OVERALL_COLOR = "#0f172a"; // ink — đường tổng nổi bật
const DEPT_COLORS = ["#2563eb", "#16a34a", "#d97706", "#7c3aed", "#dc2626", "#0891b2"];

const shortDate = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
};
const diffDays = (a: string, b: string) =>
  Math.round((new Date(b + "T00:00:00").getTime() - new Date(a + "T00:00:00").getTime()) / 86_400_000);

export default function ProgressTimeline({ projectId }: { projectId: number }) {
  const [snaps, setSnaps] = useState<ProgressPoint[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .progressHistory(projectId)
      .then((h) => alive && setSnaps(h.snapshots))
      .catch(() => alive && setSnaps([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [projectId]);

  const { dates, series, stats } = useMemo(() => {
    const list = snaps || [];
    const dates = Array.from(new Set(list.map((s) => s.date))).sort();
    const keys = Array.from(new Set(list.map((s) => s.department)));
    keys.sort((a, b) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b, "vi")));
    let deptIdx = 0;
    const series = keys.map((k) => {
      const color = k === "" ? OVERALL_COLOR : DEPT_COLORS[deptIdx++ % DEPT_COLORS.length];
      const points = list
        .filter((s) => s.department === k)
        .sort((a, b) => a.date.localeCompare(b.date));
      return {
        key: k,
        label: k === "" ? "Toàn dự án" : k,
        color,
        points,
        last: points.length ? points[points.length - 1].percent : 0,
      };
    });
    const overall = series.find((s) => s.key === "")?.points ?? [];
    const firstDate = overall[0]?.date;
    const lastDate = overall[overall.length - 1]?.date;
    const startWork = overall.find((p) => p.percent > 0)?.date;
    const doneDate = overall.find((p) => p.percent >= 100)?.date;
    return {
      dates,
      series,
      stats: {
        firstDate,
        lastDate,
        lastPct: overall.length ? overall[overall.length - 1].percent : 0,
        daysTracked: firstDate && lastDate ? diffDays(firstDate, lastDate) + 1 : 0,
        daysToDone: startWork && doneDate ? diffDays(startWork, doneDate) + 1 : null,
        doneDate,
      },
    };
  }, [snaps]);

  if (loading) {
    return <p className="py-10 text-center text-xs text-muted">Đang tải biểu đồ tiến độ…</p>;
  }
  if (!dates.length) {
    return (
      <div className="rounded-xl2 border border-line bg-white p-6 text-center shadow-card">
        <PresentationChartLineIcon className="mx-auto h-9 w-9 text-line" />
        <p className="mt-2 text-xs text-muted">
          Chưa có dữ liệu tiến độ theo ngày. Khi có người cập nhật % ở tab <b>Hạng mục</b>,
          hệ thống sẽ tự ghi lại mỗi ngày và vẽ đường tiến độ ở đây.
        </p>
      </div>
    );
  }

  // ----- Toạ độ SVG -----
  const W = 640, H = 240, padL = 34, padR = 14, padT = 14, padB = 26;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const dateIndex = new Map(dates.map((d, i) => [d, i]));
  const xAt = (iso: string) =>
    padL + (dates.length <= 1 ? innerW / 2 : (innerW * (dateIndex.get(iso) ?? 0)) / (dates.length - 1));
  const yAt = (pct: number) => padT + innerH * (1 - Math.max(0, Math.min(100, pct)) / 100);

  // Nhãn trục X: hiện tối đa ~6 mốc để khỏi chen chúc.
  const step = Math.max(1, Math.ceil(dates.length / 6));
  const xLabels = dates.filter((_, i) => i % step === 0 || i === dates.length - 1);

  return (
    <div className="space-y-3 rounded-xl2 border border-line bg-white p-3 shadow-card lg:p-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-steel">
          <PresentationChartLineIcon className="h-4 w-4" />
          Đường tiến độ theo ngày
        </h3>
        <button
          onClick={() => {
            setLoading(true);
            api.progressHistory(projectId).then((h) => setSnaps(h.snapshots)).catch(() => {}).finally(() => setLoading(false));
          }}
          className="flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[11px] font-semibold text-muted hover:bg-paper"
          title="Làm mới"
        >
          <ArrowPathIcon className="h-3.5 w-3.5" />
          Làm mới
        </button>
      </div>

      {/* Số liệu nhanh */}
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted">
        <span>
          Theo dõi từ <b className="text-ink">{stats.firstDate ? formatDate(stats.firstDate) : "—"}</b>
          {" · "}<b className="text-ink">{stats.daysTracked}</b> ngày
        </span>
        <span>
          Hiện tại: <b className="text-ink">{Math.round(stats.lastPct)}%</b>
        </span>
        {stats.doneDate && stats.daysToDone != null && (
          <span className="text-ok">
            ✓ Hoàn thành {formatDate(stats.doneDate)} — mất <b>{stats.daysToDone}</b> ngày
          </span>
        )}
      </div>

      {/* Biểu đồ */}
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[420px]" role="img" aria-label="Biểu đồ tiến độ theo ngày">
          {/* Lưới ngang + nhãn % */}
          {[0, 25, 50, 75, 100].map((g) => (
            <g key={g}>
              <line x1={padL} y1={yAt(g)} x2={W - padR} y2={yAt(g)} stroke="#e5e7eb" strokeWidth={1} />
              <text x={padL - 6} y={yAt(g) + 3} textAnchor="end" fontSize={9} fill="#9ca3af">{g}</text>
            </g>
          ))}
          {/* Nhãn ngày trục X */}
          {xLabels.map((d) => (
            <text key={d} x={xAt(d)} y={H - 8} textAnchor="middle" fontSize={9} fill="#9ca3af">
              {shortDate(d)}
            </text>
          ))}
          {/* Đường của từng series */}
          {series.filter((s) => !hidden.has(s.key)).map((s) => {
            const pts = s.points.map((p) => `${xAt(p.date)},${yAt(p.percent)}`).join(" ");
            const isOverall = s.key === "";
            return (
              <g key={s.key}>
                {s.points.length > 1 && (
                  <polyline
                    points={pts}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={isOverall ? 2.5 : 1.6}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    opacity={isOverall ? 1 : 0.9}
                  />
                )}
                {s.points.map((p) => (
                  <circle key={p.date} cx={xAt(p.date)} cy={yAt(p.percent)} r={isOverall ? 2.6 : 2} fill={s.color}>
                    <title>{`${s.label} · ${formatDate(p.date)} · ${Math.round(p.percent)}%`}</title>
                  </circle>
                ))}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Chú giải (bấm để ẩn/hiện đường) */}
      <div className="flex flex-wrap gap-2">
        {series.map((s) => {
          const off = hidden.has(s.key);
          return (
            <button
              key={s.key}
              onClick={() =>
                setHidden((prev) => {
                  const n = new Set(prev);
                  if (n.has(s.key)) n.delete(s.key);
                  else n.add(s.key);
                  return n;
                })
              }
              className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-opacity ${
                off ? "border-line text-muted opacity-50" : "border-line text-ink"
              }`}
              title={off ? "Bấm để hiện" : "Bấm để ẩn"}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
              {s.label}
              <span className="text-muted">{Math.round(s.last)}%</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
