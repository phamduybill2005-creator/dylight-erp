"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  CameraIcon,
  CheckBadgeIcon,
  SparklesIcon,
  ArrowUpTrayIcon,
  XMarkIcon,
  EyeIcon,
  BuildingOfficeIcon,
  PencilSquareIcon,
} from "@heroicons/react/24/outline";
import AppShell from "@/components/app-shell";
import { api, ASSET_BASE } from "@/lib/api";
import { formatVND, formatDate } from "@/lib/format";
import type { Invoice, Project, Contract } from "@/lib/types";

const STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "Chờ xử lý", cls: "bg-line text-muted" },
  PROCESSING: { label: "Đang đọc AI", cls: "bg-amber/20 text-amber-deep" },
  EXTRACTED: { label: "Đã bóc tách", cls: "bg-amber/20 text-amber-deep" },
  VERIFIED: { label: "Đã duyệt", cls: "bg-ok/15 text-ok" },
  REJECTED: { label: "Từ chối", cls: "bg-bad/15 text-bad" },
};

const CATEGORIES = ["vật tư", "nhân công", "máy", "nhiên liệu", "vận chuyển", "khác"];

export default function InvoicesPage() {
  return (
    <Suspense fallback={<AppShell><p className="text-sm text-muted">Đang tải…</p></AppShell>}>
      <InvoicesInner />
    </Suspense>
  );
}

