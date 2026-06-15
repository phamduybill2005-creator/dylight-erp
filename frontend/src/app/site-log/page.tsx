"use client";

// Trang Nhật ký thi công — ghi nhận diễn biến công trường theo ngày.
// QUYỀN: chỉ Quản lý trở lên (isManagerUp). Cán bộ hiện trường bị chặn.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ClipboardDocumentCheckIcon, PlusIcon, XMarkIcon, CheckIcon,
  CalendarDaysIcon, CloudIcon, UsersIcon, BriefcaseIcon,
  ExclamationTriangleIcon, UserIcon, BuildingOffice2Icon,
} from "@heroicons/react/24/outline";
import AppShell from "@/components/app-shell";
import { api } from "@/lib/api";
import { isManagerUp } from "@/lib/roles";
import { formatDate } from "@/lib/format";
import type { DailyLog, Project, User } from "@/lib/types";

const today = () => new Date().toISOString().slice(0, 10);

const empty = {
  project_id: "",
  log_date: today(),
  weather: "",
  workforce: "",
  work_done: "",
  issues: "",
};

export default function SiteLogPage() {
  const router = useRouter();
  const [me, setMe] = useState<User | null>(null);
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(true);

  const [logs, setLogs] = useState<DailyLog[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);

  const [form, setForm] = useState<typeof empty>(empty);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.me()
      .then((u) => {
        setMe(u);
        if (!isManagerUp(u.role)) { setDenied(true); setLoading(false); return; }
        Promise.all([
          api.siteLogs().catch(() => [] as DailyLog[]),
          api.projects().catch(() => [] as Project[]),
        ])
          .then(([ls, ps]) => { setLogs(ls); setProjects(ps); })
          .finally(() => setLoading(false));
      })
      .catch(() => router.push("/login"));
  }, [router]);

  async function reload() {
    try { setLogs(await api.siteLogs()); } catch { /* noop */ }
  }

  function openCreate() { setForm(empty); setShowForm(true); }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.project_id || !form.log_date) return;
    setSaving(true);
    try {
      await api.createSiteLog({
        project_id: Number(form.project_id),
        log_date: form.log_date,
        weather: form.weather.trim() || null,
        workforce: form.workforce ? Number(form.workforce) : 0,
        work_done: form.work_done.trim() || null,
        issues: form.issues.trim() || null,
      });
      setShowForm(false);
      await reload();
    } catch { /* noop */ } finally { setSaving(false); }
  }

  if (denied) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-paper p-4 text-center">
        <XMarkIcon className="h-16 w-16 text-bad" />
        <h1 className="mt-4 text-lg font-bold text-ink">Không có quyền truy cập</h1>
        <p className="mt-2 max-w-xs text-sm text-muted">Nhật ký thi công chỉ dành cho cấp Quản lý trở lên.</p>
        <button onClick={() => router.push("/")} className="mt-4 rounded-xl2 bg-ink px-4 py-2 text-xs font-semibold text-white">Về trang chủ</button>
      </div>
    );
  }
  if (loading || !me) {
    return <div className="flex min-h-screen items-center justify-center bg-paper"><div className="h-8 w-8 animate-spin rounded-full border-4 border-steel border-t-amber" /></div>;
  }

  const sorted = [...logs].sort((a, b) => (a.log_date < b.log_date ? 1 : a.log_date > b.log_date ? -1 : b.id - a.id));

  return (
    <AppShell>
      <header className="flex items-center justify-between rounded-xl2 bg-ink p-4 lg:p-6 text-white shadow-card">
        <div className="flex items-center gap-2">
          <ClipboardDocumentCheckIcon className="h-5 w-5 text-amber" />
          <h1 className="text-base lg:text-xl font-bold">Nhật ký thi công</h1>
        </div>
        <button onClick={openCreate} className="flex items-center gap-1.5 rounded-xl2 bg-amber px-3 py-2 text-xs font-semibold text-ink">
          <PlusIcon className="h-4 w-4" /> Thêm nhật ký
        </button>
      </header>

      {/* Danh sách nhật ký dạng thẻ — ngày giảm dần */}
      <div className="mt-4 space-y-3">
        {sorted.length === 0 && (
          <div className="rounded-xl2 border border-line bg-white p-8 text-center text-sm text-muted shadow-card">
            Chưa có nhật ký thi công nào.
          </div>
        )}
        {sorted.map((l) => (
          <article key={l.id} className="rounded-xl2 border border-line bg-white p-4 shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
              <div className="flex items-center gap-2 text-ink">
                <CalendarDaysIcon className="h-5 w-5 text-steel" />
                <span className="text-sm font-bold">{formatDate(l.log_date)}</span>
              </div>
              <div className="flex items-center gap-1.5 rounded-full bg-steel/10 px-2.5 py-1 text-[11px] font-semibold text-steel">
                <BuildingOffice2Icon className="h-3.5 w-3.5" />
                {l.project_name || `Dự án #${l.project_id}`}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted">
              <span className="inline-flex items-center gap-1.5">
                <CloudIcon className="h-4 w-4 text-steel" />
                Thời tiết: <b className="font-semibold text-ink">{l.weather || "—"}</b>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <UsersIcon className="h-4 w-4 text-steel" />
                Nhân lực: <b className="tnum font-semibold text-ink">{l.workforce}</b>
              </span>
            </div>

            <div className="mt-3 space-y-3">
              <div>
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                  <BriefcaseIcon className="h-4 w-4" /> Công việc đã làm
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{l.work_done || "—"}</p>
              </div>
              {l.issues && (
                <div className="rounded-lg bg-bad/5 p-2.5">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-bad">
                    <ExclamationTriangleIcon className="h-4 w-4" /> Sự cố / vướng mắc
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{l.issues}</p>
                </div>
              )}
            </div>

            <div className="mt-3 flex items-center gap-1.5 border-t border-line pt-2 text-[11px] text-muted">
              <UserIcon className="h-3.5 w-3.5" />
              Người ghi: <span className="font-semibold text-ink">{l.created_by_name || "—"}</span>
            </div>
          </article>
        ))}
      </div>

      {/* Form thêm nhật ký (slide-over) */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink/50 backdrop-blur-sm">
          <div className="flex h-full w-full max-w-md animate-slide-in flex-col bg-paper shadow-2xl">
            <header className="flex items-center justify-between border-b border-line bg-white px-4 py-3">
              <div className="flex items-center gap-2">
                <ClipboardDocumentCheckIcon className="h-5 w-5 text-steel" />
                <h2 className="text-sm font-bold text-ink">Thêm nhật ký thi công</h2>
              </div>
              <button onClick={() => setShowForm(false)} className="rounded-full p-1.5 text-muted hover:bg-paper hover:text-ink"><XMarkIcon className="h-5 w-5" /></button>
            </header>

            <form onSubmit={save} className="flex-1 space-y-3 overflow-y-auto p-4">
              <div>
                <label className="block text-[11px] font-semibold text-muted">Dự án *</label>
                <select required value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })} className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel">
                  <option value="">— Chọn dự án —</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-muted">Ngày *</label>
                <input type="date" required value={form.log_date} onChange={(e) => setForm({ ...form, log_date: e.target.value })} className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel" />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-muted">Thời tiết</label>
                <input value={form.weather} onChange={(e) => setForm({ ...form, weather: e.target.value })} placeholder="Nắng / Mưa / Âm u…" className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel" />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-muted">Số nhân lực</label>
                <input type="number" min={0} value={form.workforce} onChange={(e) => setForm({ ...form, workforce: e.target.value })} placeholder="0" className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel" />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-muted">Công việc đã làm</label>
                <textarea rows={4} value={form.work_done} onChange={(e) => setForm({ ...form, work_done: e.target.value })} className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel" />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-muted">Sự cố / vướng mắc</label>
                <textarea rows={3} value={form.issues} onChange={(e) => setForm({ ...form, issues: e.target.value })} className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel" />
              </div>
            </form>

            <footer className="flex gap-3 border-t border-line bg-white p-4">
              <button type="button" onClick={() => setShowForm(false)} className="flex-1 rounded-xl2 border border-line py-2.5 text-xs font-semibold text-muted">Hủy</button>
              <button onClick={save} disabled={saving || !form.project_id || !form.log_date} className="flex flex-1 items-center justify-center gap-1 rounded-xl2 bg-ink py-2.5 text-xs font-semibold text-white disabled:opacity-50">
                <CheckIcon className="h-4 w-4" /> {saving ? "Đang lưu…" : "Lưu"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </AppShell>
  );
}
