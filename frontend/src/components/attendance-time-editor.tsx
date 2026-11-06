"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { PencilSquareIcon } from "@heroicons/react/24/outline";
import { api } from "@/lib/api";
import type { Attendance } from "@/lib/types";

export default function AttendanceTimeEditor({ record, onSaved, formTargetId }: {
  record: Attendance;
  onSaved: (updated: Attendance) => void;
  formTargetId?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (!checkIn && !checkOut) { setError("Phải giữ ít nhất một mốc giờ."); return; }
    if (checkIn && checkOut && checkOut < checkIn) { setError("Giờ ra không được sớm hơn giờ vào."); return; }
    setSaving(true);
    setError("");
    try {
      const payload: { check_in?: string | null; check_out?: string | null } = {};
      if (checkIn !== (record.check_in?.slice(11, 16) || "")) {
        payload.check_in = checkIn ? `${record.work_date}T${checkIn}:00+07:00` : null;
      }
      if (checkOut !== (record.check_out?.slice(11, 16) || "")) {
        payload.check_out = checkOut ? `${record.work_date}T${checkOut}:00+07:00` : null;
      }
      if (!Object.keys(payload).length) { setEditing(false); return; }
      const updated = await api.updateAttendance(record.id, payload);
      onSaved(updated);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không lưu được giờ chấm công.");
    } finally { setSaving(false); }
  }

  if (!editing) return (
    <button type="button" title="Sửa giờ vào/ra" aria-label="Sửa giờ vào/ra" className="shrink-0 rounded p-1 text-steel hover:bg-white"
      onClick={() => {
        setCheckIn(record.check_in?.slice(11, 16) || "");
        setCheckOut(record.check_out?.slice(11, 16) || "");
        setError("");
        setEditing(true);
      }}>
      <PencilSquareIcon className="h-4 w-4" />
    </button>
  );

  const editor = (
    <div className="flex max-w-full flex-wrap items-end gap-2 whitespace-normal">
      <label className="text-[10px] text-muted">Giờ vào
        <input type="time" value={checkIn} disabled={saving} onChange={(e) => setCheckIn(e.target.value)}
          className="block rounded border border-line bg-white px-2 py-1 text-xs text-ink" />
      </label>
      <label className="text-[10px] text-muted">Giờ ra
        <input type="time" value={checkOut} disabled={saving} onChange={(e) => setCheckOut(e.target.value)}
          className="block rounded border border-line bg-white px-2 py-1 text-xs text-ink" />
      </label>
      <button type="button" disabled={saving} onClick={save} className="rounded bg-steel px-2 py-1 text-xs text-white disabled:opacity-50">{saving ? "Đang lưu…" : "Lưu"}</button>
      <button type="button" disabled={saving} onClick={() => setEditing(false)} className="rounded border border-line px-2 py-1 text-xs text-muted">Hủy</button>
      {error && <p role="alert" className="w-full text-xs text-bad">{error}</p>}
    </div>
  );
  const target = formTargetId ? document.getElementById(formTargetId) : null;
  return target ? createPortal(editor, target) : editor;
}
