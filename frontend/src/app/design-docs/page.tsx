"use client";

// Trang Hồ sơ thiết kế & Quản lý bản vẽ — đặc thù công ty thiết kế cầu đường.
// Theo giai đoạn TK (Khảo sát/Cơ sở/Kỹ thuật/BVTC) + phiên bản + trạng thái duyệt + link file.
// Xem: mọi người đăng nhập (kỹ sư tra bản vẽ). Tạo/sửa/xóa: Quản lý trở lên.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  RectangleStackIcon, PlusIcon, PencilSquareIcon, TrashIcon,
  XMarkIcon, CheckIcon, ArrowTopRightOnSquareIcon,
} from "@heroicons/react/24/outline";
import AppShell from "@/components/app-shell";
import { api } from "@/lib/api";
import { isManagerUp } from "@/lib/roles";
import type { DesignDocument, DesignPhase, DesignDocStatus, Project, User } from "@/lib/types";

const PHASE_LABEL: Record<DesignPhase, string> = {
  SURVEY: "Khảo sát", BASIC: "TK cơ sở", TECHNICAL: "TK kỹ thuật", SHOP: "Bản vẽ thi công",
};
const PHASES: DesignPhase[] = ["SURVEY", "BASIC", "TECHNICAL", "SHOP"];
const STATUS_LABEL: Record<DesignDocStatus, string> = {
  DRAFT: "Nháp", SUBMITTED: "Đã trình", REVIEWING: "Đang thẩm tra", APPROVED: "Đã duyệt", REVISE: "Cần sửa",
};
const STATUS_CLS: Record<DesignDocStatus, string> = {
  DRAFT: "bg-line text-muted", SUBMITTED: "bg-steel/10 text-steel",
  REVIEWING: "bg-amber/20 text-amber-deep", APPROVED: "bg-ok/15 text-ok", REVISE: "bg-bad/15 text-bad",
};
const STATUSES: DesignDocStatus[] = ["DRAFT", "SUBMITTED", "REVIEWING", "APPROVED", "REVISE"];

const empty = {
  project_id: 0, phase: "TECHNICAL" as DesignPhase, code: "", name: "",
  discipline: "Cầu", version: "Rev.A", status: "DRAFT" as DesignDocStatus, file_url: "", note: "",
};

