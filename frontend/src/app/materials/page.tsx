"use client";

// Trang Vật tư & Kho — danh mục vật tư + phiếu nhập/xuất kho + lịch sử.
// QUYỀN: chỉ Quản lý trở lên (isManagerUp). Vai trò khác bị chặn.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArchiveBoxIcon, PlusIcon, XMarkIcon, CheckIcon,
  ArrowDownTrayIcon, ArrowUpTrayIcon, ClockIcon,
} from "@heroicons/react/24/outline";
import AppShell from "@/components/app-shell";
import { api } from "@/lib/api";
import { isManagerUp } from "@/lib/roles";
import { formatVND, formatDate } from "@/lib/format";
import type { Material, StockMovement, Project, User } from "@/lib/types";

const emptyMat = { code: "", name: "", unit: "", note: "" };

type MoveType = "IN" | "OUT";
const emptyMove = {
  material_id: 0,
  type: "IN" as MoveType,
  quantity: "" as string,
  unit_price: "" as string,
  project_id: "" as string,
  note: "",
};

export default function MaterialsPage() {
  const router = useRouter();
  const [me, setMe] = useState<User | null>(null);
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(true);

  const [materials, setMaterials] = useState<Material[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);

  // Form vật tư
  const [matForm, setMatForm] = useState(emptyMat);
  const [showMat, setShowMat] = useState(false);
  const [savingMat, setSavingMat] = useState(false);

  // Form phiếu kho
  const [moveForm, setMoveForm] = useState(emptyMove);
  const [showMove, setShowMove] = useState(false);
  const [savingMove, setSavingMove] = useState(false);

  useEffect(() => {
    api.me()
      .then((u) => {
        setMe(u);
        if (!isManagerUp(u.role)) { setDenied(true); setLoading(false); return; }
        Promise.all([
          api.materials().then(setMaterials).catch(() => {}),
          api.stockMovements().then(setMovements).catch(() => {}),
          api.projects().then(setProjects).catch(() => {}),
        ]).finally(() => setLoading(false));
      })
      .catch(() => router.push("/login"));
  }, [router]);

  async function reloadStock() {
    try {
      const [ms, mv] = await Promise.all([api.materials(), api.stockMovements()]);
      setMaterials(ms);
      setMovements(mv);
    } catch { /* noop */ }
  }

  function openMatCreate() { setMatForm(emptyMat); setShowMat(true); }

  async function saveMat(e: React.FormEvent) {
    e.preventDefault();
    setSavingMat(true);
    try {
      const cr = await api.createMaterial({
        name: matForm.name.trim(),
        code: matForm.code || null,
        unit: matForm.unit || null,
        note: matForm.note || null,
      });
      setMaterials((xs) => [...xs, cr]);
      setShowMat(false);
    } catch { /* noop */ } finally { setSavingMat(false); }
  }

  function openMove(m: Material, type: MoveType) {
    setMoveForm({ ...emptyMove, material_id: m.id, type });
    setShowMove(true);
  }

  async function saveMove(e: React.FormEvent) {
    e.preventDefault();
    if (!moveForm.material_id || !moveForm.quantity) return;
    setSavingMove(true);
    try {
      await api.createMovement({
        material_id: moveForm.material_id,
        type: moveForm.type,
        quantity: Number(moveForm.quantity),
        unit_price: moveForm.unit_price ? Number(moveForm.unit_price) : 0,
        project_id: moveForm.project_id ? Number(moveForm.project_id) : null,
        note: moveForm.note || null,
      });
      setShowMove(false);
      await reloadStock();
    } catch { /* noop */ } finally { setSavingMove(false); }
  }

  if (denied) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-paper p-4 text-center">
        <XMarkIcon className="h-16 w-16 text-bad" />
        <h1 className="mt-4 text-lg font-bold text-ink">Không có quyền truy cập</h1>
        <p className="mt-2 max-w-xs text-sm text-muted">Trang này dành cho cấp Quản lý trở lên.</p>
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
          <ArchiveBoxIcon className="h-5 w-5 text-amber" />
          <h1 className="text-base lg:text-xl font-bold">Vật tư & Kho</h1>
        </div>
        <button onClick={openMatCreate} className="flex items-center gap-1.5 rounded-xl2 bg-amber px-3 py-2 text-xs font-semibold text-ink">
          <PlusIcon className="h-4 w-4" /> Thêm vật tư
        </button>
      </header>

      {/* Bảng vật tư */}
      <h2 className="mt-5 mb-2 text-sm font-bold text-ink">Danh mục vật tư</h2>
      <div className="overflow-x-auto rounded-xl2 border border-line bg-white shadow-card">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="bg-paper text-left text-[11px] uppercase tracking-wide text-muted">
              <th className="border border-line px-3 py-2">Mã</th>
              <th className="border border-line px-3 py-2">Tên vật tư</th>
              <th className="border border-line px-3 py-2">ĐVT</th>
              <th className="border border-line px-3 py-2 text-right">Tồn kho</th>
              <th className="border border-line px-3 py-2 text-center w-32">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {materials.length === 0 && (
              <tr><td colSpan={5} className="border border-line px-3 py-6 text-center text-muted">Chưa có vật tư nào.</td></tr>
            )}
            {materials.map((m) => (
              <tr key={m.id} className="odd:bg-white even:bg-paper/40 hover:bg-amber/10">
                <td className="border border-line px-3 py-2 font-mono text-[12px] text-muted">{m.code || "—"}</td>
                <td className="border border-line px-3 py-2 font-semibold text-ink">{m.name}</td>
                <td className="border border-line px-3 py-2 text-muted">{m.unit || "—"}</td>
                <td className="border border-line px-3 py-2 text-right tnum font-semibold text-ink">{m.stock_qty}</td>
                <td className="border border-line px-3 py-2">
                  <div className="flex items-center justify-center gap-2">
                    <button onClick={() => openMove(m, "IN")} className="flex items-center gap-1 rounded-lg bg-ok/10 px-2 py-1 text-[11px] font-semibold text-ok">
                      <ArrowDownTrayIcon className="h-3.5 w-3.5" /> Nhập
                    </button>
                    <button onClick={() => openMove(m, "OUT")} className="flex items-center gap-1 rounded-lg bg-bad/10 px-2 py-1 text-[11px] font-semibold text-bad">
                      <ArrowUpTrayIcon className="h-3.5 w-3.5" /> Xuất
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Bảng lịch sử nhập/xuất */}
      <h2 className="mt-6 mb-2 flex items-center gap-1.5 text-sm font-bold text-ink"><ClockIcon className="h-4 w-4 text-steel" /> Lịch sử nhập / xuất kho</h2>
      <div className="overflow-x-auto rounded-xl2 border border-line bg-white shadow-card">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="bg-paper text-left text-[11px] uppercase tracking-wide text-muted">
              <th className="border border-line px-3 py-2">Ngày</th>
              <th className="border border-line px-3 py-2">Vật tư</th>
              <th className="border border-line px-3 py-2">Loại</th>
              <th className="border border-line px-3 py-2 text-right">SL</th>
              <th className="border border-line px-3 py-2 text-right">Đơn giá</th>
              <th className="border border-line px-3 py-2">Dự án</th>
              <th className="border border-line px-3 py-2">Ghi chú</th>
            </tr>
          </thead>
          <tbody>
            {movements.length === 0 && (
              <tr><td colSpan={7} className="border border-line px-3 py-6 text-center text-muted">Chưa có phiếu nhập/xuất nào.</td></tr>
            )}
            {movements.map((mv) => (
              <tr key={mv.id} className="odd:bg-white even:bg-paper/40 hover:bg-amber/10">
                <td className="border border-line px-3 py-2 whitespace-nowrap text-muted">{formatDate(mv.moved_at || mv.created_at)}</td>
                <td className="border border-line px-3 py-2 font-semibold text-ink">{mv.material_name || "—"}</td>
                <td className="border border-line px-3 py-2">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${mv.type === "IN" ? "bg-ok/10 text-ok" : "bg-bad/10 text-bad"}`}>
                    {mv.type === "IN" ? "Nhập" : "Xuất"}
                  </span>
                </td>
                <td className="border border-line px-3 py-2 text-right tnum">{mv.quantity}</td>
                <td className="border border-line px-3 py-2 text-right tnum text-muted">{formatVND(mv.unit_price)}</td>
                <td className="border border-line px-3 py-2 text-muted">{mv.project_name || "—"}</td>
                <td className="border border-line px-3 py-2 text-muted">{mv.note || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Form thêm vật tư */}
      {showMat && (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink/50 backdrop-blur-sm">
          <div className="w-full max-w-md bg-paper flex flex-col h-full shadow-2xl animate-slide-in">
            <header className="flex items-center justify-between border-b border-line bg-white px-4 py-3">
              <div className="flex items-center gap-2"><ArchiveBoxIcon className="h-5 w-5 text-steel" /><h2 className="text-sm font-bold text-ink">Thêm vật tư</h2></div>
              <button onClick={() => setShowMat(false)} className="rounded-full p-1.5 text-muted hover:bg-paper hover:text-ink"><XMarkIcon className="h-5 w-5" /></button>
            </header>
            <form onSubmit={saveMat} className="flex-1 overflow-y-auto p-4 space-y-3">
              <Field label="Mã vật tư" v={matForm.code} on={(v) => setMatForm({ ...matForm, code: v })} />
              <Field label="Tên vật tư *" v={matForm.name} on={(v) => setMatForm({ ...matForm, name: v })} req />
              <Field label="Đơn vị tính" v={matForm.unit} on={(v) => setMatForm({ ...matForm, unit: v })} />
              <Field label="Ghi chú" v={matForm.note} on={(v) => setMatForm({ ...matForm, note: v })} />
            </form>
            <footer className="bg-white border-t border-line p-4 flex gap-3">
              <button type="button" onClick={() => setShowMat(false)} className="flex-1 rounded-xl2 border border-line py-2.5 text-xs font-semibold text-muted">Hủy</button>
              <button onClick={saveMat} disabled={savingMat || !matForm.name.trim()} className="flex-1 rounded-xl2 bg-ink text-white py-2.5 text-xs font-semibold flex items-center justify-center gap-1 disabled:opacity-50">
                <CheckIcon className="h-4 w-4" /> {savingMat ? "Đang lưu…" : "Lưu"}
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* Form phiếu nhập/xuất kho */}
      {showMove && (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink/50 backdrop-blur-sm">
          <div className="w-full max-w-md bg-paper flex flex-col h-full shadow-2xl animate-slide-in">
            <header className="flex items-center justify-between border-b border-line bg-white px-4 py-3">
              <div className="flex items-center gap-2">
                {moveForm.type === "IN" ? <ArrowDownTrayIcon className="h-5 w-5 text-ok" /> : <ArrowUpTrayIcon className="h-5 w-5 text-bad" />}
                <h2 className="text-sm font-bold text-ink">{moveForm.type === "IN" ? "Phiếu nhập kho" : "Phiếu xuất kho"}</h2>
              </div>
              <button onClick={() => setShowMove(false)} className="rounded-full p-1.5 text-muted hover:bg-paper hover:text-ink"><XMarkIcon className="h-5 w-5" /></button>
            </header>
            <form onSubmit={saveMove} className="flex-1 overflow-y-auto p-4 space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-muted">Vật tư *</label>
                <select value={moveForm.material_id} onChange={(e) => setMoveForm({ ...moveForm, material_id: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel">
                  <option value={0} disabled>— Chọn vật tư —</option>
                  {materials.map((m) => <option key={m.id} value={m.id}>{m.code ? `${m.code} — ` : ""}{m.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-muted">Loại phiếu</label>
                <select value={moveForm.type} onChange={(e) => setMoveForm({ ...moveForm, type: e.target.value as MoveType })} className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel">
                  <option value="IN">Nhập kho</option>
                  <option value="OUT">Xuất kho</option>
                </select>
              </div>
              <NumField label="Số lượng *" v={moveForm.quantity} on={(v) => setMoveForm({ ...moveForm, quantity: v })} req />
              <NumField label="Đơn giá (VNĐ)" v={moveForm.unit_price} on={(v) => setMoveForm({ ...moveForm, unit_price: v })} />
              <div>
                <label className="block text-[11px] font-semibold text-muted">Dự án (tùy chọn)</label>
                <select value={moveForm.project_id} onChange={(e) => setMoveForm({ ...moveForm, project_id: e.target.value })} className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel">
                  <option value="">— Không gắn dự án —</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
                </select>
              </div>
              <Field label="Ghi chú" v={moveForm.note} on={(v) => setMoveForm({ ...moveForm, note: v })} />
            </form>
            <footer className="bg-white border-t border-line p-4 flex gap-3">
              <button type="button" onClick={() => setShowMove(false)} className="flex-1 rounded-xl2 border border-line py-2.5 text-xs font-semibold text-muted">Hủy</button>
              <button onClick={saveMove} disabled={savingMove || !moveForm.material_id || !moveForm.quantity} className="flex-1 rounded-xl2 bg-ink text-white py-2.5 text-xs font-semibold flex items-center justify-center gap-1 disabled:opacity-50">
                <CheckIcon className="h-4 w-4" /> {savingMove ? "Đang lưu…" : "Lưu phiếu"}
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

function NumField({ label, v, on, req }: { label: string; v: string; on: (v: string) => void; req?: boolean }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-muted">{label}</label>
      <input type="number" min="0" step="any" required={req} value={v} onChange={(e) => on(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-xs text-right tnum outline-none focus:border-steel" />
    </div>
  );
}
