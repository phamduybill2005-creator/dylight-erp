"use client";

// Trang Dự án & Hợp đồng — trình bày dạng BẢNG (kiểu Excel): kẻ ô, hàng/cột,
// có dòng tổng cộng. Cột tài chính (Giá trị HĐ / Chi phí / Lãi-lỗ) chỉ hiện cho
// Giám đốc; Quản lý thấy bảng vận hành (không có tiền). Bấm 1 hàng để mở chi tiết.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon, XMarkIcon, CheckIcon } from "@heroicons/react/24/outline";
import AppShell from "@/components/app-shell";
import { api } from "@/lib/api";
import { isDirector, isManagerUp } from "@/lib/roles";
import { formatCompactVND } from "@/lib/format";
import type { Project, ProjectProfit, User } from "@/lib/types";

const PROJECT_STATUS: Record<string, { label: string; cls: string }> = {
  PLANNING: { label: "Chuẩn bị", cls: "bg-line text-muted" },
  ACTIVE: { label: "Đang thi công", cls: "bg-steel/10 text-steel" },
  ON_HOLD: { label: "Tạm dừng", cls: "bg-amber/20 text-amber-deep" },
  COMPLETED: { label: "Hoàn thành", cls: "bg-ok/15 text-ok" },
  CANCELLED: { label: "Đã hủy", cls: "bg-bad/15 text-bad" },
};

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [profit, setProfit] = useState<Record<number, ProjectProfit>>({});
  const [showFinance, setShowFinance] = useState(false);

  // Thêm dự án — mặc định FORM từng ô; "bulk" = dán nhiều dòng từ Excel (tùy chọn).
  const [showAdd, setShowAdd] = useState(false);
  const [addMode, setAddMode] = useState<"form" | "bulk">("form");
  const [bulkText, setBulkText] = useState("");
  const [creating, setCreating] = useState(false);
  const [addResult, setAddResult] = useState("");

  // FORM 1 dự án — từng ô riêng.
  const [nfCode, setNfCode] = useState("");
  const [nfName, setNfName] = useState("");
  const [nfGroup, setNfGroup] = useState("");
  const [nfGeo, setNfGeo] = useState("");
  const [nfDosco, setNfDosco] = useState("");
  // Danh sách GEO担当 / DOSCO担当 đã dùng -> để CHỌN (datalist) khỏi gõ tay.
  const [mgrs, setMgrs] = useState<{ geo: string[]; dosco: string[] }>({ geo: [], dosco: [] });

  // Người chủ trì (lead) áp dụng cho các dự án tạo trong đợt này (tùy chọn).
  const [leadId, setLeadId] = useState<number | "">("");
  const [users, setUsers] = useState<User[]>([]);
  const [canManage, setCanManage] = useState(false);

  useEffect(() => {
    let alive = true;
    // Nạp danh sách dự án + (Giám đốc) lãi/lỗ — dùng cho lần đầu và polling.
    function loadProjects(director: boolean) {
      api.projects().then((d) => alive && setProjects(d)).catch(() => {});
      if (director) {
        api
          .profitByProject()
          .then((rows) => alive && setProfit(Object.fromEntries(rows.map((r) => [r.project_id, r]))))
          .catch(() => {});
      }
    }

    let timer: ReturnType<typeof setInterval> | undefined;
    // Số liệu lãi/lỗ theo dự án chỉ dành cho Giám đốc — Quản lý không tải (tránh 403).
    api.me()
      .then((me) => {
        if (!alive) return;
        if (isManagerUp(me.role)) {
          setCanManage(true);
          // Danh sách nhân sự để chọn người chủ trì khi tạo dự án.
          api.users().then((d) => alive && setUsers(d)).catch(() => {});
          // Danh sách GEO担当/DOSCO担当 đã dùng để chọn nhanh.
          api.projectManagers().then((d) => alive && setMgrs(d)).catch(() => {});
        }
        const director = isDirector(me.role);
        if (director) setShowFinance(true);
        loadProjects(director);
        // Cập nhật gần thời gian thực (~20s) — theo dõi trạng thái/tiến độ dự án.
        timer = setInterval(() => {
          if (document.visibilityState === "visible") loadProjects(director);
        }, 20_000);
      })
      .catch(() => {});
    return () => { alive = false; if (timer) clearInterval(timer); };
  }, []);

  // Tổng cộng các cột tài chính (chỉ tính dự án có dữ liệu lãi/lỗ).
  const totals = projects.reduce(
    (acc, p) => {
      const fin = profit[p.id];
      if (fin) {
        acc.contract += Number(fin.contract_value);
        acc.cost += Number(fin.cost);
        acc.profit += Number(fin.profit);
      }
      return acc;
    },
    { contract: 0, cost: 0, profit: 0 }
  );
  const totalMargin = totals.contract > 0 ? (totals.profit / totals.contract) * 100 : 0;

  // Mỗi dòng 1 dự án; cột ngăn cách bằng phẩy / Tab / ; / | :
  // Mã QL, Tên dự án, Nhóm, GEO担当, DOSCO担当 (dán thẳng từ Excel).
  // Nếu cột ĐẦU là số thứ tự (番号) thì tự bỏ qua.
  function parseBulk(text: string, startIndex: number) {
    return text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line, idx) => {
        let parts = line.split(/[\t,;|]/).map((s) => s.trim());
        // Bỏ cột 番号 (số thứ tự) nếu dòng có >2 cột và cột đầu chỉ là số.
        if (parts.length > 2 && /^\d+$/.test(parts[0])) parts = parts.slice(1);
        let code = "";
        let name = "";
        if (parts.length === 1) {
          name = parts[0];
        } else {
          code = parts[0] || "";
          name = parts[1] || "";
        }
        const group_name = parts[2] || "";
        const geo_manager = parts[3] || "";
        const dosco_manager = parts[4] || "";
        if (!name) name = code;
        if (!code) code = `DA${String(startIndex + idx + 1).padStart(3, "0")}`;
        return {
          code, name,
          group_name: group_name || null,
          geo_manager: geo_manager || null,
          dosco_manager: dosco_manager || null,
        };
      })
      .filter((p) => p.name);
  }

  const previewCount = parseBulk(bulkText, projects.length).length;

  async function handleBulkCreate() {
    const items = parseBulk(bulkText, projects.length);
    if (items.length === 0) {
      setAddResult("Hãy nhập ít nhất 1 dòng — mỗi dòng một dự án (tối thiểu là tên dự án).");
      return;
    }
    setCreating(true);
    setAddResult("");
    const lead = leadId === "" ? {} : { lead_id: Number(leadId) };
    const results = await Promise.allSettled(items.map((it) => api.createProject({ ...it, ...lead })));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const fails = items.filter((_, i) => results[i].status === "rejected").map((it) => it.name);
    const fresh = await api.projects().catch(() => null);
    if (fresh) setProjects(fresh);
    setAddResult(
      `Đã tạo ${ok}/${items.length} dự án.` + (fails.length ? ` Lỗi: ${fails.join(", ")}` : "")
    );
    if (fails.length === 0) setBulkText("");
    setCreating(false);
  }

  // Tạo 1 dự án qua FORM từng ô riêng.
  async function handleCreateOne() {
    const name = nfName.trim();
    if (!name) { setAddResult("Vui lòng nhập Tên dự án."); return; }
    setCreating(true);
    setAddResult("");
    try {
      const created = await api.createProject({
        code: nfCode.trim() || `DA${String(projects.length + 1).padStart(3, "0")}`,
        name,
        group_name: nfGroup.trim() || null,
        geo_manager: nfGeo.trim() || null,
        dosco_manager: nfDosco.trim() || null,
        lead_id: leadId === "" ? null : Number(leadId),
      });
      const fresh = await api.projects().catch(() => null);
      if (fresh) setProjects(fresh);
      // Reset để nhập dự án kế tiếp nhanh.
      setNfCode(""); setNfName(""); setNfGroup(""); setNfGeo(""); setNfDosco("");
      setAddResult(`✓ Đã tạo dự án "${created.name}".`);
    } catch (e) {
      setAddResult(e instanceof Error ? e.message : "Tạo dự án thất bại.");
    } finally {
      setCreating(false);
    }
  }

  const TH = "border border-line px-3 py-2 font-semibold whitespace-nowrap";
  const TD = "border border-line px-3 py-2 align-middle";
  // Số cột phần "thông tin" (trước các cột tiền) để gộp ô cho dòng TỔNG CỘNG.
  // STT, Mã QL, Tên, Nhóm, GEO担当, DOSCO担当, Trạng thái, Tiến độ = 8 cột.
  const infoCols = 8;

  return (
    <AppShell>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink lg:text-2xl">Dự án & Hợp đồng</h1>
          <p className="mt-0.5 text-xs text-muted lg:text-sm">
            Theo dõi vòng đời dự án từ đấu thầu tới quyết toán.
          </p>
        </div>
        <button
          onClick={() => { setShowAdd(true); setAddResult(""); }}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-xl2 bg-ink px-3.5 py-2.5 text-xs font-semibold text-white shadow-card hover:bg-steel transition-colors"
        >
          <PlusIcon className="h-4 w-4" /> Thêm dự án
        </button>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl2 border border-line bg-white shadow-card">
        <table className="w-full min-w-[680px] border-collapse text-sm">
          <thead>
            <tr className="bg-paper text-left text-[11px] uppercase tracking-wide text-muted">
              <th className={`${TH} w-10 text-center`}>STT</th>
              <th className={TH}>Mã QL</th>
              <th className={TH}>Tên dự án</th>
              <th className={TH}>Nhóm</th>
              <th className={TH}>GEO担当</th>
              <th className={TH}>DOSCO担当</th>
              <th className={TH}>Trạng thái</th>
              <th className={TH}>Tiến độ</th>
              {showFinance && <th className={`${TH} text-right`}>Giá trị HĐ</th>}
              {showFinance && <th className={`${TH} text-right`}>Chi phí</th>}
              {showFinance && <th className={`${TH} text-right`}>Lãi / lỗ</th>}
              {showFinance && <th className={`${TH} text-right`}>Biên %</th>}
            </tr>
          </thead>
          <tbody>
            {projects.length === 0 && (
              <tr>
                <td className={`${TD} text-center text-muted`} colSpan={showFinance ? infoCols + 4 : infoCols}>
                  Chưa có dự án nào.
                </td>
              </tr>
            )}

            {projects.map((p, i) => {
              const st = PROJECT_STATUS[p.status] ?? PROJECT_STATUS.PLANNING;
              const fin = profit[p.id];
              const positive = fin ? Number(fin.profit) >= 0 : true;
              return (
                <tr
                  key={p.id}
                  onClick={() => router.push(`/projects/${p.id}`)}
                  className="cursor-pointer transition-colors odd:bg-white even:bg-paper/40 hover:bg-amber/10"
                >
                  <td className={`${TD} text-center text-muted tnum`}>{i + 1}</td>
                  <td className={`${TD} font-mono text-[12px] text-steel whitespace-nowrap`}>{p.code}</td>
                  <td className={`${TD} font-semibold text-ink`}>{p.name}</td>
                  <td className={`${TD} text-muted whitespace-nowrap`}>{p.group_name || "—"}</td>
                  <td className={`${TD} text-muted whitespace-nowrap`}>{p.geo_manager || "—"}</td>
                  <td className={`${TD} text-muted whitespace-nowrap`}>{p.dosco_manager || "—"}</td>
                  <td className={TD}>
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${st.cls}`}>
                      {st.label}
                    </span>
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>
                    <div className="flex items-center gap-1.5">
                      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-line">
                        <div className="h-full bg-steel" style={{ width: `${Math.max(0, Math.min(100, Math.round(Number(p.progress_percent ?? 0))))}%` }} />
                      </div>
                      <span className="text-[11px] tnum text-muted">{Math.round(Number(p.progress_percent ?? 0))}%</span>
                    </div>
                  </td>
                  {showFinance && (
                    <td className={`${TD} text-right tnum whitespace-nowrap`}>
                      {fin ? formatCompactVND(fin.contract_value) : "—"}
                    </td>
                  )}
                  {showFinance && (
                    <td className={`${TD} text-right tnum whitespace-nowrap`}>
                      {fin ? formatCompactVND(fin.cost) : "—"}
                    </td>
                  )}
                  {showFinance && (
                    <td className={`${TD} text-right tnum whitespace-nowrap font-semibold ${positive ? "text-ok" : "text-bad"}`}>
                      {fin ? formatCompactVND(fin.profit) : "—"}
                    </td>
                  )}
                  {showFinance && (
                    <td className={`${TD} text-right tnum whitespace-nowrap font-semibold ${positive ? "text-ok" : "text-bad"}`}>
                      {fin ? `${Number(fin.margin_percent).toFixed(1)}%` : "—"}
                    </td>
                  )}
                </tr>
              );
            })}

            {/* Dòng TỔNG CỘNG (chỉ Giám đốc) */}
            {showFinance && projects.length > 0 && (
              <tr className="bg-ink/5 font-bold text-ink">
                <td className={`${TD} text-right`} colSpan={infoCols}>
                  TỔNG CỘNG
                </td>
                <td className={`${TD} text-right tnum whitespace-nowrap`}>{formatCompactVND(totals.contract)}</td>
                <td className={`${TD} text-right tnum whitespace-nowrap`}>{formatCompactVND(totals.cost)}</td>
                <td className={`${TD} text-right tnum whitespace-nowrap ${totals.profit >= 0 ? "text-ok" : "text-bad"}`}>
                  {formatCompactVND(totals.profit)}
                </td>
                <td className={`${TD} text-right tnum whitespace-nowrap ${totalMargin >= 0 ? "text-ok" : "text-bad"}`}>
                  {totalMargin.toFixed(1)}%
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[11px] text-muted">Bấm vào một hàng để xem chi tiết dự án.</p>

      {/* Thêm nhanh nhiều dự án — dán từ Excel, mỗi dòng 1 dự án */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink/50 backdrop-blur-sm">
          <div className="flex h-full w-full max-w-lg flex-col bg-paper shadow-2xl animate-slide-in">
            <header className="flex items-center justify-between border-b border-line bg-white px-4 py-3">
              <div className="flex items-center gap-2">
                <PlusIcon className="h-5 w-5 text-steel" />
                <h2 className="text-sm font-bold text-ink">Thêm nhanh dự án</h2>
              </div>
              <button onClick={() => setShowAdd(false)} className="rounded-full p-1.5 text-muted hover:bg-paper hover:text-ink">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </header>

            {/* Chọn cách thêm: điền từng ô (mặc định) hoặc dán nhiều dòng */}
            <div className="flex gap-2 border-b border-line bg-white px-4 py-2">
              <button
                onClick={() => { setAddMode("form"); setAddResult(""); }}
                className={`flex-1 rounded-xl2 py-1.5 text-xs font-semibold ${addMode === "form" ? "bg-ink text-white" : "border border-line text-muted hover:bg-paper"}`}
              >
                Điền từng ô
              </button>
              <button
                onClick={() => { setAddMode("bulk"); setAddResult(""); }}
                className={`flex-1 rounded-xl2 py-1.5 text-xs font-semibold ${addMode === "bulk" ? "bg-ink text-white" : "border border-line text-muted hover:bg-paper"}`}
              >
                Dán nhiều dòng (Excel)
              </button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {addMode === "form" ? (
                <>
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-semibold text-muted">Tên dự án <span className="text-bad">*</span></span>
                    <input value={nfName} onChange={(e) => setNfName(e.target.value)} placeholder="VD: Cầu Sông Hàn"
                      className="w-full rounded-xl2 border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel" />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-semibold text-muted">Mã QL (管理番号)</span>
                      <input value={nfCode} onChange={(e) => setNfCode(e.target.value)} placeholder="Tự sinh nếu trống"
                        className="w-full rounded-xl2 border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel" />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-semibold text-muted">Nhóm (グループ)</span>
                      <input value={nfGroup} onChange={(e) => setNfGroup(e.target.value)} placeholder="VD: Nhóm A"
                        className="w-full rounded-xl2 border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel" />
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-semibold text-muted">GEO担当 (chọn hoặc gõ)</span>
                      <input list="geo-mgr-list" value={nfGeo} onChange={(e) => setNfGeo(e.target.value)} placeholder="Bấm để chọn…"
                        className="w-full rounded-xl2 border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel" />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-semibold text-muted">DOSCO担当 (chọn hoặc gõ)</span>
                      <input list="dosco-mgr-list" value={nfDosco} onChange={(e) => setNfDosco(e.target.value)} placeholder="Bấm để chọn…"
                        className="w-full rounded-xl2 border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel" />
                    </label>
                    <datalist id="geo-mgr-list">{mgrs.geo.map((n) => <option key={n} value={n} />)}</datalist>
                    <datalist id="dosco-mgr-list">{mgrs.dosco.map((n) => <option key={n} value={n} />)}</datalist>
                  </div>
                  {canManage && (
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-semibold text-muted">Người chủ trì (chỉ huy trưởng)</span>
                      <select value={leadId} onChange={(e) => setLeadId(e.target.value === "" ? "" : Number(e.target.value))}
                        className="w-full rounded-xl2 border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel">
                        <option value="">— Chưa chỉ định —</option>
                        {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                      </select>
                    </label>
                  )}
                  {addResult && <p className={`text-xs font-medium ${addResult.startsWith("✓") ? "text-ok" : "text-bad"}`}>{addResult}</p>}
                </>
              ) : (
                <>
                  <p className="text-xs text-muted">
                    Dán thẳng từ Excel, <b className="text-ink">mỗi dòng một dự án</b>, theo thứ tự{" "}
                    <b className="text-ink">Mã QL, Tên dự án, Nhóm, GEO担当, DOSCO担当</b> (ngăn cách bằng Tab/phẩy).
                    Nếu có cột số thứ tự (番号) ở đầu thì tự bỏ qua. Cột nào trống cứ để trống.
                  </p>
                  <div className="rounded-xl2 bg-white p-3 font-mono text-[11px] leading-relaxed text-muted shadow-card">
                    2738-0480, ERE三種五城目, 土木設計, 池上, DUC<br />
                    2735-0214, 松阪飯南, 土木設計, 池上, CAO
                  </div>
                  {canManage && (
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-semibold text-muted">Người chủ trì — áp dụng cho tất cả dự án tạo lần này</span>
                      <select value={leadId} onChange={(e) => setLeadId(e.target.value === "" ? "" : Number(e.target.value))}
                        className="w-full rounded-xl2 border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel">
                        <option value="">— Chưa chỉ định —</option>
                        {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                      </select>
                    </label>
                  )}
                  <textarea value={bulkText} onChange={(e) => setBulkText(e.target.value)} rows={10}
                    className="w-full rounded-xl2 border border-line bg-white px-3 py-2 font-mono text-xs outline-none focus:border-steel"
                    placeholder={"QL-01, Cầu Sông Hàn, Nhóm A\nQL-02, Đường tránh QL1, Nhóm B"} />
                  {addResult && <p className="text-xs font-medium text-ink">{addResult}</p>}
                </>
              )}
            </div>

            <footer className="flex items-center justify-end gap-2 border-t border-line bg-white p-4">
              {addMode === "bulk" && (
                <span className="mr-auto text-[11px] text-muted">Sẽ tạo <b className="text-ink">{previewCount}</b> dự án</span>
              )}
              <button onClick={() => setShowAdd(false)} className="rounded-xl2 border border-line px-4 py-2.5 text-xs font-semibold text-muted hover:bg-paper">
                Đóng
              </button>
              {addMode === "form" ? (
                <button onClick={handleCreateOne} disabled={creating}
                  className="inline-flex items-center gap-1.5 rounded-xl2 bg-ink px-4 py-2.5 text-xs font-semibold text-white hover:bg-steel disabled:opacity-50">
                  {creating ? "Đang tạo…" : <><CheckIcon className="h-4 w-4" /> Tạo dự án</>}
                </button>
              ) : (
                <button onClick={handleBulkCreate} disabled={creating}
                  className="inline-flex items-center gap-1.5 rounded-xl2 bg-ink px-4 py-2.5 text-xs font-semibold text-white hover:bg-steel disabled:opacity-50">
                  {creating ? "Đang tạo…" : <><CheckIcon className="h-4 w-4" /> Tạo {previewCount} dự án</>}
                </button>
              )}
            </footer>
          </div>
        </div>
      )}
    </AppShell>
  );
}
