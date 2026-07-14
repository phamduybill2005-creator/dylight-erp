"use client";

// Tab "Hạng mục" — bảng dự toán/khối lượng (BOQ) chi tiết kiểu Excel.
// Mô hình 2 cấp: nhóm cha (parent_id=null) chứa các đầu việc con.
// Sửa trực tiếp từng ô (lưu khi rời ô), tự tính Thành tiền = KL × Đơn giá,
// tiểu tổng mỗi nhóm + tổng dự toán, và xuất ra Excel/CSV.

import { useCallback, useEffect, useState } from "react";
import { PlusIcon, TrashIcon, ArrowDownTrayIcon, TableCellsIcon } from "@heroicons/react/24/outline";
import { StarIcon } from "@heroicons/react/24/solid";
import { api } from "@/lib/api";
import { formatVND, dateLocal } from "@/lib/format";
import { PRESET_DEPARTMENTS } from "@/lib/departments";
import type { ProjectItem, Department } from "@/lib/types";

const num = (v: unknown) => {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
};

/** Chấm sao 1–5 đánh giá hạng mục (0 = chưa chấm). Bấm lại sao đang chọn để bỏ về 0. */
function ItemRating({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label="Đánh giá hạng mục">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n === value ? 0 : n)}
          title={`${n} sao`}
          className={n <= value ? "text-amber" : "text-line hover:text-amber"}
        >
          <StarIcon className="h-3.5 w-3.5" />
        </button>
      ))}
    </span>
  );
}
const lineAmount = (i: ProjectItem) => num(i.quantity) * num(i.unit_price);
const clampPct = (v: unknown) => Math.max(0, Math.min(100, num(v)));

/** Tiến độ 1 nhóm/dự án = bình quân % đầu việc con, ưu tiên theo trọng số thành tiền
 * (giống backend). Chưa nhập tiền -> bình quân đều. Không có đầu việc con -> 0. */
function rollupProgress(kids: ProjectItem[]): number {
  if (!kids.length) return 0;
  const totalAmt = kids.reduce((s, c) => s + lineAmount(c), 0);
  if (totalAmt > 0) return kids.reduce((s, c) => s + clampPct(c.progress) * lineAmount(c), 0) / totalAmt;
  return kids.reduce((s, c) => s + clampPct(c.progress), 0) / kids.length;
}

/** Ô nhập có lưu cục bộ để gõ mượt; chỉ commit (lưu DB) khi giá trị đổi và rời ô. */
function EditableCell({
  value,
  onCommit,
  type = "text",
  placeholder,
  className = "",
}: {
  value: string | number | null | undefined;
  onCommit: (v: string | number) => void;
  type?: "text" | "number";
  placeholder?: string;
  className?: string;
}) {
  // Giữ CHUỖI đang gõ (không ép về số mỗi phím) -> gõ mượt cả số thập phân "12.5", "0,75".
  const [v, setV] = useState<string>(value == null ? "" : String(value));
  const [editing, setEditing] = useState(false);
  // Đồng bộ từ prop khi KHÔNG đang gõ (tránh bị ghi đè lúc đang nhập, vd do tự làm mới).
  useEffect(() => {
    if (!editing) setV(value == null ? "" : String(value));
  }, [value, editing]);

  // "12,5" / "1.234.567" -> số. Chấp nhận dấu phẩy làm dấu thập phân.
  function toNum(s: string): number {
    const cleaned = s.replace(/\s/g, "").replace(",", ".").replace(/[^0-9.\-]/g, "");
    const n = Number(cleaned);
    return isNaN(n) ? 0 : n;
  }

  // Lưu khi rời ô; chỉ gọi onCommit nếu giá trị thực sự đổi.
  function commit() {
    setEditing(false);
    if (type === "number") {
      const nv = v.trim() === "" ? 0 : toNum(v);
      if (nv !== Number(value ?? 0)) onCommit(nv);
      else setV(nv === 0 ? "" : String(nv));
    } else if (v !== (value ?? "")) {
      onCommit(v);
    }
  }

  // Khi KHÔNG gõ: ẩn số 0 cho ô trông trống (như cũ). Khi đang gõ: hiện đúng chuỗi.
  const shown = !editing && type === "number" && (v === "" || Number(v) === 0) ? "" : v;

  return (
    <input
      type="text"
      inputMode={type === "number" ? "decimal" : undefined}
      value={editing ? v : shown}
      placeholder={placeholder}
      onFocus={() => { setEditing(true); if (type === "number" && Number(v) === 0) setV(""); }}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      className={`w-full bg-transparent px-2 py-1.5 text-xs text-ink outline-none focus:bg-amber/5 focus:ring-1 focus:ring-amber rounded ${className}`}
    />
  );
}

