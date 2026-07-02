"use client";

// Trang Đối tác — danh mục Chủ đầu tư / Nhà cung cấp / Nhà thầu phụ.
// NHẠY CẢM: chỉ Giám đốc / Quản trị (isDirector). Vai trò khác bị chặn.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BuildingOffice2Icon, UserPlusIcon, PencilSquareIcon, TrashIcon,
  XMarkIcon, CheckIcon, IdentificationIcon,
} from "@heroicons/react/24/outline";
import AppShell from "@/components/app-shell";
import { api } from "@/lib/api";
import { isDirector } from "@/lib/roles";
import type { Partner, PartnerType, User } from "@/lib/types";

const TYPE_LABEL: Record<PartnerType, string> = {
  INVESTOR: "Chủ đầu tư",
  SUPPLIER: "Nhà cung cấp",
  SUBCONTRACTOR: "Nhà thầu phụ",
};
const TYPE_CLS: Record<PartnerType, string> = {
  INVESTOR: "bg-steel/10 text-steel",
  SUPPLIER: "bg-amber/15 text-amber-deep",
  SUBCONTRACTOR: "bg-ok/10 text-ok",
};
const TYPES: PartnerType[] = ["INVESTOR", "SUPPLIER", "SUBCONTRACTOR"];

const empty = {
  type: "SUPPLIER" as PartnerType, name: "", tax_code: "", contact_person: "",
  phone: "", email: "", address: "", note: "",
};

