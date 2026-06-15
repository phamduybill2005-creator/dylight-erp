"use client";

// Trang Thiết bị — danh mục máy móc/thiết bị + nhật ký điều động.
// Chỉ Quản lý trở lên (isManagerUp). Vai trò thấp hơn bị chặn.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  TruckIcon, PlusIcon, ClipboardDocumentListIcon,
  XMarkIcon, CheckIcon,
} from "@heroicons/react/24/outline";
import AppShell from "@/components/app-shell";
import { api } from "@/lib/api";
import { isManagerUp } from "@/lib/roles";
import { formatDate } from "@/lib/format";
import type { Equipment, EquipmentLog, Project, User } from "@/lib/types";

const STATUS_LABEL: Record<string, string> = {
  IDLE: "Rảnh",
  IN_USE: "Đang dùng",
  MAINTENANCE: "Bảo trì",
};
const STATUS_CLS: Record<string, string> = {
  IDLE: "bg-ok/10 text-ok",
  IN_USE: "bg-steel/10 text-steel",
  MAINTENANCE: "bg-amber/15 text-amber-deep",
};
const STATUSES = ["IDLE", "IN_USE", "MAINTENANCE"] as const;

const emptyEquip = { code: "", name: "", status: "IDLE", note: "" };
const emptyLog = {
  equipment_id: 0, project_id: 0, log_date: "",
  hours_used: "", fuel: "", note: "",
};