export default function ProjectItemsTab({
  projectId,
  canSeeMoney = true,
}: {
  projectId: number;
  /** Nhân viên (STAFF) = false: ẩn cột Khối lượng/Đơn giá/Thành tiền, tiểu tổng, tổng, xuất Excel. */
  canSeeMoney?: boolean;
}) {
  const [items, setItems] = useState<ProjectItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Lọc bảng theo phòng ban phụ trách: "" = tất cả, "__none__" = chưa gán phòng.
  const [deptFilter, setDeptFilter] = useState<string>("");
  // Danh mục phòng ban của công ty (nguồn chân lý từ backend). Lùi về PRESET nếu chưa nạp.
  const [departments, setDepartments] = useState<Department[]>([]);

  // ----- Form "Thêm hạng mục" (nhập từng ô riêng, dễ dùng trên điện thoại) -----
  const [showForm, setShowForm] = useState(false);
  const [fGroupId, setFGroupId] = useState<string>("");   // "" = tạo nhóm mới
  const [fNewGroup, setFNewGroup] = useState("");
  const [fName, setFName] = useState("");
  const [fUnit, setFUnit] = useState("");
  const [fQty, setFQty] = useState("");
  const [fPrice, setFPrice] = useState("");
  const [formBusy, setFormBusy] = useState(false);
  const [formMsg, setFormMsg] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    api
      .projectItems(projectId)
      .then(setItems)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  // Nạp danh mục phòng ban 1 lần để đổ vào ô chọn "Phòng ban phụ trách".
  useEffect(() => {
    api.departments().then(setDepartments).catch(() => {});
  }, []);

  // Tên các phòng để chọn: danh mục từ backend, lùi về PRESET cố định nếu chưa nạp được.
  const deptNames = departments.length ? departments.map((d) => d.name) : PRESET_DEPARTMENTS;

  const groups = items
    .filter((i) => i.parent_id == null)
    .sort((a, b) => a.order_index - b.order_index || a.id - b.id);
  const childrenOf = (gid: number) =>
    items.filter((i) => i.parent_id === gid).sort((a, b) => a.order_index - b.order_index || a.id - b.id);
  const groupSubtotal = (gid: number) => childrenOf(gid).reduce((s, c) => s + lineAmount(c), 0);
  const grandTotal = items.filter((i) => i.parent_id != null).reduce((s, c) => s + lineAmount(c), 0);
  // Tiến độ TỔNG của dự án = tính TỰ ĐỘNG từ các đầu việc con (khớp % ở đầu trang & danh sách).
  const grandProgress = rollupProgress(items.filter((i) => i.parent_id != null));

  // ----- Phân loại theo PHÒNG BAN phụ trách (gán ở cấp nhóm cha) -----
  const chipCls = (on: boolean) =>
    `rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
      on ? "border-steel bg-steel/10 text-steel" : "border-line text-muted hover:bg-paper"
    }`;
  const deptOf = (g: ProjectItem) => (g.department || "").trim();
  // Tổng hợp 1 phòng: số nhóm + tổng dự toán + tiến độ bình quân (theo các đầu việc con).
  const statOf = (gs: ProjectItem[]) => {
    const kids = gs.flatMap((g) => childrenOf(g.id));
    return {
      groups: gs.length,
      total: kids.reduce((s, c) => s + lineAmount(c), 0),
      progress: rollupProgress(kids),
    };
  };
  // Các phòng đang được dùng: theo thứ tự danh mục trước, rồi phòng "lạ" (dữ liệu cũ).
  const deptsInUse = (() => {
    const set = new Set(groups.map(deptOf).filter(Boolean));
    return [
      ...deptNames.filter((d) => set.has(d)),
      ...Array.from(set).filter((d) => !deptNames.includes(d)),
    ];
  })();
  const hasUnassigned = groups.some((g) => !deptOf(g));
  const visibleGroups =
    deptFilter === ""
      ? groups
      : deptFilter === "__none__"
      ? groups.filter((g) => !deptOf(g))
      : groups.filter((g) => deptOf(g) === deptFilter);
  // Khi lọc theo phòng, dòng "Tổng cộng" phản ánh đúng phần đang hiện.
  const visibleChildren = visibleGroups.flatMap((g) => childrenOf(g.id));
  const shownTotal = visibleChildren.reduce((s, c) => s + lineAmount(c), 0);
  const shownProgress = rollupProgress(visibleChildren);
  const filterLabel = deptFilter === "__none__" ? "Chưa gán phòng" : deptFilter;

  // ----- Mutations -----
  async function persist(id: number, patch: Partial<ProjectItem>) {
    setError(null);
    try {
      const updated = await api.updateProjectItem(id, patch);
      setItems((prev) => prev.map((i) => (i.id === id ? updated : i)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lưu hạng mục thất bại.");
      load();
    }
  }

  async function addGroup() {
    setBusy(true);
    setError(null);
    try {
      const maxOrder = Math.max(0, ...groups.map((g) => g.order_index));
      const created = await api.createProjectItem({
        project_id: projectId,
        name: "Hạng mục mới",
        order_index: maxOrder + 1,
      });
      setItems((prev) => [...prev, created]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Thêm nhóm hạng mục thất bại.");
    } finally {
      setBusy(false);
    }
  }

  async function addChild(group: ProjectItem) {
    setBusy(true);
    setError(null);
    try {
      const siblings = childrenOf(group.id);
      const maxOrder = Math.max(0, ...siblings.map((s) => s.order_index));
      const created = await api.createProjectItem({
        project_id: projectId,
        parent_id: group.id,
        name: "",
        unit: "",
        quantity: 0,
        unit_price: 0,
        order_index: maxOrder + 1,
      });
      setItems((prev) => [...prev, created]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Thêm đầu việc thất bại.");
    } finally {
      setBusy(false);
    }
  }

  // Thêm 1 hạng mục qua FORM (từng ô riêng). Giữ form mở để nhập nhiều dòng nhanh.
  async function submitAddForm() {
    const name = fName.trim();
    if (!name) { setFormMsg("Nhập tên hạng mục."); return; }
    const toNum = (s: string) => Number(String(s).replace(/\s/g, "").replace(",", ".")) || 0;
    setFormBusy(true); setFormMsg("");
    try {
      // Nhóm cha: chọn nhóm có sẵn, hoặc tạo nhóm mới từ tên nhập.
      let parentId: number;
      if (fGroupId === "" || fGroupId === "new") {
        const gname = fNewGroup.trim() || "Hạng mục";
        const maxOrder = Math.max(0, ...groups.map((g) => g.order_index));
        const g = await api.createProjectItem({ project_id: projectId, name: gname, order_index: maxOrder + 1 });
        setItems((prev) => [...prev, g]);
        parentId = g.id;
        setFGroupId(String(g.id));   // lần sau thêm tiếp vào nhóm vừa tạo
        setFNewGroup("");
      } else {
        parentId = Number(fGroupId);
      }
      const sibs = items.filter((i) => i.parent_id === parentId);
      const maxOrder = Math.max(0, ...sibs.map((s) => s.order_index));
      const child = await api.createProjectItem({
        project_id: projectId,
        parent_id: parentId,
        name,
        unit: fUnit.trim() || undefined,
        quantity: canSeeMoney ? toNum(fQty) : 0,
        unit_price: canSeeMoney ? toNum(fPrice) : 0,
        order_index: maxOrder + 1,
      });
      setItems((prev) => [...prev, child]);
      // Reset các ô để nhập dòng kế (giữ nhóm đang chọn).
      setFName(""); setFUnit(""); setFQty(""); setFPrice("");
      setFormMsg(`✓ Đã thêm "${name}".`);
    } catch (e) {
      setFormMsg(e instanceof Error ? e.message : "Thêm hạng mục thất bại.");
    } finally {
      setFormBusy(false);
    }
  }

  async function remove(item: ProjectItem) {
    const isGroup = item.parent_id == null;
    const msg = isGroup
      ? `Xoá nhóm "${item.name || "(chưa đặt tên)"}" và toàn bộ đầu việc bên trong?`
      : `Xoá đầu việc "${item.name || "(chưa đặt tên)"}"?`;
    if (typeof window !== "undefined" && !window.confirm(msg)) return;
    setError(null);
    try {
      await api.deleteProjectItem(item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id && i.parent_id !== item.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Xoá hạng mục thất bại.");
    }
  }

  // ----- Xuất Excel (CSV, BOM UTF-8) -----
  function exportCSV() {
    const headers = ["STT", "Mã", "Tên hạng mục", "ĐVT", "Khối lượng", "Đơn giá", "Thành tiền", "% HT", "Ghi chú"];
    const esc = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const rows: string[] = [];
    groups.forEach((g, gi) => {
      rows.push(
        [gi + 1, esc(g.code), esc(g.name), "", "", "", groupSubtotal(g.id).toFixed(0),
         Math.round(rollupProgress(childrenOf(g.id))), esc(g.note)].join(",")
      );
      childrenOf(g.id).forEach((c, ci) => {
        rows.push(
          [
            `${gi + 1}.${ci + 1}`,
            esc(c.code),
            esc(c.name),
            esc(c.unit),
            num(c.quantity),
            num(c.unit_price).toFixed(0),
            lineAmount(c).toFixed(0),
            Math.round(clampPct(c.progress)),
            esc(c.note),
          ].join(",")
        );
      });
    });
    rows.push(["", "", esc("TỔNG CỘNG"), "", "", "", grandTotal.toFixed(0), Math.round(grandProgress), ""].join(","));

    const csv = "﻿" + [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Du_toan_du_an_${projectId}_${dateLocal(new Date())}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return <p className="py-12 text-center text-xs text-muted">Đang tải bảng dự toán...</p>;
  }

  return (
    <div className="space-y-3 lg:space-y-4">
      {/* Thanh tiêu đề + hành động */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold text-muted uppercase lg:text-sm">
            Bảng dự toán chi tiết ({groups.length} nhóm)
          </h3>
          {canSeeMoney && (
            <p className="text-[11px] text-muted lg:text-xs">Tổng dự toán: <span className="font-bold text-ink tnum">{formatVND(grandTotal)}</span></p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => { setShowForm((s) => !s); setFormMsg(""); if (fGroupId === "" && groups.length > 0) setFGroupId(String(groups[0].id)); }}
            className="flex items-center gap-1.5 rounded-xl2 bg-amber px-3 py-2 text-xs font-semibold text-ink shadow hover:bg-amber-deep hover:text-white transition-all"
          >
            <PlusIcon className="h-4 w-4" />
            Thêm hạng mục
          </button>
          {canSeeMoney && (
            <button
              onClick={exportCSV}
              disabled={items.length === 0}
              className="flex items-center gap-1.5 rounded-xl2 bg-steel px-3 py-2 text-xs font-semibold text-white shadow hover:bg-ink transition-all disabled:opacity-50"
            >
              <ArrowDownTrayIcon className="h-4 w-4" />
              Xuất Excel
            </button>
          )}
        </div>
      </div>

      {/* FORM thêm hạng mục — mỗi thông số một ô riêng, dễ nhập (nhất là trên điện thoại) */}
      {showForm && (
        <div className="rounded-xl2 border border-amber/40 bg-amber/5 p-3 shadow-card lg:p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-muted">Nhóm hạng mục</span>
              <select
                value={fGroupId || "new"}
                onChange={(e) => setFGroupId(e.target.value === "new" ? "" : e.target.value)}
                className="w-full rounded-lg border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel"
              >
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name || "(nhóm chưa đặt tên)"}</option>)}
                <option value="new">➕ Tạo nhóm mới…</option>
              </select>
            </label>
            {(fGroupId === "" || groups.length === 0) && (
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-muted">Tên nhóm mới</span>
                <input value={fNewGroup} onChange={(e) => setFNewGroup(e.target.value)} placeholder="VD: Phần móng"
                  className="w-full rounded-lg border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel" />
              </label>
            )}
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-[11px] font-semibold text-muted">Tên đầu việc / công tác <span className="text-bad">*</span></span>
              <input value={fName} onChange={(e) => setFName(e.target.value)} placeholder="VD: Đổ bê tông móng M1"
                className="w-full rounded-lg border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-muted">Đơn vị tính (ĐVT)</span>
              <input value={fUnit} onChange={(e) => setFUnit(e.target.value)} placeholder="m³, m², kg, cái…"
                className="w-full rounded-lg border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel" />
            </label>
            {canSeeMoney && (
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-muted">Khối lượng</span>
                <input value={fQty} onChange={(e) => setFQty(e.target.value)} inputMode="decimal" placeholder="VD: 12.5"
                  className="w-full rounded-lg border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel" />
              </label>
            )}
            {canSeeMoney && (
              <label className="block sm:col-span-2">
                <span className="mb-1 block text-[11px] font-semibold text-muted">Đơn giá (VND)</span>
                <input value={fPrice} onChange={(e) => setFPrice(e.target.value)} inputMode="decimal" placeholder="VD: 1500000"
                  className="w-full rounded-lg border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel" />
              </label>
            )}
          </div>
          {formMsg && <p className={`mt-2 text-[11px] font-medium ${formMsg.startsWith("✓") ? "text-ok" : "text-bad"}`}>{formMsg}</p>}
          <div className="mt-3 flex gap-2">
            <button onClick={submitAddForm} disabled={formBusy}
              className="flex items-center gap-1.5 rounded-xl2 bg-ink px-4 py-2 text-xs font-semibold text-white hover:bg-steel disabled:opacity-50">
              <PlusIcon className="h-4 w-4" /> {formBusy ? "Đang thêm…" : "Thêm vào bảng"}
            </button>
            <button onClick={() => { setShowForm(false); setFormMsg(""); }}
              className="rounded-xl2 border border-line px-4 py-2 text-xs font-semibold text-muted hover:bg-paper">
              Đóng
            </button>
          </div>
        </div>
      )}

      {error && <p className="rounded-lg bg-bad/10 px-3 py-2 text-xs text-bad">{error}</p>}

      {/* Tổng hợp & lọc theo PHÒNG BAN phụ trách (bấm để lọc bảng theo phòng) */}
      {items.length > 0 && (deptsInUse.length > 0 || hasUnassigned) && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-xl2 border border-line bg-white p-2.5 shadow-card">
          <span className="text-[11px] font-semibold text-muted">Theo phòng ban:</span>
          <button type="button" onClick={() => setDeptFilter("")} className={chipCls(deptFilter === "")}>
            Tất cả · {groups.length} nhóm
          </button>
          {deptsInUse.map((d) => {
            const s = statOf(groups.filter((g) => deptOf(g) === d));
            return (
              <button
                type="button"
                key={d}
                onClick={() => setDeptFilter(deptFilter === d ? "" : d)}
                className={chipCls(deptFilter === d)}
                title={`${s.groups} nhóm · tiến độ ${Math.round(s.progress)}%`}
              >
                {d} · {s.groups} nhóm · {Math.round(s.progress)}%
                {canSeeMoney ? ` · ${formatVND(s.total)}` : ""}
              </button>
            );
          })}
          {hasUnassigned && (
            <button
              type="button"
              onClick={() => setDeptFilter(deptFilter === "__none__" ? "" : "__none__")}
              className={chipCls(deptFilter === "__none__")}
            >
              Chưa gán phòng · {groups.filter((g) => !deptOf(g)).length} nhóm
            </button>
          )}
        </div>
      )}

      {items.length === 0 ? (
        <div className="rounded-xl2 bg-white p-8 text-center shadow-card">
          <TableCellsIcon className="mx-auto h-10 w-10 text-line" />
          <p className="mt-2 text-xs text-muted">Chưa có hạng mục dự toán nào cho dự án này.</p>
          <button
            onClick={addGroup}
            disabled={busy}
            className="mt-4 inline-flex items-center gap-1.5 rounded-xl2 bg-amber px-4 py-2 text-xs font-semibold text-ink disabled:opacity-50"
          >
            <PlusIcon className="h-4 w-4" />
            Thêm nhóm hạng mục
          </button>
        </div>
      ) : (
        <>
          {/* Bảng cuộn ngang trên mobile */}
          <div className="overflow-x-auto rounded-xl2 border border-line bg-white shadow-card">
            <table className={`w-full border-collapse text-xs ${canSeeMoney ? "min-w-[820px]" : "min-w-[440px]"}`}>
              <thead>
                <tr className="bg-paper text-[10px] uppercase tracking-wide text-muted">
                  <th className="w-10 px-2 py-2 text-left font-semibold">STT</th>
                  <th className="px-2 py-2 text-left font-semibold">Tên hạng mục</th>
                  <th className="w-16 px-2 py-2 text-left font-semibold">ĐVT</th>
                  {canSeeMoney && <th className="w-20 px-2 py-2 text-right font-semibold">Khối lượng</th>}
                  {canSeeMoney && <th className="w-28 px-2 py-2 text-right font-semibold">Đơn giá</th>}
                  {canSeeMoney && <th className="w-32 px-2 py-2 text-right font-semibold">Thành tiền</th>}
                  <th className="w-32 px-2 py-2 text-left font-semibold">% Hoàn thành</th>
                  <th className="w-8 px-1 py-2" />
                </tr>
              </thead>
              <tbody>
                {visibleGroups.map((g, gi) => {
                  const kids = childrenOf(g.id);
                  return (
                    <GroupRows
                      key={g.id}
                      group={g}
                      groupIndex={gi}
                      kids={kids}
                      subtotal={groupSubtotal(g.id)}
                      groupProgress={rollupProgress(kids)}
                      canSeeMoney={canSeeMoney}
                      deptOptions={deptNames}
                      onPersist={persist}
                      onAddChild={addChild}
                      onRemove={remove}
                      busy={busy}
                    />
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-ink bg-ink text-white">
                  {canSeeMoney ? (
                    <>
                      <td colSpan={5} className="px-2 py-2.5 text-right text-xs font-bold uppercase">
                        {deptFilter ? `Tổng — ${filterLabel}` : "Tổng cộng dự toán"}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-right text-sm font-bold tnum">{formatVND(shownTotal)}</td>
                    </>
                  ) : (
                    <td colSpan={3} className="px-2 py-2.5 text-right text-xs font-bold uppercase">
                      {deptFilter ? `Tiến độ — ${filterLabel}` : "Tiến độ dự án"}
                    </td>
                  )}
                  <td className="px-2 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <div className="h-2 min-w-[40px] flex-1 overflow-hidden rounded-full bg-white/25">
                        <div className="h-full bg-amber" style={{ width: `${clampPct(shownProgress)}%` }} />
                      </div>
                      <span className="w-9 shrink-0 text-right text-xs font-bold tnum">{Math.round(shownProgress)}%</span>
                    </div>
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          <button
            onClick={addGroup}
            disabled={busy}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl2 border border-dashed border-line py-2.5 text-xs font-semibold text-steel hover:border-steel hover:bg-paper transition-all disabled:opacity-50"
          >
            <PlusIcon className="h-4 w-4" />
            Thêm nhóm hạng mục
          </button>
        </>
      )}
    </div>
  );
}

function GroupRows({
  group,
  groupIndex,
  kids,
  subtotal,
  groupProgress,
  canSeeMoney,
  deptOptions,
  onPersist,
  onAddChild,
  onRemove,
  busy,
}: {
  group: ProjectItem;
  groupIndex: number;
  kids: ProjectItem[];
  subtotal: number;
  groupProgress: number;
  canSeeMoney: boolean;
  deptOptions: string[];
  onPersist: (id: number, patch: Partial<ProjectItem>) => void;
  onAddChild: (g: ProjectItem) => void;
  onRemove: (i: ProjectItem) => void;
  busy: boolean;
}) {
  // Số cột nội dung (không tính cột nút xoá) để colSpan cho dòng "Thêm đầu việc".
  // +1 cho cột "% Hoàn thành" (hiện với mọi vai trò).
  const contentCols = canSeeMoney ? 7 : 4;
  return (
    <>
      {/* Dòng nhóm cha */}
      <tr className="border-t border-line bg-steel/5">
        <td className="px-2 py-1.5 text-[11px] font-bold text-ink">{groupIndex + 1}</td>
        <td className="px-1 py-1">
          <EditableCell
            value={group.name}
            onCommit={(v) => onPersist(group.id, { name: String(v) })}
            placeholder="Tên nhóm hạng mục"
            className="font-bold text-ink"
          />
          {/* Phòng ban phụ trách nhóm này — đầu việc con hiểu ngầm theo nhóm. */}
          <div className="mt-0.5 pl-2">
            <select
              value={group.department || ""}
              onChange={(e) => onPersist(group.id, { department: e.target.value || null })}
              className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold outline-none focus:border-steel ${
                group.department
                  ? "border-steel/40 bg-steel/5 text-steel"
                  : "border-line bg-white text-muted"
              }`}
              aria-label="Phòng ban phụ trách"
            >
              <option value="">— Chưa gán phòng —</option>
              {deptOptions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
              {group.department && !deptOptions.includes(group.department) && (
                <option value={group.department}>{group.department}</option>
              )}
            </select>
          </div>
          {/* Đánh giá hạng mục (sao) — chủ trì/quản lý chấm chất lượng hạng mục này. */}
          <div className="mt-1 flex items-center gap-1.5 pl-2">
            <span className="text-[10px] font-semibold text-muted">Đánh giá:</span>
            <ItemRating value={num(group.rating)} onChange={(n) => onPersist(group.id, { rating: n })} />
          </div>
        </td>
        {/* STAFF không có 3 cột tiền: vẫn phải chừa 1 ô cho cột ĐVT để thẳng hàng với header. */}
        {canSeeMoney ? (
          <>
            <td colSpan={2} />
            <td className="px-2 py-1.5 text-right text-[10px] text-muted">Tiểu tổng</td>
            <td className="whitespace-nowrap px-2 py-1.5 text-right text-xs font-bold text-ink tnum">{formatVND(subtotal)}</td>
          </>
        ) : (
          <td />
        )}
        {/* Tiến độ nhóm (tự tính từ các đầu việc con) */}
        <td className="px-2 py-1.5">
          <div className="flex items-center gap-1.5">
            <div className="h-1.5 min-w-[32px] flex-1 overflow-hidden rounded-full bg-line">
              <div className="h-full bg-steel" style={{ width: `${clampPct(groupProgress)}%` }} />
            </div>
            <span className="w-8 shrink-0 text-right text-[10px] font-bold text-steel tnum">{Math.round(groupProgress)}%</span>
          </div>
        </td>
        <td className="px-1 py-1 text-center">
          <button
            onClick={() => onRemove(group)}
            title="Xoá nhóm"
            aria-label={`Xoá nhóm hạng mục ${group.name || ""}`.trim()}
            className="rounded p-1 text-muted hover:bg-bad/10 hover:text-bad focus:outline-none focus:ring-2 focus:ring-bad"
          >
            <TrashIcon className="h-3.5 w-3.5" />
          </button>
        </td>
      </tr>

      {/* Các đầu việc con */}
      {kids.map((c, ci) => (
        <tr key={c.id} className="border-t border-line/60">
          <td className="px-2 py-1 text-[10px] text-muted">
            {groupIndex + 1}.{ci + 1}
          </td>
          <td className="px-1 py-0.5 pl-3">
            <EditableCell
              value={c.name}
              onCommit={(v) => onPersist(c.id, { name: String(v) })}
              placeholder="Tên đầu việc / công tác..."
            />
          </td>
          <td className="px-1 py-0.5">
            <EditableCell value={c.unit} onCommit={(v) => onPersist(c.id, { unit: String(v) })} placeholder="m³, m², kg..." />
          </td>
          {canSeeMoney && (
            <td className="px-1 py-0.5">
              <EditableCell
                type="number"
                value={c.quantity}
                onCommit={(v) => onPersist(c.id, { quantity: Number(v) })}
                className="text-right"
              />
            </td>
          )}
          {canSeeMoney && (
            <td className="px-1 py-0.5">
              <EditableCell
                type="number"
                value={c.unit_price}
                onCommit={(v) => onPersist(c.id, { unit_price: Number(v) })}
                className="text-right"
              />
            </td>
          )}
          {canSeeMoney && (
            <td className="whitespace-nowrap px-2 py-1 text-right text-xs font-semibold text-ink tnum">{formatVND(lineAmount(c))}</td>
          )}
          {/* % Hoàn thành đầu việc — gõ trực tiếp (0..100). Ai cũng sửa được (không phải tiền). */}
          <td className="px-1 py-0.5">
            <div className="flex items-center gap-1.5">
              <div className="h-1.5 min-w-[28px] flex-1 overflow-hidden rounded-full bg-line">
                <div className="h-full bg-ok" style={{ width: `${clampPct(c.progress)}%` }} />
              </div>
              <div className="w-11 shrink-0">
                <EditableCell
                  type="number"
                  value={c.progress}
                  onCommit={(v) => onPersist(c.id, { progress: clampPct(v) })}
                  className="text-right"
                  placeholder="0"
                />
              </div>
              <span className="text-[10px] text-muted">%</span>
            </div>
          </td>
          <td className="px-1 py-1 text-center">
            <button
              onClick={() => onRemove(c)}
              title="Xoá đầu việc"
              aria-label={`Xoá đầu việc ${c.name || ""}`.trim()}
              className="rounded p-1 text-muted hover:bg-bad/10 hover:text-bad focus:outline-none focus:ring-2 focus:ring-bad"
            >
              <TrashIcon className="h-3.5 w-3.5" />
            </button>
          </td>
        </tr>
      ))}

      {/* Nút thêm đầu việc vào nhóm */}
      <tr className="border-t border-line/40">
        <td />
        <td colSpan={contentCols} className="px-1 py-1">
          <button
            onClick={() => onAddChild(group)}
            disabled={busy}
            className="flex items-center gap-1 pl-2 text-[11px] font-semibold text-steel hover:text-ink disabled:opacity-50"
          >
            <PlusIcon className="h-3.5 w-3.5" />
            Thêm đầu việc
          </button>
        </td>
      </tr>
    </>
  );
}
