import { formatReconciliationDateTime, formatReconciliationTime, RECONCILIATION_LABELS, reconciliationLeavePath, sessionBasis } from "../lib/attendance-reconciliation";
import type { AttendanceReconciliationRow, AttendanceSession, AttendanceSessionResult } from "../lib/types";

function statusClass(status: AttendanceSessionResult["status"]) {
  if (["UNEXCUSED_ABSENCE", "UNEXCUSED_LATE"].includes(status)) return "bg-rose-100 text-rose-800";
  if (["WAITING_DATA", "NEEDS_REVIEW", "PENDING_APPROVAL"].includes(status)) return "bg-amber-100 text-amber-900";
  if (["PRESENT", "EXCUSED_ABSENCE", "EXCUSED_LATE"].includes(status)) return "bg-emerald-100 text-emerald-800";
  return "bg-slate-100 text-slate-600";
}

export default function AttendanceReconciliationResults({ rows, loading, error, hasData, filtered, isAdmin, onPermission }: {
  rows: AttendanceReconciliationRow[];
  loading: boolean;
  error: string | null;
  hasData: boolean;
  filtered: boolean;
  isAdmin: boolean;
  onPermission: (row: AttendanceReconciliationRow, session: AttendanceSession) => void;
}) {
  return <div className="mt-3 space-y-3" aria-busy={loading}>
    {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-xs text-bad">{error}{hasData && " · Đang hiển thị lần tải thành công gần nhất."}</p>}
    {loading && !hasData && <p role="status" className="p-4 text-center text-xs text-muted">Đang tải đối chiếu…</p>}
    {hasData && rows.length === 0 && !error && <p className="p-4 text-center text-xs text-muted">{filtered ? "Không có kết quả khớp bộ lọc." : "Không có nhân sự trong phạm vi ngày đã chọn."}</p>}
    {hasData && <div className="grid items-start gap-3 xl:grid-cols-2">{rows.map(row => <article key={`${row.user_id}-${row.work_date}`} className="min-w-0 rounded-xl border border-line p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h3 className="text-sm font-semibold text-ink">{row.full_name}</h3><p className="text-xs text-muted">{row.department || "Chưa có phòng ban"}</p></div>
        <p className="text-xs text-muted">Mốc chấm thực tế: <span className="font-medium text-ink">{formatReconciliationTime(row.check_in)} – {formatReconciliationTime(row.check_out)}</span></p>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">{([row.morning, row.afternoon]).map(result => <section key={result.session} className="min-w-0 rounded-lg bg-slate-50 p-2 text-xs">
        <div className="flex flex-wrap items-center gap-1.5"><b>{result.session === "AM" ? "Buổi sáng" : "Buổi chiều"}</b><span className={`rounded-full px-2 py-0.5 font-semibold ${statusClass(result.status)}`}>{RECONCILIATION_LABELS[result.status]}</span>
          {result.late_minutes > 0 && <span className="text-muted">Muộn {result.late_minutes} phút</span>}</div>
        <p className="mt-2 font-medium text-steel">Căn cứ: {sessionBasis(result)}</p>
        <p className="mt-1 whitespace-pre-wrap break-words text-slate-700">{result.explanation}</p>
        {result.leave_id !== null && <a className="mt-1 inline-block font-semibold text-steel underline" href={reconciliationLeavePath(result.leave_id)}>Xem đơn #{result.leave_id}</a>}
        {result.override && <dl className="mt-2 space-y-1 break-words text-slate-700">
          <div><dt className="inline font-semibold">Người cho phép: </dt><dd className="inline">{result.override.approved_by}</dd></div>
          <div><dt className="inline font-semibold">Lý do: </dt><dd className="inline whitespace-pre-wrap">{result.override.reason}</dd></div>
          <div className="text-[11px] text-muted"><dt className="inline">Người ghi nhận: </dt><dd className="inline">{result.override.recorded_by} · {formatReconciliationDateTime(result.override.updated_at)}</dd></div>
        </dl>}
        {isAdmin && <button type="button" onClick={() => onPermission(row, result.session)} className="mt-2 rounded-lg border border-line bg-white px-3 py-1.5 font-semibold text-steel">{result.override ? "Sửa / đặt lại phép" : "Xác nhận phép"}</button>}
      </section>)}</div>
    </article>)}</div>}
  </div>;
}