function InvoicesInner() {
  const params = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);
  
  // Lists
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);

  // States
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Detail Modal State
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [editForm, setEditForm] = useState({
    supplier_name: "",
    supplier_tax_code: "",
    invoice_number: "",
    invoice_date: "",
    amount_no_vat: 0,
    vat_amount: 0,
    total_amount: 0,
    category: "",
    project_id: 0,
    contract_id: 0,
  });

  function loadData() {
    api.invoices().then(setInvoices).catch(() => {});
    api.projects().then(setProjects).catch(() => {});
    api.contracts().then(setContracts).catch(() => {});
  }
  
  useEffect(loadData, []);

  // Open camera/uploader when coming from FAB (?capture=1)
  useEffect(() => {
    if (params.get("capture") === "1") inputRef.current?.click();
  }, [params]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const inv = await api.uploadInvoice(file);
      // Auto open detail modal for the uploaded invoice
      openDetailModal(inv);
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tải hóa đơn thất bại.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function openDetailModal(inv: Invoice) {
    setSelectedInvoice(inv);
    setEditForm({
      supplier_name: inv.supplier_name || "",
      supplier_tax_code: inv.supplier_tax_code || "",
      invoice_number: inv.invoice_number || "",
      invoice_date: inv.invoice_date || "",
      amount_no_vat: Number(inv.amount_no_vat),
      vat_amount: Number(inv.vat_amount),
      total_amount: Number(inv.total_amount),
      category: inv.category || "khác",
      project_id: inv.project_id || 0,
      contract_id: inv.contract_id || 0,
    });
  }

  // Auto calculate total amount when editing amounts
  useEffect(() => {
    setEditForm((prev) => ({
      ...prev,
      total_amount: prev.amount_no_vat + prev.vat_amount,
    }));
  }, [editForm.amount_no_vat, editForm.vat_amount]);

  async function handleSave(status?: "VERIFIED" | "REJECTED") {
    if (!selectedInvoice) return;
    setError(null);
    try {
      // 1. Save changes via PATCH
      const payload: Partial<Invoice> = {
        supplier_name: editForm.supplier_name,
        supplier_tax_code: editForm.supplier_tax_code,
        invoice_number: editForm.invoice_number,
        invoice_date: editForm.invoice_date || null,
        amount_no_vat: editForm.amount_no_vat,
        vat_amount: editForm.vat_amount,
        total_amount: editForm.total_amount,
        category: editForm.category,
        project_id: editForm.project_id || null,
        contract_id: editForm.contract_id || null,
      };

      if (status) {
        payload.status = status;
      }

      await api.updateInvoice(selectedInvoice.id, payload);

      // 2. If accountant clicked "Verify", call verify endpoint
      if (status === "VERIFIED") {
        await api.verifyInvoice(selectedInvoice.id);
      }

      setSelectedInvoice(null);
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cập nhật hóa đơn thất bại.");
    }
  }

  // Contracts filtered by selected project
  const filteredContracts = contracts.filter((c) => c.project_id === Number(editForm.project_id));

  return (
    <AppShell>
      <h1 className="text-lg font-semibold text-ink lg:text-2xl">Quản lý hóa đơn</h1>
      <p className="mt-0.5 text-xs text-muted">
        Chụp ảnh hóa đơn, AI tự động bóc tách dữ liệu chi phí công trường.
      </p>

      {/* Vùng chụp / tải ảnh */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onFile}
        className="hidden"
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl2 bg-amber py-4 font-semibold text-ink shadow-fab disabled:opacity-70 lg:max-w-sm"
      >
        {uploading ? (
          <>
            <SparklesIcon className="h-5 w-5 animate-pulse" />
            AI đang đọc hóa đơn…
          </>
        ) : (
          <>
            <CameraIcon className="h-5 w-5" />
            Chụp / tải ảnh hóa đơn
          </>
        )}
      </button>

      {error && <p className="mt-3 text-xs text-bad">{error}</p>}

      {/* Danh sách hóa đơn */}
      <h2 className="mb-2 mt-6 text-sm font-semibold text-ink lg:text-base">Hóa đơn gần đây</h2>
      <div className="space-y-2 lg:space-y-0 lg:grid lg:grid-cols-2 lg:gap-3 xl:grid-cols-3">
        {invoices.length === 0 && (
          <p className="rounded-xl2 bg-white p-4 text-center text-xs text-muted shadow-card lg:col-span-2 xl:col-span-3">
            <ArrowUpTrayIcon className="mx-auto mb-1 h-5 w-5" />
            Chưa có hóa đơn. Hãy chụp hóa đơn đầu tiên.
          </p>
        )}
        {invoices.map((inv) => {
          const st = STATUS[inv.status] ?? STATUS.PENDING;
          return (
            <div
              key={inv.id}
              onClick={() => openDetailModal(inv)}
              className="rounded-xl2 bg-white p-3 shadow-card border border-line/40 hover:border-amber/40 transition-all cursor-pointer"
            >
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">
                    {inv.supplier_name || "Nhà cung cấp chưa rõ"}
                  </p>
                  <p className="font-mono text-[10px] text-muted truncate">
                    MST {inv.supplier_tax_code || "—"} · {inv.invoice_date ? formatDate(inv.invoice_date) : "—"}
                  </p>
                </div>
                <span className={`ml-2 shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold ${st.cls}`}>
                  {st.label}
                </span>
              </div>
              <div className="mt-2.5 pt-2 border-t border-line/60 flex items-center justify-between">
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-paper text-muted uppercase font-semibold">{inv.category || "khác"}</span>
                <span className="text-sm font-semibold text-ink tnum">
                  {formatVND(inv.total_amount)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal Chi tiết & Chỉnh sửa hóa đơn */}
      <AnimatePresence>
        {selectedInvoice && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 overflow-y-auto pt-10 lg:items-center lg:pt-0 lg:p-6">
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25 }}
              className="w-full max-w-md rounded-t-xl2 bg-white p-5 shadow-card max-h-[90vh] overflow-y-auto lg:max-w-lg lg:rounded-xl2 lg:p-6"
            >
              <div className="flex items-center justify-between border-b border-line pb-3">
                <div>
                  <h2 className="text-sm font-bold text-ink">Chi tiết hóa đơn</h2>
                  {selectedInvoice.ocr_confidence && (
                    <p className="text-[10px] text-amber-deep font-semibold">
                      Độ tin cậy AI: {Math.round(selectedInvoice.ocr_confidence)}%
                    </p>
                  )}
                </div>
                <button onClick={() => setSelectedInvoice(null)} className="rounded-full p-1 hover:bg-paper">
                  <XMarkIcon className="h-5 w-5 text-muted" />
                </button>
              </div>

              {/* Ảnh hóa đơn gốc */}
              {selectedInvoice.image_url && (
                <div className="mt-4 overflow-hidden rounded-xl2 border border-line bg-paper max-h-48 lg:max-h-72 flex items-center justify-center">
                  <img
                    src={`${ASSET_BASE}${selectedInvoice.image_url}`}
                    alt="Ảnh hóa đơn"
                    className="object-contain max-h-48 lg:max-h-72 w-full cursor-zoom-in"
                    onClick={() => window.open(`${ASSET_BASE}${selectedInvoice.image_url}`, "_blank")}
                  />
                </div>
              )}

              <form className="mt-4 space-y-3 pb-8">
                {/* Form Inputs */}
                <div>
                  <label className="text-[10px] font-semibold text-muted block mb-1">Nhà cung cấp</label>
                  <input
                    type="text"
                    value={editForm.supplier_name}
                    onChange={(e) => setEditForm({ ...editForm, supplier_name: e.target.value })}
                    className="w-full rounded-xl2 border border-line bg-paper px-3 py-2 text-xs focus:bg-white focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-semibold text-muted block mb-1">Mã số thuế</label>
                    <input
                      type="text"
                      value={editForm.supplier_tax_code}
                      onChange={(e) => setEditForm({ ...editForm, supplier_tax_code: e.target.value })}
                      className="w-full rounded-xl2 border border-line bg-paper px-3 py-2 text-xs focus:bg-white focus:outline-none font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-muted block mb-1">Số hóa đơn</label>
                    <input
                      type="text"
                      value={editForm.invoice_number}
                      onChange={(e) => setEditForm({ ...editForm, invoice_number: e.target.value })}
                      className="w-full rounded-xl2 border border-line bg-paper px-3 py-2 text-xs focus:bg-white focus:outline-none font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-semibold text-muted block mb-1">Ngày hóa đơn</label>
                    <input
                      type="date"
                      value={editForm.invoice_date}
                      onChange={(e) => setEditForm({ ...editForm, invoice_date: e.target.value })}
                      className="w-full rounded-xl2 border border-line bg-paper px-3 py-2 text-xs focus:bg-white focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-muted block mb-1">Hạng mục chi phí</label>
                    <select
                      value={editForm.category}
                      onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                      className="w-full rounded-xl2 border border-line bg-paper px-3 py-2 text-xs focus:bg-white focus:outline-none"
                    >
                      {CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-semibold text-muted block mb-1">Giá trị chưa VAT (VND)</label>
                    <input
                      type="number"
                      value={editForm.amount_no_vat || ""}
                      onChange={(e) => setEditForm({ ...editForm, amount_no_vat: Number(e.target.value) })}
                      className="w-full rounded-xl2 border border-line bg-paper px-3 py-2 text-xs focus:bg-white focus:outline-none tnum"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-muted block mb-1">Tiền thuế VAT (VND)</label>
                    <input
                      type="number"
                      value={editForm.vat_amount || ""}
                      onChange={(e) => setEditForm({ ...editForm, vat_amount: Number(e.target.value) })}
                      className="w-full rounded-xl2 border border-line bg-paper px-3 py-2 text-xs focus:bg-white focus:outline-none tnum"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-semibold text-muted block mb-1">Tổng tiền (tự tính)</label>
                  <input
                    type="text"
                    disabled
                    value={formatVND(editForm.total_amount)}
                    className="w-full rounded-xl2 border border-line bg-line px-3 py-2 text-xs font-bold text-ink tnum"
                  />
                </div>

                {/* Liên kết Dự án & Hợp đồng */}
                <div className="grid grid-cols-2 gap-3 border-t border-line/60 pt-3">
                  <div>
                    <label className="text-[10px] font-semibold text-muted block mb-1">Gán vào dự án</label>
                    <select
                      value={editForm.project_id}
                      onChange={(e) => setEditForm({ ...editForm, project_id: Number(e.target.value), contract_id: 0 })}
                      className="w-full rounded-xl2 border border-line bg-paper px-3 py-2 text-xs focus:bg-white focus:outline-none"
                    >
                      <option value={0}>-- Không gán --</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-muted block mb-1">Gán hợp đồng chi phí</label>
                    <select
                      value={editForm.contract_id}
                      disabled={!editForm.project_id}
                      onChange={(e) => setEditForm({ ...editForm, contract_id: Number(e.target.value) })}
                      className="w-full rounded-xl2 border border-line bg-paper px-3 py-2 text-xs focus:bg-white focus:outline-none disabled:opacity-50"
                    >
                      <option value={0}>-- Không gán --</option>
                      {filteredContracts.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code} - {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Hành động */}
                <div className="pt-4 flex flex-col gap-2">
                  {selectedInvoice.status !== "VERIFIED" ? (
                    <>
                      <button
                        type="button"
                        onClick={() => handleSave("VERIFIED")}
                        className="flex w-full items-center justify-center gap-1.5 rounded-xl2 bg-ok py-3 text-xs font-bold text-white shadow"
                      >
                        <CheckBadgeIcon className="h-4 w-4" />
                        Duyệt & ghi nhận chi phí
                      </button>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleSave()}
                          className="flex-1 rounded-xl2 bg-steel py-2.5 text-xs font-semibold text-white"
                        >
                          Lưu nháp
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSave("REJECTED")}
                          className="rounded-xl2 bg-bad/10 px-4 py-2.5 text-xs font-semibold text-bad"
                        >
                          Từ chối
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="text-center text-xs font-semibold text-ok bg-ok/10 py-3 rounded-xl2">
                      Hóa đơn này đã được duyệt và ghi nhận vào sổ sách chi phí.
                    </p>
                  )}
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </AppShell>
  );
}