export default function EquipmentPage() {
  const router = useRouter();
  const [me, setMe] = useState<User | null>(null);
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [logs, setLogs] = useState<EquipmentLog[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);

  const [equipForm, setEquipForm] = useState(emptyEquip);
  const [showEquipForm, setShowEquipForm] = useState(false);
  const [logForm, setLogForm] = useState(emptyLog);
  const [showLogForm, setShowLogForm] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.me()
      .then((u) => {
        setMe(u);
        if (!isManagerUp(u.role)) { setDenied(true); setLoading(false); return; }
        Promise.all([
          api.equipment().then(setEquipment).catch(() => {}),
          api.equipmentLogs().then(setLogs).catch(() => {}),
          api.projects().then(setProjects).catch(() => {}),
        ]).finally(() => setLoading(false));
      })
      .catch(() => router.push("/login"));
  }, [router]);

  function openEquipCreate() { setEquipForm(emptyEquip); setShowEquipForm(true); }
  function openLogCreate(eq?: Equipment) {
    setLogForm({ ...emptyLog, equipment_id: eq ? eq.id : 0 });
    setShowLogForm(true);
  }

  async function reloadLogs() {
    try { setLogs(await api.equipmentLogs()); } catch { /* noop */ }
  }

  async function saveEquip(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const cr = await api.createEquipment({
        name: equipForm.name.trim(),
        code: equipForm.code || null,
        status: equipForm.status,
        note: equipForm.note || null,
      });
      setEquipment((xs) => [...xs, cr]);
      setShowEquipForm(false);
    } catch { /* noop */ } finally { setSaving(false); }
  }

  async function saveLog(e: React.FormEvent) {
    e.preventDefault();
    if (!logForm.equipment_id) return;
    setSaving(true);
    try {
      await api.createEquipmentLog({
        equipment_id: logForm.equipment_id,
        project_id: logForm.project_id || null,
        log_date: logForm.log_date || null,
        hours_used: logForm.hours_used ? Number(logForm.hours_used) : 0,
        fuel: logForm.fuel ? Number(logForm.fuel) : 0,
        note: logForm.note || null,
      });
      await reloadLogs();
      setShowLogForm(false);
    } catch { /* noop */ } finally { setSaving(false); }
  }

  if (denied) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-paper p-4 text-center">
        <XMarkIcon className="h-16 w-16 text-bad" />
        <h1 className="mt-4 text-lg font-bold text-ink">Không có quyền truy cập</h1>
        <p className="mt-2 max-w-xs text-sm text-muted">Quản lý thiết bị chỉ dành cho cấp Quản lý trở lên.</p>
        <button onClick={() => router.push("/")} className="mt-4 rounded-xl2 bg-ink px-4 py-2 text-xs font-semibold text-white">Về trang chủ</button>
      </div>
    );
  }
  if (loading || !me) {
    return <div className="flex min-h-screen items-center justify-center bg-paper"><div className="h-8 w-8 animate-spin rounded-full border-4 border-steel border-t-amber" /></div>;
  }

  return (
    <AppShell>
      <header className="flex items-center justify-between rounded-xl2 bg-ink p-4 lg:p-6 text-white shadow-card">
        <div className="flex items-center gap-2">
          <TruckIcon className="h-5 w-5 text-amber" />
          <h1 className="text-base lg:text-xl font-bold">Quản lý Thiết bị</h1>
        </div>
        <div className="flex gap-2">
          <button onClick={() => openLogCreate()} className="flex items-center gap-1.5 rounded-xl2 bg-steel px-3 py-2 text-xs font-semibold text-white">
            <ClipboardDocumentListIcon className="h-4 w-4" /> Ghi nhật ký
          </button>
          <button onClick={openEquipCreate} className="flex items-center gap-1.5 rounded-xl2 bg-amber px-3 py-2 text-xs font-semibold text-ink">
            <PlusIcon className="h-4 w-4" /> Thêm thiết bị
          </button>
        </div>
      </header>

      {/* Bảng thiết bị */}
      <h2 className="mt-5 mb-2 text-sm font-bold text-ink">Danh sách thiết bị</h2>
      <div className="overflow-x-auto rounded-xl2 border border-line bg-white shadow-card">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="bg-paper text-left text-[11px] uppercase tracking-wide text-muted">
              <th className="border border-line px-3 py-2">Mã</th>
              <th className="border border-line px-3 py-2">Tên thiết bị</th>
              <th className="border border-line px-3 py-2">Trạng thái</th>
              <th className="border border-line px-3 py-2">Ghi chú</th>
              <th className="border border-line px-3 py-2 text-center w-28">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {equipment.length === 0 && (
              <tr><td colSpan={5} className="border border-line px-3 py-6 text-center text-muted">Chưa có thiết bị nào.</td></tr>
            )}
            {equipment.map((eq) => (
              <tr key={eq.id} className="odd:bg-white even:bg-paper/40 hover:bg-amber/10">
                <td className="border border-line px-3 py-2 font-mono text-[12px] text-muted">{eq.code || "—"}</td>
                <td className="border border-line px-3 py-2 font-semibold text-ink">{eq.name}</td>
                <td className="border border-line px-3 py-2">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_CLS[eq.status] || "bg-paper text-muted"}`}>
                    {STATUS_LABEL[eq.status] || eq.status}
                  </span>
                </td>
                <td className="border border-line px-3 py-2 text-muted">{eq.note || "—"}</td>
                <td className="border border-line px-3 py-2">
                  <div className="flex items-center justify-center">
                    <button onClick={() => openLogCreate(eq)} className="flex items-center gap-1 rounded-lg bg-steel/10 px-2 py-1 text-[11px] font-semibold text-steel hover:bg-steel/20">
                      <ClipboardDocumentListIcon className="h-3.5 w-3.5" /> Ghi nhật ký
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Bảng nhật ký điều động */}
      <h2 className="mt-6 mb-2 text-sm font-bold text-ink">Nhật ký điều động</h2>
      <div className="overflow-x-auto rounded-xl2 border border-line bg-white shadow-card">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="bg-paper text-left text-[11px] uppercase tracking-wide text-muted">
              <th className="border border-line px-3 py-2">Ngày</th>
              <th className="border border-line px-3 py-2">Thiết bị</th>
              <th className="border border-line px-3 py-2">Dự án</th>
              <th className="border border-line px-3 py-2 text-right">Giờ chạy</th>
              <th className="border border-line px-3 py-2 text-right">Nhiên liệu (L)</th>
              <th className="border border-line px-3 py-2">Ghi chú</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && (
              <tr><td colSpan={6} className="border border-line px-3 py-6 text-center text-muted">Chưa có nhật ký điều động.</td></tr>
            )}
            {logs.map((lg) => (
              <tr key={lg.id} className="odd:bg-white even:bg-paper/40 hover:bg-amber/10">
                <td className="border border-line px-3 py-2 whitespace-nowrap text-muted">{lg.log_date ? formatDate(lg.log_date) : "—"}</td>
                <td className="border border-line px-3 py-2 font-semibold text-ink">{lg.equipment_name || "—"}</td>
                <td className="border border-line px-3 py-2 text-muted">{lg.project_name || "—"}</td>
                <td className="border border-line px-3 py-2 text-right tnum">{lg.hours_used}</td>
                <td className="border border-line px-3 py-2 text-right tnum">{lg.fuel}</td>
                <td className="border border-line px-3 py-2 text-muted">{lg.note || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Form thêm thiết bị */}
      {showEquipForm && (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink/50 backdrop-blur-sm">
          <div className="w-full max-w-md bg-paper flex flex-col h-full shadow-2xl animate-slide-in">
            <header className="flex items-center justify-between border-b border-line bg-white px-4 py-3">
              <div className="flex items-center gap-2"><TruckIcon className="h-5 w-5 text-steel" /><h2 className="text-sm font-bold text-ink">Thêm thiết bị</h2></div>
              <button onClick={() => setShowEquipForm(false)} className="rounded-full p-1.5 text-muted hover:bg-paper hover:text-ink"><XMarkIcon className="h-5 w-5" /></button>
            </header>
            <form onSubmit={saveEquip} className="flex-1 overflow-y-auto p-4 space-y-3">
              <Field label="Mã thiết bị" v={equipForm.code} on={(v) => setEquipForm({ ...equipForm, code: v })} />
              <Field label="Tên thiết bị *" v={equipForm.name} on={(v) => setEquipForm({ ...equipForm, name: v })} req />
              <div>
                <label className="block text-[11px] font-semibold text-muted">Trạng thái</label>
                <select value={equipForm.status} onChange={(e) => setEquipForm({ ...equipForm, status: e.target.value })} className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel">
                  {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select>
              </div>
              <Field label="Ghi chú" v={equipForm.note} on={(v) => setEquipForm({ ...equipForm, note: v })} />
            </form>
            <footer className="bg-white border-t border-line p-4 flex gap-3">
              <button type="button" onClick={() => setShowEquipForm(false)} className="flex-1 rounded-xl2 border border-line py-2.5 text-xs font-semibold text-muted">Hủy</button>
              <button onClick={saveEquip} disabled={saving || !equipForm.name.trim()} className="flex-1 rounded-xl2 bg-ink text-white py-2.5 text-xs font-semibold flex items-center justify-center gap-1 disabled:opacity-50">
                <CheckIcon className="h-4 w-4" /> {saving ? "Đang lưu…" : "Lưu"}
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* Form nhật ký điều động */}
      {showLogForm && (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink/50 backdrop-blur-sm">
          <div className="w-full max-w-md bg-paper flex flex-col h-full shadow-2xl animate-slide-in">
            <header className="flex items-center justify-between border-b border-line bg-white px-4 py-3">
              <div className="flex items-center gap-2"><ClipboardDocumentListIcon className="h-5 w-5 text-steel" /><h2 className="text-sm font-bold text-ink">Ghi nhật ký điều động</h2></div>
              <button onClick={() => setShowLogForm(false)} className="rounded-full p-1.5 text-muted hover:bg-paper hover:text-ink"><XMarkIcon className="h-5 w-5" /></button>
            </header>
            <form onSubmit={saveLog} className="flex-1 overflow-y-auto p-4 space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-muted">Thiết bị *</label>
                <select required value={logForm.equipment_id} onChange={(e) => setLogForm({ ...logForm, equipment_id: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel">
                  <option value={0}>— Chọn thiết bị —</option>
                  {equipment.map((eq) => <option key={eq.id} value={eq.id}>{eq.code ? `${eq.code} — ` : ""}{eq.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-muted">Dự án</label>
                <select value={logForm.project_id} onChange={(e) => setLogForm({ ...logForm, project_id: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel">
                  <option value={0}>— Không gắn dự án —</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-muted">Ngày</label>
                <input type="date" value={logForm.log_date} onChange={(e) => setLogForm({ ...logForm, log_date: e.target.value })} className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-muted">Số giờ chạy</label>
                <input type="number" step="0.1" min="0" value={logForm.hours_used} onChange={(e) => setLogForm({ ...logForm, hours_used: e.target.value })} className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-muted">Nhiên liệu (lít)</label>
                <input type="number" step="0.1" min="0" value={logForm.fuel} onChange={(e) => setLogForm({ ...logForm, fuel: e.target.value })} className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel" />
              </div>
              <Field label="Ghi chú" v={logForm.note} on={(v) => setLogForm({ ...logForm, note: v })} />
            </form>
            <footer className="bg-white border-t border-line p-4 flex gap-3">
              <button type="button" onClick={() => setShowLogForm(false)} className="flex-1 rounded-xl2 border border-line py-2.5 text-xs font-semibold text-muted">Hủy</button>
              <button onClick={saveLog} disabled={saving || !logForm.equipment_id} className="flex-1 rounded-xl2 bg-ink text-white py-2.5 text-xs font-semibold flex items-center justify-center gap-1 disabled:opacity-50">
                <CheckIcon className="h-4 w-4" /> {saving ? "Đang lưu…" : "Lưu nhật ký"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function Field({ label, v, on, req }: { label: string; v: string; on: (v: string) => void; req?: boolean }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-muted">{label}</label>
      <input required={req} value={v} onChange={(e) => on(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel" />
    </div>
  );
}
