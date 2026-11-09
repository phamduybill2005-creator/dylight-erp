"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import { filterReconciliationRows, formatReconciliationDateTime, permissionPayload, RECONCILIATION_LABELS, type PermissionDraft, type ReconciliationFilters } from "@/lib/attendance-reconciliation";
import type { AttendanceReconciliation, AttendanceReconciliationRow, AttendanceSession, User } from "@/lib/types";
import AttendanceReconciliationResults from "./attendance-reconciliation-results";

const inputClass = "mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-xs text-ink outline-none focus:border-steel disabled:opacity-50";
const buttonClass = "rounded-lg border border-line bg-white px-3 py-2 text-xs font-semibold text-steel disabled:opacity-50";
type PermissionTarget = { row: AttendanceReconciliationRow; session: AttendanceSession };

export default function AttendanceReconciliationPanel({ date, user, userId }: { date: string; user: User; userId?: number }) {
  const isAdmin = user.role === "ADMIN" && (api.realUser()?.role || user.role) === "ADMIN";
  const [data, setData] = useState<AttendanceReconciliation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const mounted = useRef(false);
  const [filters, setFilters] = useState<ReconciliationFilters>({ department: "", status: "", attentionOnly: false });
  const [target, setTarget] = useState<PermissionTarget | null>(null);
  const [draft, setDraft] = useState<PermissionDraft>({ decision: "EXCUSED_LATE", reason: "", approved_by: "" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [coverageReason, setCoverageReason] = useState({ AM: "", PM: "" });
  const [coverageError, setCoverageError] = useState<Partial<Record<AttendanceSession, string>>>({});
  const [confirming, setConfirming] = useState<AttendanceSession | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const requestSequence = ++sequence.current;
    setLoading(true);
    try {
      const result = await api.attendanceReconciliation(date, date, userId);
      if (!mounted.current || requestSequence !== sequence.current) return;
      setData(result);
      setError(null);
    } catch (err) {
      if (!mounted.current || requestSequence !== sequence.current) return;
      setError(err instanceof Error ? err.message : "Không tải được kết quả đối chiếu.");
    } finally {
      if (mounted.current && requestSequence === sequence.current) setLoading(false);
    }
  }, [date, userId]);

  useEffect(() => {
    mounted.current = true;
    setData(null);
    setError(null);
    reload();
    return () => { mounted.current = false; ++sequence.current; };
  }, [reload]);
  useAutoRefresh(reload, { topics: ["attendance", "leave", "schedule", "users"], intervalMs: 20_000 });
  useEffect(() => {
    const refresh = () => { void reload(); };
    window.addEventListener("attendance-reconciliation-changed", refresh);
    return () => window.removeEventListener("attendance-reconciliation-changed", refresh);
  }, [reload]);

  function openPermission(row: AttendanceReconciliationRow, session: AttendanceSession) {
    const result = session === "AM" ? row.morning : row.afternoon;
    const current = result.override;
    const absence = ["EXCUSED_ABSENCE", "UNEXCUSED_ABSENCE"].includes(result.status)
      || (result.status === "WAITING_DATA" && !row.check_in && !row.check_out);
    setTarget({ row, session });
    setDraft({ decision: current?.decision || (absence ? "EXCUSED_ABSENCE" : "EXCUSED_LATE"), reason: current?.reason || "", approved_by: current?.approved_by || "" });
    setSaveError(null);
    setSuccess(null);
  }

  async function savePermission(event: React.FormEvent) {
    event.preventDefault();
    if (!target || !isAdmin || saving) return;
    setSaveError(null);
    let payload;
    try { payload = permissionPayload({ user_id: target.row.user_id, work_date: target.row.work_date, session: target.session }, draft); }
    catch (err) { setSaveError((err as Error).message); return; }
    setSaving(true);
    try {
      await api.setAttendancePermission(payload);
      if (!mounted.current) return;
      setTarget(null);
      setSuccess(payload.decision === null ? "Đã đặt lại đối chiếu tự động." : "Đã lưu xác nhận phép.");
      await reload();
    } catch (err) {
      if (mounted.current) setSaveError(err instanceof Error ? err.message : "Không lưu được xác nhận. Dữ liệu nhập vẫn được giữ lại.");
    } finally { if (mounted.current) setSaving(false); }
  }

  async function confirmData(session: AttendanceSession) {
    if (!isAdmin || confirming) return;
    const reason = coverageReason[session].trim();
    if (!reason) { setCoverageError(prev => ({ ...prev, [session]: "Vui lòng ghi lý do / cách kiểm tra dữ liệu nguồn." })); return; }
    setConfirming(session);
    setCoverageError(prev => ({ ...prev, [session]: "" }));
    try {
      await api.confirmAttendanceData({ work_date: date, session, reason });
      if (!mounted.current) return;
      setCoverageReason(prev => ({ ...prev, [session]: "" }));
      setSuccess(`Đã xác nhận kiểm tra đủ dữ liệu buổi ${session === "AM" ? "sáng" : "chiều"}.`);
      await reload();
    } catch (err) {
      if (mounted.current) setCoverageError(prev => ({ ...prev, [session]: err instanceof Error ? err.message : "Không xác nhận được dữ liệu nguồn." }));
    } finally { if (mounted.current) setConfirming(null); }
  }

  const rows = data?.rows || [];
  const departments = Array.from(new Set(rows.flatMap(row => (row.department || "").split(",").map(d => d.trim()).filter(Boolean)))).sort((a, b) => a.localeCompare(b, "vi"));
  const shownRows = filterReconciliationRows(rows, filters);
  return <section className="mt-4 rounded-xl2 bg-white p-4 shadow-card lg:p-6">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-bold text-ink lg:text-base">Đối chiếu nghỉ phép và chấm công · {date.split("-").reverse().join("/")}</h2><button type="button" disabled={loading} onClick={() => void reload()} className={buttonClass}>{loading ? "Đang tải…" : "Làm mới"}</button></div>
    <p className="mt-2 text-xs text-muted">Đối chiếu riêng từng buổi theo lịch làm, mốc chấm công thực tế và đơn đã duyệt. Dữ liệu thiếu chỉ kết luận sau khi kiểm tra nguồn.</p>
    {success && <p role="status" className="mt-2 text-xs text-emerald-700">{success}</p>}
    <div className="mt-3 flex flex-wrap items-end gap-3">
      {userId === undefined && <label className="text-xs text-muted">Phòng ban<select value={filters.department} onChange={e => setFilters(prev => ({ ...prev, department: e.target.value }))} className={inputClass}><option value="">Tất cả phòng ban</option>{departments.map(dept => <option key={dept}>{dept}</option>)}</select></label>}
      <label className="text-xs text-muted">Trạng thái<select value={filters.status} onChange={e => setFilters(prev => ({ ...prev, status: e.target.value as ReconciliationFilters["status"] }))} className={inputClass}><option value="">Tất cả trạng thái</option>{Object.entries(RECONCILIATION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="flex items-center gap-2 py-2 text-xs font-medium text-ink"><input type="checkbox" checked={filters.attentionOnly} onChange={e => setFilters(prev => ({ ...prev, attentionOnly: e.target.checked }))} />Cần xử lý</label>
      {data && <p className="py-2 text-xs text-muted">{shownRows.length} / {rows.length} nhân sự</p>}
    </div>
    <AttendanceReconciliationResults rows={shownRows} hasData={data !== null} loading={loading} error={error} filtered={!!(filters.department || filters.status || filters.attentionOnly)} isAdmin={isAdmin && !error} onPermission={openPermission} />

    {data && <div className="mt-4 border-t border-line pt-3"><h3 className="text-xs font-semibold text-ink">Kiểm tra dữ liệu nguồn theo buổi</h3><p className="mt-1 text-xs text-muted">Quản trị chỉ xác nhận sau khi ca kết thúc và đã kiểm tra dữ liệu máy / nguồn chấm công đầy đủ cho toàn công ty trong buổi đó.</p><div className="mt-3 grid gap-3 md:grid-cols-2">
      {(["AM", "PM"] as const).map(session => {
        const confirmation = data.confirmations.find(item => item.work_date === date && item.session === session);
        const available = data.confirmation_available?.[session] === true;
        return <div key={session} className="rounded-lg border border-line p-3 text-xs"><b>{session === "AM" ? "Buổi sáng" : "Buổi chiều"}</b>
          {confirmation ? <><p className="mt-1 text-emerald-700">Đã kiểm tra đủ dữ liệu · {confirmation.confirmed_by} · {formatReconciliationDateTime(confirmation.confirmed_at)}</p><p className="mt-1 whitespace-pre-wrap break-words text-muted">{confirmation.reason}</p></> : <p className="mt-1 text-muted">{available ? "Chưa xác nhận dữ liệu nguồn đầy đủ." : "Chưa hết ca; chưa thể xác nhận đủ dữ liệu nguồn."}</p>}
          {isAdmin && available && !confirmation && <form onSubmit={e => { e.preventDefault(); void confirmData(session); }}>
            <label className="mt-2 block text-muted">Lý do / cách kiểm tra *<textarea required maxLength={2000} value={coverageReason[session]} disabled={confirming !== null} onChange={e => setCoverageReason(prev => ({ ...prev, [session]: e.target.value }))} className={inputClass} /></label>
            <button type="submit" disabled={confirming !== null || !!error || !coverageReason[session].trim()} className={`mt-2 ${buttonClass}`}>{confirming === session ? "Đang xác nhận…" : "Xác nhận đã kiểm tra đủ dữ liệu"}</button>
            {coverageError[session] && <p role="alert" className="mt-1 text-bad">{coverageError[session]}</p>}
          </form>}
        </div>;
      })}</div></div>}

    {target && <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-ink/50 p-4">
      <form role="dialog" aria-modal="true" aria-labelledby="attendance-permission-title" onSubmit={savePermission} className="my-auto w-full max-w-lg space-y-3 rounded-xl2 bg-white p-5 shadow-2xl">
        <h3 id="attendance-permission-title" className="font-bold text-ink">Xác nhận phép · {target.row.full_name}</h3>
        <p className="text-xs text-muted">{target.row.work_date} · {target.session === "AM" ? "Buổi sáng" : "Buổi chiều"}. Xác nhận được lưu riêng với giờ chấm công thực tế.</p>
        <fieldset disabled={saving} className="space-y-3">
          <label className="block text-xs text-muted">Kết luận<select value={draft.decision} onChange={e => setDraft(prev => ({ ...prev, decision: e.target.value as PermissionDraft["decision"] }))} className={inputClass}><option value="EXCUSED_LATE">Muộn có phép</option><option value="EXCUSED_EARLY">Về sớm có phép</option><option value="EXCUSED_LATE_EARLY">Muộn và về sớm có phép</option><option value="EXCUSED_ABSENCE">Nghỉ có phép</option><option value="">Đặt lại tự động (xóa xác nhận phép)</option></select></label>
          <label className="block text-xs text-muted">Người cho phép / xác nhận đặt lại *<input required maxLength={255} value={draft.approved_by} onChange={e => setDraft(prev => ({ ...prev, approved_by: e.target.value }))} className={inputClass} /></label>
          <label className="block text-xs text-muted">Lý do *<textarea required maxLength={2000} value={draft.reason} onChange={e => setDraft(prev => ({ ...prev, reason: e.target.value }))} className={inputClass} /></label>
        </fieldset>
        {saveError && <p role="alert" className="text-xs text-bad">{saveError}</p>}
        <div className="flex justify-end gap-2"><button type="button" disabled={saving} onClick={() => setTarget(null)} className={buttonClass}>Hủy</button><button type="submit" disabled={saving} className="rounded-lg bg-steel px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">{saving ? "Đang lưu…" : "Lưu xác nhận"}</button></div>
      </form>
    </div>}
  </section>;
}