export default function DesignDocsPage() {
  const router = useRouter();
  const [me, setMe] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [docs, setDocs] = useState<DesignDocument[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [filter, setFilter] = useState<DesignPhase | "ALL">("ALL");

  const [form, setForm] = useState<typeof empty & { id?: number }>(empty);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const canEdit = me ? isManagerUp(me.role) : false;

  function reload() {
    api.designDocs().then(setDocs).catch(() => {});
  }

  useEffect(() => {
    api.me()
      .then((u) => {
        setMe(u);
        Promise.all([api.designDocs(), api.projects()])
          .then(([d, p]) => { setDocs(d); setProjects(p); })
          .catch(() => {})
          .finally(() => setLoading(false));
      })
      .catch(() => router.push("/login"));
  }, [router]);

  function openCreate() {
    setForm({ ...empty, project_id: projects[0]?.id ?? 0 });
    setShowForm(true);
  }
  function openEdit(d: DesignDocument) {
    setForm({
      id: d.id, project_id: d.project_id, phase: d.phase, code: d.code || "", name: d.name,
      discipline: d.discipline || "", version: d.version || "", status: d.status,
      file_url: d.file_url || "", note: d.note || "",
    });
    setShowForm(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.project_id) return;
    setSaving(true);
    try {
      const payload = {
        project_id: form.project_id, phase: form.phase, code: form.code || null,
        name: form.name.trim(), discipline: form.discipline || null, version: form.version || null,
        status: form.status, file_url: form.file_url || null, note: form.note || null,
      };
      if (form.id) await api.updateDesignDoc(form.id, payload as any);
      else await api.createDesignDoc(payload as any);
      reload();
      setShowForm(false);
    } catch { /* noop */ } finally { setSaving(false); }
  }

  async function remove(d: DesignDocument) {
    if (!confirm(`Xóa hồ sơ "${d.name}"?`)) return;
    try { await api.deleteDesignDoc(d.id); setDocs((xs) => xs.filter((x) => x.id !== d.id)); } catch { /* noop */ }
  }

  if (loading || !me) {
    return <div className="flex min-h-screen items-center justify-center bg-paper"><div className="h-8 w-8 animate-spin rounded-full border-4 border-steel border-t-amber" /></div>;
  }

  const shown = docs.filter((d) => filter === "ALL" || d.phase === filter);

  return (
    <AppShell>
      <header className="flex items-center justify-between rounded-xl2 bg-ink p-4 lg:p-6 text-white shadow-card">
        <div className="flex items-center gap-2">
          <RectangleStackIcon className="h-5 w-5 text-amber" />
          <h1 className="text-base lg:text-xl font-bold">Hồ sơ thiết kế & Bản vẽ</h1>
        </div>
        {canEdit && (
          <button onClick={openCreate} className="flex items-center gap-1.5 rounded-xl2 bg-amber px-3 py-2 text-xs font-semibold text-ink">
            <PlusIcon className="h-4 w-4" /> Thêm hồ sơ
          </button>
        )}
      </header>

      {/* Lọc theo giai đoạn */}
      <div className="mt-4 flex flex-wrap gap-2">
        {(["ALL", ...PHASES] as const).map((t) => (
          <button key={t} onClick={() => setFilter(t)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${filter === t ? "bg-ink text-white" : "bg-white text-muted shadow-card"}`}>
            {t === "ALL" ? "Tất cả giai đoạn" : PHASE_LABEL[t]}
          </button>
        ))}
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl2 border border-line bg-white shadow-card">
        <table className="w-full min-w-[860px] border-collapse text-sm">
          <thead>
            <tr className="bg-paper text-left text-[11px] uppercase tracking-wide text-muted">
              <th className="border border-line px-3 py-2">Dự án</th>
              <th className="border border-line px-3 py-2">Giai đoạn</th>
              <th className="border border-line px-3 py-2">Mã</th>
              <th className="border border-line px-3 py-2">Tên hồ sơ / bản vẽ</th>
              <th className="border border-line px-3 py-2">Bộ môn</th>
              <th className="border border-line px-3 py-2 text-center">Phiên bản</th>
              <th className="border border-line px-3 py-2">Trạng thái</th>
              <th className="border border-line px-3 py-2 text-center">File</th>
              {canEdit && <th className="border border-line px-3 py-2 text-center w-20"></th>}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr><td colSpan={canEdit ? 9 : 8} className="border border-line px-3 py-6 text-center text-muted">Chưa có hồ sơ thiết kế nào.</td></tr>
            )}
            {shown.map((d) => (
              <tr key={d.id} className="odd:bg-white even:bg-paper/40 hover:bg-amber/10">
                <td className="border border-line px-3 py-2 text-muted whitespace-nowrap">{d.project_name || `#${d.project_id}`}</td>
                <td className="border border-line px-3 py-2 whitespace-nowrap">{PHASE_LABEL[d.phase]}</td>
                <td className="border border-line px-3 py-2 font-mono text-[12px] text-steel">{d.code || "—"}</td>
                <td className="border border-line px-3 py-2 font-semibold text-ink">{d.name}</td>
                <td className="border border-line px-3 py-2 text-muted">{d.discipline || "—"}</td>
                <td className="border border-line px-3 py-2 text-center font-mono text-[12px]">{d.version || "—"}</td>
                <td className="border border-line px-3 py-2">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_CLS[d.status]}`}>{STATUS_LABEL[d.status]}</span>
                </td>
                <td className="border border-line px-3 py-2 text-center">
                  {d.file_url ? (
                    <a href={d.file_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-steel hover:text-ink">
                      <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                    </a>
                  ) : "—"}
                </td>
                {canEdit && (
                  <td className="border border-line px-3 py-2">
                    <div className="flex items-center justify-center gap-2">
                      <button onClick={() => openEdit(d)} className="text-steel hover:text-ink"><PencilSquareIcon className="h-4 w-4" /></button>
                      <button onClick={() => remove(d)} className="text-bad hover:opacity-70"><TrashIcon className="h-4 w-4" /></button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-muted">File bản vẽ (DWG/RVT/PDF) lưu trên cloud (Google Drive…) và dán link vào hồ sơ.</p>

      {showForm && canEdit && (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink/50 backdrop-blur-sm">
          <div className="w-full max-w-md bg-paper flex flex-col h-full shadow-2xl animate-slide-in">
            <header className="flex items-center justify-between border-b border-line bg-white px-4 py-3">
              <h2 className="text-sm font-bold text-ink">{form.id ? "Sửa hồ sơ thiết kế" : "Thêm hồ sơ thiết kế"}</h2>
              <button onClick={() => setShowForm(false)} className="rounded-full p-1.5 text-muted hover:bg-paper hover:text-ink"><XMarkIcon className="h-5 w-5" /></button>
            </header>
            <form onSubmit={save} className="flex-1 overflow-y-auto p-4 space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-muted">Dự án *</label>
                <select value={form.project_id} onChange={(e) => setForm({ ...form, project_id: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel">
                  <option value={0}>-- Chọn dự án --</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold text-muted">Giai đoạn</label>
                  <select value={form.phase} onChange={(e) => setForm({ ...form, phase: e.target.value as DesignPhase })} className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel">
                    {PHASES.map((p) => <option key={p} value={p}>{PHASE_LABEL[p]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-muted">Trạng thái</label>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as DesignDocStatus })} className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel">
                    {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </select>
                </div>
              </div>
              <Field label="Tên hồ sơ / bản vẽ *" v={form.name} on={(v) => setForm({ ...form, name: v })} req />
              <div className="grid grid-cols-2 gap-2">
                <Field label="Mã hồ sơ" v={form.code} on={(v) => setForm({ ...form, code: v })} />
                <Field label="Phiên bản" v={form.version} on={(v) => setForm({ ...form, version: v })} />
              </div>
              <Field label="Bộ môn (Cầu/Đường/Thủy văn/ATGT…)" v={form.discipline} on={(v) => setForm({ ...form, discipline: v })} />
              <Field label="Link file (Drive/cloud)" v={form.file_url} on={(v) => setForm({ ...form, file_url: v })} />
              <div>
                <label className="block text-[11px] font-semibold text-muted">Ghi chú</label>
                <textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel resize-none" />
              </div>
            </form>
            <footer className="bg-white border-t border-line p-4 flex gap-3">
              <button type="button" onClick={() => setShowForm(false)} className="flex-1 rounded-xl2 border border-line py-2.5 text-xs font-semibold text-muted">Hủy</button>
              <button onClick={save} disabled={saving || !form.name.trim() || !form.project_id} className="flex-1 rounded-xl2 bg-ink text-white py-2.5 text-xs font-semibold flex items-center justify-center gap-1 disabled:opacity-50">
                <CheckIcon className="h-4 w-4" /> {saving ? "Đang lưu…" : "Lưu"}
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
