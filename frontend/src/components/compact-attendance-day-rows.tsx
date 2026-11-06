import { PencilSquareIcon } from "@heroicons/react/24/outline";
import { formatReconciliationTime } from "../lib/attendance-reconciliation";
import type { CompactAttendanceDay, CompactDayBadge } from "../lib/compact-attendance-days";

const badgeClass: Record<CompactDayBadge["tone"], string> = {
  good: "border-emerald-200 bg-emerald-50 text-emerald-700", bad: "border-rose-200 bg-rose-50 text-rose-700",
  waiting: "border-amber-200 bg-amber-50 text-amber-800", muted: "border-slate-200 bg-slate-100 text-slate-500",
};
const shortDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
const weekday = (date: string) => new Date(`${date}T00:00:00+07:00`).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", weekday: "short" });

export default function CompactAttendanceDayRows({ days, isAdmin, notes, noteErrors, noteSaving, onEdit, onNoteChange, onNoteSave }: {
  days: CompactAttendanceDay[];
  isAdmin: boolean;
  notes: Record<number, string>;
  noteErrors: Record<number, string>;
  noteSaving: Record<number, boolean>;
  onEdit: (day: CompactAttendanceDay) => void;
  onNoteChange: (id: number, value: string) => void;
  onNoteSave: (day: CompactAttendanceDay) => void;
}) {
  return <div className="space-y-1.5">{days.map(day => {
    const record = day.record;
    return <div key={day.work_date} data-work-date={day.work_date} data-attendance-id={record?.id}
      className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1.5 rounded-lg px-2.5 py-1.5 text-xs sm:flex sm:flex-wrap sm:gap-2 ${day.future ? "bg-slate-50 text-slate-400" : "bg-paper"}`}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 sm:shrink-0">
        <span className={`shrink-0 font-medium ${day.future ? "text-slate-400" : "text-ink"}`}>{weekday(day.work_date)}, {shortDate(day.work_date)}</span>
        {isAdmin && !day.future && (day.result?.can_edit_permission !== false || record?.check_in || record?.check_out) && <button type="button" title="Sửa phép / giờ chấm công" aria-label={`Sửa chấm công ngày ${shortDate(day.work_date)}`} onClick={() => onEdit(day)} className="shrink-0 rounded p-1 text-steel hover:bg-white"><PencilSquareIcon className="h-4 w-4" /></button>}
        {day.badges.map((badge, index) => <span key={index} title={badge.title} aria-label={`${badge.label}. ${badge.title}`} className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${badgeClass[badge.tone]}`}>{badge.label}</span>)}
      </div>
      {record && <input type="text" aria-label={`Ghi chú ngày ${shortDate(day.work_date)}`} value={notes[record.id] ?? record.note ?? ""}
        onChange={event => onNoteChange(record.id, event.target.value)} onBlur={() => onNoteSave(day)} onKeyDown={event => event.key === "Enter" && event.currentTarget.blur()}
        placeholder={noteSaving[record.id] ? "Đang lưu…" : "Ghi chú lý do..."}
        className="col-span-2 row-start-2 w-full min-w-0 rounded border border-line/70 bg-white px-2 py-1 text-[11px] text-ink outline-none placeholder:text-slate-300 focus:border-steel sm:order-none sm:w-auto sm:min-w-[100px] sm:max-w-[260px] sm:flex-1" />}
      <div className="col-start-2 row-start-1 ml-auto flex shrink-0 items-center gap-2 whitespace-nowrap tnum sm:gap-3">
        <span className={day.future ? "text-slate-400" : "text-ink"}>{formatReconciliationTime(record?.check_in)} – {formatReconciliationTime(record?.check_out)}</span>
        <span className="min-w-[2.5rem] text-right font-bold text-steel">{record ? `${(record.worked_minutes / 60).toFixed(1)}h` : "—"}</span>
      </div>
      {record && noteErrors[record.id] && <span role="alert" className="col-span-2 w-full text-[11px] text-bad">{noteErrors[record.id]}</span>}
    </div>;
  })}</div>;
}
