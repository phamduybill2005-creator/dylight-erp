"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import { buildCompactAttendanceDays, compactMonthRange, compactPermissionPayload, compactSessionBasis, initialCompactPermission, type CompactAttendanceDay, type CompactPermissionDraft } from "@/lib/compact-attendance-days";
import { RECONCILIATION_LABELS, reconciliationLeavePath } from "@/lib/attendance-reconciliation";
import type { Attendance, AttendanceReconciliationRow, User } from "@/lib/types";
import AttendanceTimeEditor from "./attendance-time-editor";
import CompactAttendanceDayRows from "./compact-attendance-day-rows";

const fieldClass = "mt-1 w-full rounded-lg border border-line bg-white px-2.5 py-2 text-xs text-ink outline-none focus:border-steel";
type MonthData = { records: Attendance[]; results: AttendanceReconciliationRow[] };

export default function CompactAttendanceDays({ userId, period, user, onSaved }: {
  userId: number; period: string; user: User; onSaved?: (updated?: Attendance) => void;
}) {
  const isAdmin = user.role === "ADMIN" && (api.realUser()?.role || user.role) === "ADMIN";
  const [data, setData] = useState<MonthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const mounted = useRef(false);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [noteErrors, setNoteErrors] = useState<Record<number, string>>({});
  const [noteSaving, setNoteSaving] = useState<Record<number, boolean>>({});
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [draft, setDraft] = useState<CompactPermissionDraft>({ scope: "ALL", decision: "EXCUSED_ABSENCE", reason: "", approved_by: "" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const latestPermissionAccess = useRef(false);

  const reload = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    try {
      const { from, to } = compactMonthRange(period);
      const [reconciliation, records] = await Promise.all([
        api.attendanceReconciliation(from, to, userId),
        api.attendanceList({ user_id: userId, from_date: from, to_date: to }),
      ]);
      if (!mounted.current || currentRequest !== requestId.current) return;
      setData({ records, results: reconciliation.rows });
      setError(null);
    } catch (err) {
      if (mounted.current && currentRequest === requestId.current) setError(err instanceof Error ? err.message : "Không tải được chi tiết chấm công.");
    } finally {
      if (mounted.current && currentRequest === requestId.current) setLoading(false);
    }
  }, [period, userId]);

  useEffect(() => {
    mounted.current = true;
    setData(null); setNotes({}); setNoteErrors({}); setEditingDate(null); setError(null);
    void reload();
    return () => { mounted.current = false; ++requestId.current; };
  }, [reload]);
  useAutoRefresh(reload, { topics: ["attendance", "leave", "schedule"], intervalMs: 20_000 });
  useEffect(() => {
    const refresh = () => { void reload(); };
    window.addEventListener("attendance-reconciliation-changed", refresh);
    return () => window.removeEventListener("attendance-reconciliation-changed", refresh);
  }, [reload]);

  const days = data ? buildCompactAttendanceDays(period, userId, data.records, data.results) : [];
  const editingDay = days.find(day => day.work_date === editingDate);
  const canEditPermission = editingDay?.result?.can_edit_permission !== false;
  latestPermissionAccess.current = isAdmin && !!editingDay && !editingDay.future && canEditPermission;

  function openEditor(day: CompactAttendanceDay) {
    if (!isAdmin || day.future) return;
    if (day.result?.can_edit_permission === false && !day.record?.check_in && !day.record?.check_out) return;
    setEditingDate(day.work_date);
    setDraft(initialCompactPermission(day));
    setSaveError(null);
  }

  async function savePermission(event: React.FormEvent) {
    event.preventDefault();
    if (!isAdmin || !editingDay || editingDay.future || !latestPermissionAccess.current || saving) return;
    let payload;
    try { payload = compactPermissionPayload(userId, editingDay.work_date, draft); }
    catch (err) { setSaveError((err as Error).message); return; }
    setSaving(true); setSaveError(null);
    try {
      await api.setAttendanceDayPermission(payload);
      if (!mounted.current) return;
      setEditingDate(null);
      onSaved?.();
      await reload();
    } catch (err) {
      if (mounted.current) setSaveError(err instanceof Error ? err.message : "Không lưu được xác nhận phép. Dữ liệu nhập vẫn được giữ lại.");
    } finally { if (mounted.current) setSaving(false); }
  }

  async function saveNote(day: CompactAttendanceDay) {
    const record = day.record;
    if (!record || noteSaving[record.id]) return;
    const note = notes[record.id] ?? record.note ?? "";
    if (note === (record.note || "")) return;
    setNoteSaving(prev => ({ ...prev, [record.id]: true }));
    setNoteErrors(prev => ({ ...prev, [record.id]: "" }));
    try {
      const updated = await api.updateAttendance(record.id, { note });
      if (!mounted.current) return;
      setData(prev => prev ? { ...prev, records: prev.records.map(item => item.id === updated.id ? updated : item) } : prev);
      setNotes(prev => {
        if (prev[record.id] !== note) return prev;
        const next = { ...prev }; delete next[record.id]; return next;
      });
      onSaved?.(updated);
      await reload();
    } catch (err) {
      if (mounted.current) setNoteErrors(prev => ({ ...prev, [record.id]: err instanceof Error ? err.message : "Không lưu được ghi chú." }));
    } finally { if (mounted.current) setNoteSaving(prev => ({ ...prev, [record.id]: false })); }
  }

  function timeSaved(updated: Attendance) {
    if (!mounted.current) return;
    setData(prev => prev ? { ...prev, records: prev.records.map(item => item.id === updated.id ? updated : item) } : prev);
    onSaved?.(updated);
    void reload();
  }

  return <div aria-busy={loading}>
    {error && <div role="alert" className="mb-2 flex flex-wrap items-center gap-2 text-xs text-bad"><span>Không tải được chi tiết: {error}{data && " · Đang hiển thị dữ liệu đã tải trước đó."}</span><button type="button" onClick={() => void reload()} disabled={loading} className="font-semibold underline">Thử lại</button></div>}
    {loading && !data && <p role="status" className="py-3 text-center text-xs text-muted">Đang tải chi tiết…</p>}
    {data && <CompactAttendanceDayRows days={days} isAdmin={isAdmin && !error} notes={notes} noteErrors={noteErrors} noteSaving={noteSaving} onEdit={openEditor}
      onNoteChange={(id, value) => setNotes(prev => ({ ...prev, [id]: value }))} onNoteSave={day => void saveNote(day)} />}
    {editingDay && createPortal(<div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-ink/50 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="compact-attendance-title" className="my-auto w-full max-w-md rounded-xl2 bg-white p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between gap-2"><h3 id="compact-attendance-title" className="text-sm font-bold text-ink">Chấm công · {editingDay.work_date.split("-").reverse().join("/")}</h3><button type="button" aria-label="Đóng chỉnh sửa" disabled={saving} onClick={() => setEditingDate(null)} className="rounded px-2 py-1 text-sm text-muted">✕</button></div>
        {editingDay.result && <div className="mb-3 space-y-1 text-[11px] text-muted">{[editingDay.result.morning, editingDay.result.afternoon].map(result => <div key={result.session}>
          <b>{result.session === "AM" ? "Sáng" : "Chiều"}: {RECONCILIATION_LABELS[result.status]}</b><span className="block break-words">{compactSessionBasis(result)}</span>
          {result.leave_id !== null && <a href={reconciliationLeavePath(result.leave_id)} className="font-medium text-steel underline">Xem đơn #{result.leave_id}</a>}
        </div>)}</div>}
        {canEditPermission ? <form onSubmit={savePermission} className="space-y-3">
          <fieldset disabled={saving} className="space-y-3">
            <div className="grid grid-cols-2 gap-3"><label className="text-xs text-muted">Buổi<select aria-label="Buổi áp dụng" value={draft.scope} onChange={e => setDraft(prev => ({ ...prev, scope: e.target.value as CompactPermissionDraft["scope"] }))} className={fieldClass}><option value="AM">Sáng</option><option value="PM">Chiều</option><option value="ALL">Cả ngày</option></select></label>
              <label className="text-xs text-muted">Xác nhận<select aria-label="Xác nhận phép" value={draft.decision} onChange={e => setDraft(prev => ({ ...prev, decision: e.target.value as CompactPermissionDraft["decision"] }))} className={fieldClass}><option value="EXCUSED_ABSENCE">Nghỉ có phép</option><option value="EXCUSED_LATE">Muộn có phép</option><option value="">Đặt lại tự động</option></select></label></div>
            {draft.decision === "" && <p className="text-[11px] text-muted">Chỉ gỡ xác nhận của Admin; đơn đã duyệt vẫn áp dụng.</p>}
            <label className="block text-xs text-muted">Người cho phép / xác nhận đặt lại *<input aria-label="Người cho phép" autoFocus required maxLength={255} value={draft.approved_by} onChange={e => setDraft(prev => ({ ...prev, approved_by: e.target.value }))} className={fieldClass} /></label>
            <label className="block text-xs text-muted">Lý do *<textarea aria-label="Lý do xác nhận" required maxLength={2000} rows={2} value={draft.reason} onChange={e => setDraft(prev => ({ ...prev, reason: e.target.value }))} className={fieldClass} /></label>
          </fieldset>
          {saveError && <p role="alert" className="text-xs text-bad">{saveError}</p>}
          <div className="flex justify-end gap-2"><button type="button" disabled={saving} onClick={() => setEditingDate(null)} className="rounded-lg border border-line px-3 py-2 text-xs text-muted">Hủy</button><button type="submit" disabled={saving} className="rounded-lg bg-steel px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{saving ? "Đang lưu…" : "Lưu xác nhận"}</button></div>
        </form> : <p className="text-xs text-muted">Xác nhận phép chỉ đọc cho nhân sự này.</p>}
        {editingDay.record && (editingDay.record.check_in || editingDay.record.check_out) && <fieldset disabled={saving} className="mt-3 border-t border-line pt-3"><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold text-ink">Giờ chấm công thực tế</span><AttendanceTimeEditor record={editingDay.record} onSaved={timeSaved} /></div></fieldset>}
      </div>
    </div>, document.body)}
  </div>;
}