export default function PartnersPage() {
  const router = useRouter();
  const [me, setMe] = useState<User | null>(api.cachedUser());
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [filter, setFilter] = useState<PartnerType | "ALL">("ALL");

  const [form, setForm] = useState<typeof empty & { id?: number }>(empty);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.me()
      .then((u) => {
        setMe(u);
        if (!isDirector(u.role)) { setDenied(true); setLoading(false); return; }
        api.partners().then(setPartners).catch(() => {}).finally(() => setLoading(false));
      })
      .catch(() => router.push("/login"));
  }, [router]);

  function openCreate() { setForm(empty); setShowForm(true); }
  function openEdit(p: Partner) {
    setForm({
      id: p.id, type: p.type, name: p.name, tax_code: p.tax_code || "",
      contact_person: p.contact_person || "", phone: p.phone || "",
      email: p.email || "", address: p.address || "", note: p.note || "",
    });
    setShowForm(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        type: form.type, name: form.name.trim(),
        tax_code: form.tax_code || null, contact_person: form.contact_person || null,
        phone: form.phone || null, email: form.email || null,
        address: form.address || null, note: form.note || null,
      };
      if (form.id) {
        const up = await api.updatePartner(form.id, payload);
        setPartners((xs) => xs.map((x) => (x.id === up.id ? up : x)));
      } else {
        const cr = await api.createPartner(payload);
        setPartners((xs) => [...xs, cr]);
      }
      setShowForm(false);
    } catch { /* noop */ } finally { setSaving(false); }
  }

  async function remove(p: Partner) {
    if (!confirm(`Xóa đối tác "${p.name}"?`)) return;
    try { await api.deletePartner(p.id); setPartners((xs) => xs.filter((x) => x.id !== p.id)); } catch { /* noop */ }
  }

  if (denied) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-paper p-4 text-center">
        <XMarkIcon className="h-16 w-16 text-bad" />
        <h1 className="mt-4 text-lg font-bold text-ink">Không có quyền truy cập</h1>
        <p className="mt-2 max-w-xs text-sm text-muted">Danh mục đối tác chỉ dành cho Ban Giám đốc.</p>
        <button onClick={() => router.push("/")} className="mt-4 rounded-xl2 bg-ink px-4 py-2 text-xs font-semibold text-white">Về trang chủ</button>
      </div>
    );
  }
  if (loading || !me) {
    return <AppShell><div className="flex min-h-[70vh] items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-steel border-t-amber" /></div></AppShell>;
  }

  const shown = partners.filter((p) => filter === "ALL" || p.type === filter);

  return (
    <AppShell>
      <header className="flex items-center justify-between rounded-xl2 bg-ink p-4 lg:p-6 text-white shadow-card">
        <div className="flex items-center gap-2">
          <BuildingOffice2Icon className="h-5 w-5 text-amber" />
          <h1 className="text-base lg:text-xl font-bold">Danh mục Đối tác</h1>
        </div>
        <button onClick={openCreate} className="flex items-center gap-1.5 rounded-xl2 bg-amber px-3 py-2 text-xs font-semibold text-ink">
          <UserPlusIcon className="h-4 w-4" /> Thêm
        </button>
      </header>

      {/* Lọc theo loại */}
      <div className="mt-4 flex flex-wrap gap-2">
        {(["ALL", ...TYPES] as const).map((t) => (
          <button key={t} onClick={() => setFilter(t)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${filter === t ? "bg-ink text-white" : "bg-white text-muted shadow-card"}`}>
            {t === "ALL" ? "Tất cả" : TYPE_LABEL[t]}
          </button>
        ))}
      </div>

      {/* Bảng đối tác */}
      <div className="mt-4 overflow-x-auto rounded-xl2 border border-line bg-white shadow-card">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="bg-paper text-left text-[11px] uppercase tracking-wide text-muted">
              <th className="border border-line px-3 py-2">Loại</th>
              <th className="border border-line px-3 py-2">Tên đối tác</th>
              <th className="border border-line px-3 py-2">MST</th>
              <th className="border border-line px-3 py-2">Liên hệ</th>
              <th className="border border-line px-3 py-2">Điện thoại</th>
              <th className="border border-line px-3 py-2 text-center w-20">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr><td colSpan={6} className="border border-line px-3 py-6 text-center text-muted">Chưa có đối tác nào.</td></tr>
            )}
            {shown.map((p) => (
              <tr key={p.id} className="odd:bg-white even:bg-paper/40 hover:bg-amber/10">
                <td className="border border-line px-3 py-2">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${TYPE_CLS[p.type]}`}>{TYPE_LABEL[p.type]}</span>
                </td>
                <td className="border border-line px-3 py-2 font-semibold text-ink">{p.name}</td>
                <td className="border border-line px-3 py-2 font-mono text-[12px] text-muted">{p.tax_code || "—"}</td>
                <td className="border border-line px-3 py-2 text-muted">{p.contact_person || "—"}</td>
                <td className="border border-line px-3 py-2 text-muted whitespace-nowrap">{p.phone || "—"}</td>
                <td className="border border-line px-3 py-2">
                  <div className="flex items-center justify-center gap-2">
                    <button onClick={() => openEdit(p)} className="text-steel hover:text-ink"><PencilSquareIcon className="h-4 w-4" /></button>
                    <button onClick={() => remove(p)} className="text-bad hover:opacity-70"><TrashIcon className="h-4 w-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Form thêm/sửa */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink/50 backdrop-blur-sm">
          <div className="w-full max-w-md bg-paper flex flex-col h-full shadow-2xl animate-slide-in">
            <header className="flex items-center justify-between border-b border-line bg-white px-4 py-3">
              <div className="flex items-center gap-2"><IdentificationIcon className="h-5 w-5 text-steel" /><h2 className="text-sm font-bold text-ink">{form.id ? "Sửa đối tác" : "Thêm đối tác"}</h2></div>
              <button onClick={() => setShowForm(false)} className="rounded-full p-1.5 text-muted hover:bg-paper hover:text-ink"><XMarkIcon className="h-5 w-5" /></button>
            </header>
            <form onSubmit={save} className="flex-1 overflow-y-auto p-4 space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-muted">Loại đối tác</label>
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as PartnerType })} className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel">
                  {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
                </select>
              </div>
              <Field label="Tên đối tác *" v={form.name} on={(v) => setForm({ ...form, name: v })} req />
              <Field label="Mã số thuế" v={form.tax_code} on={(v) => setForm({ ...form, tax_code: v })} />
              <Field label="Người liên hệ" v={form.contact_person} on={(v) => setForm({ ...form, contact_person: v })} />
              <Field label="Điện thoại" v={form.phone} on={(v) => setForm({ ...form, phone: v })} />
              <Field label="Email" v={form.email} on={(v) => setForm({ ...form, email: v })} />
              <Field label="Địa chỉ" v={form.address} on={(v) => setForm({ ...form, address: v })} />
              <Field label="Ghi chú" v={form.note} on={(v) => setForm({ ...form, note: v })} />
            </form>
            <footer className="bg-white border-t border-line p-4 flex gap-3">
              <button type="button" onClick={() => setShowForm(false)} className="flex-1 rounded-xl2 border border-line py-2.5 text-xs font-semibold text-muted">Hủy</button>
              <button onClick={save} disabled={saving || !form.name.trim()} className="flex-1 rounded-xl2 bg-ink text-white py-2.5 text-xs font-semibold flex items-center justify-center gap-1 disabled:opacity-50">
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
