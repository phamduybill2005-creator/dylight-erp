"use client";

// Trang Dự án & Hợp đồng — trình bày dạng BẢNG (kiểu Excel): kẻ ô, hàng/cột,
// có dòng tổng cộng. Cột tài chính (Giá trị HĐ / Chi phí / Lãi-lỗ) chỉ hiện cho
// Giám đốc; Quản lý thấy bảng vận hành (không có tiền). Bấm 1 hàng để mở chi tiết.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon, XMarkIcon, CheckIcon, PencilSquareIcon, TrashIcon, ArchiveBoxIcon } from "@heroicons/react/24/outline";
import AppShell from "@/components/app-shell";
import FilterBar, { NO_FILTERS, splitDepts, type Filters } from "@/components/filter-bar";
import PersonPicker from "@/components/person-picker";
import ArchiveModal from "@/components/archive-modal";
import { api } from "@/lib/api";
import { isManagerUp, isSeniorManagerUp } from "@/lib/roles";
import { PRESET_DEPARTMENTS } from "@/lib/departments";
import { PROJECT_GROUPS, groupLabel, DEPT_JA, normalizeDept, geoDeptOf, getProjectDept } from "@/lib/groups";
import type { Project, User, ProjectStatus } from "@/lib/types";
import { useEscapeKey } from "@/lib/use-escape-key";

const PROJECT_STATUS: Record<string, { label: string; cls: string }> = {
  PLANNING: { label: "Chuẩn bị", cls: "bg-line text-muted" },
  IN_PROGRESS: { label: "Đang làm", cls: "bg-steel/10 text-steel" },
  ON_HOLD: { label: "Tạm dừng", cls: "bg-amber/20 text-amber-deep" },
  COMPLETED: { label: "Hoàn thành", cls: "bg-ok/15 text-ok" },
  CLOSED: { label: "Đã đóng", cls: "bg-bad/15 text-bad" },
};

function computeAutoStatus(p: Project): string {
  const pct = Math.round(Number(p.progress_percent ?? 0));
  const hasStart = !!p.start_date;
  const hasEnd = !!p.end_date;

  if (p.status === "ON_HOLD" || p.status === "CLOSED") {
    if (pct < 100 && !hasEnd) return p.status;
  }

  if (pct >= 100 || hasEnd) return "COMPLETED";
  if (pct > 0 || hasStart) return "IN_PROGRESS";
  return "PLANNING";
}

/** Ngày gọn cho bảng: "2026-07-24" -> "24/07" (bỏ năm cho đỡ chiếm chỗ). */
function dm(s?: string | null): string {
  const v = (s || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v.slice(8, 10)}/${v.slice(5, 7)}` : "—";
}

function calculateDuration(start?: string | null, end?: string | null, deadline?: string | null): string {
  if (!start) return "—";
  const startDate = new Date(start);
  if (isNaN(startDate.getTime())) return "—";

  if (end) {
    const endDate = new Date(end);
    if (!isNaN(endDate.getTime())) {
      const diffTime = endDate.getTime() - startDate.getTime();
      const diffDays = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
      return `${diffDays} ngày`;
    }
  }

  if (deadline) {
    const deadlineDate = new Date(deadline);
    if (!isNaN(deadlineDate.getTime())) {
      const diffTime = deadlineDate.getTime() - startDate.getTime();
      const diffDays = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
      return `${diffDays} ngày`;
    }
  }

  return "—";
}

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  // Bộ lọc: theo phòng ban (thành viên) / người chủ trì / dự án cụ thể.
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);

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
  const [nfEval, setNfEval] = useState("");
  const [nfStartDate, setNfStartDate] = useState("");
  const [nfEndDate, setNfEndDate] = useState("");
  const [nfInternalDeadline, setNfInternalDeadline] = useState("");
  const [nfTemplateId, setNfTemplateId] = useState("");
  // Danh sách GEO担当 / DOSCO担当 đã dùng -> để CHỌN (datalist) khỏi gõ tay.
  const [mgrs, setMgrs] = useState<{ geo: string[]; dosco: string[] }>({ geo: [], dosco: [] });

  // Người chủ trì (lead) áp dụng cho các dự án tạo trong đợt này (tùy chọn).
  const [leadId, setLeadId] = useState<number | "">("");
  const [users, setUsers] = useState<User[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [me, setMe] = useState<User | null>(null);
  const [evalEdits, setEvalEdits] = useState<Record<number, string>>({});   // ĐÁNH GIÁ đang gõ dở
  // XOÁ nhanh dự án: tầng 1 (Giám đốc/Quản trị) + tầng 2 (Quản lý cấp cao = quản lý
  // KHÔNG có ai quản lý bên trên). Khớp đúng gate ở backend.
  const canDelete =
    !!me &&
    (me.role === "ADMIN" ||
      me.role === "DIRECTOR" ||
      ((me.role === "MANAGER" || !!me.has_subordinates) && !me.manager_id && !me.manager_ids));
  /** Nhập GHI CHÚ: lãnh đạo cấp 1 + cấp 2 (canDelete) HOẶC chính CHỦ TRÌ dự án đó. */
  const canEditEval = (p: Project) => canDelete || (!!me && p.lead_id === me.id);
  /** SỬA dự án: từ quản lý trở lên (gồm quản lý cấp trung dù vai trò còn là Nhân viên)
   *  hoặc chính chủ trì. NHÂN VIÊN thuần KHÔNG được sửa -> ẩn luôn nút. */
  const canEditProject = (p: Project) =>
    canManage || !!me?.has_subordinates || (!!me && p.lead_id === me.id);

  // Gợi ý dự án mẫu CHỈ MỘT LẦN (lúc nạp xong danh sách). Trước đây effect chạy lại mỗi
  // khi ô rỗng -> chọn "— Không sao chép hạng mục —" xong bị tự điền lại. Nay người dùng
  // chọn gì thì giữ nguyên.
  const templateAutoPicked = useRef(false);
  useEffect(() => {
    if (templateAutoPicked.current || projects.length === 0) return;
    templateAutoPicked.current = true;
    const template = projects.find((p) => p.code === "2739-0124" || p.name.includes("いちき串木野"));
    if (template) setNfTemplateId(String(template.id));
  }, [projects]);

  // Bộ lọc tìm kiếm
  const [searchQuery, setSearchQuery] = useState("");
  const [filterLead, setFilterLead] = useState("");
  const [filterDept, setFilterDept] = useState("");
  // Lọc theo THÁNG NHẬN dự án, dạng "YYYY-MM" (khớp tiền tố của start_date "YYYY-MM-DD").
  const [filterMonth, setFilterMonth] = useState("");

  // State Sửa dự án
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [efCode, setEfCode] = useState("");
  const [efName, setEfName] = useState("");
  const [efGroup, setEfGroup] = useState("");
  const [efGeo, setEfGeo] = useState("");
  const [efDosco, setEfDosco] = useState("");
  const [efEval, setEfEval] = useState("");
  const [efStatus, setEfStatus] = useState("PLANNING");
  const [efStartDate, setEfStartDate] = useState("");
  const [efEndDate, setEfEndDate] = useState("");
  const [efInternalDeadline, setEfInternalDeadline] = useState("");
  const [efLeadId, setEfLeadId] = useState<number | "">("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [archiveModal, setArchiveModal] = useState(false);

  /** Lưu ĐÁNH GIÁ gõ trực tiếp trên bảng (rời ô là lưu). Đang gõ thì không bị
   *  vòng tự làm mới 20s ghi đè, vì ưu tiên giá trị trong evalEdits. */
  async function saveEvaluation(p: Project) {
    const draft = evalEdits[p.id];
    if (draft === undefined) return;
    const clear = () =>
      setEvalEdits((s) => {
        const n = { ...s };
        delete n[p.id];
        return n;
      });
    const next = draft.trim();
    if (next === (p.evaluation || "")) {
      clear();
      return;
    }
    try {
      const updated = await api.updateProject(p.id, { evaluation: next || null });
      setProjects((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    } catch (err: any) {
      alert(err?.message || "Không lưu được ghi chú.");
    } finally {
      clear();
    }
  }

  // Lọc người phụ trách theo PHÒNG BAN (Nhóm) đang chọn.
  //  - Phía Nhật (GEO担当): map cứng qua geoDeptOf.
  //  - Phía Việt (DOSCO担当): theo cột department của nhân sự.
  // Chưa chọn phòng -> hiện tất cả. Phòng không có ai -> cũng hiện tất cả (khỏi kẹt).
  // Luôn kèm GIÁ TRỊ ĐANG CHỌN để không mất khi đổi phòng.
  const geoOptsFor = (group: string, current: string) => {
    const dept = normalizeDept(group);
    const filtered = dept ? mgrs.geo.filter((n) => geoDeptOf(n) === dept) : mgrs.geo;
    const base = filtered.length ? filtered : mgrs.geo;
    return current && !base.includes(current) ? [current, ...base] : base;
  };
  const doscoOptsFor = (group: string, current: string) => {
    const dept = normalizeDept(group);
    const all = [...users.map((u) => u.full_name), ...mgrs.dosco];
    const inDept = users
      .filter((u) => splitDepts(u.department).map(normalizeDept).includes(dept))
      .map((u) => u.full_name);
    const base = dept ? (inDept.length ? inDept : all) : all;
    return current && !base.includes(current) ? [current, ...base] : base;
  };

  /** Xoá nhanh 1 dự án ngay ở cột Thao tác (chỉ tầng 1 + 2). */
  async function handleQuickDelete(p: Project) {
    if (!canDelete) return;
    const ok = window.confirm(
      `XOÁ HẲN dự án "${p.name}"${p.code ? ` (${p.code})` : ""}?\n\n` +
        "Toàn bộ hạng mục, tiến độ, giờ công, hợp đồng… của dự án sẽ bị xoá theo. KHÔNG hoàn tác.",
    );
    if (!ok) return;
    try {
      await api.deleteProject(p.id);
      setProjects((prev) => prev.filter((x) => x.id !== p.id));
    } catch (err: any) {
      alert(err?.message || "Không xoá được dự án.");
    }
  }

  const openEditModal = (p: Project) => {
    setEditingProject(p);
    setEfCode(p.code || "");
    setEfName(p.name || "");
    setEfGroup(p.group_name || "");
    setEfGeo(p.geo_manager || "");
    setEfDosco(p.dosco_manager || "");
    setEfEval(p.evaluation || "");
    setEfStatus(p.status || "PLANNING");
    setEfStartDate(p.start_date ? p.start_date.slice(0, 10) : "");
    setEfEndDate(p.end_date ? p.end_date.slice(0, 10) : "");
    setEfInternalDeadline(p.internal_deadline ? p.internal_deadline.slice(0, 10) : "");
    setEfLeadId(p.lead_id || "");
  };

  const handleSaveEdit = async () => {
    if (!editingProject) return;
    try {
      setSavingEdit(true);
      const updated = await api.updateProject(editingProject.id, {
        code: efCode.trim() || undefined,
        name: efName.trim(),
        group_name: efGroup.trim() || null,
        geo_manager: efGeo.trim() || null,
        dosco_manager: efDosco.trim() || null,
        evaluation: efEval.trim() || null,
        status: efStatus as ProjectStatus,
        start_date: efStartDate || null,
        end_date: efEndDate || null,
        internal_deadline: efInternalDeadline || null,
        lead_id: efLeadId ? Number(efLeadId) : null,
      });
      setProjects((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
      setEditingProject(null);
    } catch (err) {
      alert("Lỗi khi lưu dự án: " + (err instanceof Error ? err.message : "Đã có lỗi xảy ra"));
    } finally {
      setSavingEdit(false);
    }
  };

  // Đóng modal thêm / sửa dự án khi nhấn ESC
  useEscapeKey(() => {
    if (editingProject) setEditingProject(null);
    else if (showAdd) setShowAdd(false);
  }, Boolean(editingProject || showAdd));

  const uniqueLeads = Array.from(
    new Set(projects.map((p) => p.lead_name).filter(Boolean) as string[])
  ).sort();

  const uniqueDepts = Array.from(
    new Set([
      ...PRESET_DEPARTMENTS,
      ...projects.map((p) => getProjectDept(p)).filter(Boolean)
    ])
  ).sort();

  const filteredProjects = projects.filter((p) => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!p.name.toLowerCase().includes(q) && !p.code.toLowerCase().includes(q)) return false;
    }
    if (filterLead) {
      if (p.lead_name !== filterLead) return false;
    }
    if (filterDept) {
      const projDept = getProjectDept(p);
      if (projDept !== filterDept) return false;
    }
    // Tháng nhận: so tiền tố "YYYY-MM" của Ngày nhận. Dự án chưa có ngày nhận -> loại.
    if (filterMonth) {
      if ((p.start_date || "").slice(0, 7) !== filterMonth) return false;
    }
    return true;
  });

  useEffect(() => {
    let alive = true;
    // Nạp danh sách dự án — dùng cho lần đầu và polling.
    function loadProjects() {
      api.projects().then((d) => alive && setProjects(d)).catch(() => {});
    }

    let timer: ReturnType<typeof setInterval> | undefined;
    api.me()
      .then((me) => {
        if (!alive) return;
        setMe(me);
        if (isManagerUp(me.role)) {
          setCanManage(true);
          // Danh sách nhân sự để chọn người chủ trì khi tạo dự án.
          api.users().then((d) => alive && setUsers(d)).catch(() => {});
          // Danh sách GEO担当/DOSCO担当 đã dùng để chọn nhanh.
          api.projectManagers().then((d) => alive && setMgrs(d)).catch(() => {});
        }
        loadProjects();
        // Cập nhật gần thời gian thực (~20s) — theo dõi trạng thái/tiến độ dự án.
        timer = setInterval(() => {
          if (document.visibilityState === "visible") loadProjects();
        }, 20_000);
      })
      .catch(() => {});
    return () => { alive = false; if (timer) clearInterval(timer); };
  }, []);

  // Áp bộ lọc: phòng ban = có thành viên thuộc phòng đó; chủ trì = lead_id; dự án = đúng id.
  const visibleProjects = projects.filter((p) => {
    if (filters.dept && !(p.members ?? []).some((m) => splitDepts(m.department).includes(filters.dept)))
      return false;
    if (filters.leadId !== "" && p.lead_id !== filters.leadId) return false;
    if (filters.projectId !== "" && p.id !== filters.projectId) return false;
    return true;
  });

  // Mỗi dòng 1 dự án; cột ngăn cách bằng phẩy / Tab / ; / | :
  // Mã QL, Tên dự án, Nhóm, GEO担当, DOSCO担当 (dán thẳng từ Excel).
  // Tự bỏ: dòng trống, dòng TIÊU ĐỀ (番号/管理番号/プロジェクト名…), và cột số thứ tự (番号) ở đầu.
  function parseBulk(text: string, startIndex: number) {
    const HEADER_HINTS = [
      "管理番号", "プロジェクト名", "GEO担当", "DOSCO担当", "グループ", "番号",
      "mã ql", "tên dự án",
    ];
    const isHeader = (line: string) => {
      const low = line.toLowerCase();
      return HEADER_HINTS.some((h) => low.includes(h.toLowerCase()));
    };
    const lines = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !isHeader(l));   // bỏ dòng trống + dòng tiêu đề
    return lines
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

    const code = nfCode.trim();
    const groupName = nfGroup.trim();

    // Kiểm tra trùng ĐỒNG THỜI cả 3 mục (Mã + Tên + Nhóm/Phòng ban)
    const isDuplicate = !!code && !!name && !!groupName && projects.some((p) => {
      const matchName = (p.name || "").trim().toLowerCase() === name.toLowerCase();
      const matchCode = (p.code || "").trim().toLowerCase() === code.toLowerCase();
      const pDept = normalizeDept(p.group_name).toLowerCase();
      const newDept = normalizeDept(groupName).toLowerCase();
      const matchGroup = pDept === newDept || (p.group_name || "").trim().toLowerCase() === groupName.toLowerCase();
      return matchName && matchCode && matchGroup;
    });

    if (isDuplicate) {
      setAddResult("⚠️ Dự án với cùng Mã, Tên và Nhóm/Phòng ban này đã tồn tại trong hệ thống. Vui lòng kiểm tra lại!");
      return;
    }

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
        evaluation: nfEval.trim() || null,
        start_date: nfStartDate || null,
        end_date: nfEndDate || null,
        internal_deadline: nfInternalDeadline || null,
      });
      if (nfTemplateId) {
        try {
          await api.copyProjectItemsTemplate(created.id, Number(nfTemplateId));
        } catch (err) {
          console.error("Failed to copy template items:", err);
        }
      }
      const fresh = await api.projects().catch(() => null);
      if (fresh) setProjects(fresh);
      // Reset để nhập dự án kế tiếp nhanh.
      setNfCode(""); setNfName(""); setNfGroup(""); setNfGeo(""); setNfDosco("");
      setNfEval(""); setNfStartDate(""); setNfEndDate(""); setNfInternalDeadline("");
      setAddResult(`✓ Đã tạo dự án "${created.name}".`);
    } catch (e) {
      setAddResult(e instanceof Error ? e.message : "Tạo dự án thất bại.");
    } finally {
      setCreating(false);
    }
  }

  const isBanDoUser = !!me?.department && (
    normalizeDept(me.department) === "Phòng Bản đồ" || 
    me.department.includes("Bản đồ") || 
    me.department.includes("測量解析")
  );
  const isBanDoMode = filterDept === "Phòng Bản đồ" || filterDept === "測量解析" || (filterDept === "" && isBanDoUser);

  const TH = `border border-line font-semibold whitespace-nowrap sticky top-0 bg-paper z-10 ${isBanDoMode ? "px-1 py-1 text-[10px]" : "px-1.5 py-1.5"}`;
  const TD = `border border-line align-middle ${isBanDoMode ? "px-1 py-1 text-[10.5px]" : "px-1.5 py-1.5"}`;
  // STT, Mã QL, Tên, Nhóm, GEO担当, DOSCO担当, Ghi chú, Ngày nhận, Ngày hoàn thành, Hạn nội, Tổng thời gian, Trạng thái, Tiến độ = 13 cột.
  const infoCols = 13;

  return (
    <AppShell maxWidthClass="max-w-md lg:max-w-none lg:px-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink lg:text-2xl">Dự án</h1>
          <p className="mt-0.5 text-xs text-muted lg:text-sm">
            Theo dõi vòng đời dự án từ đấu thầu tới quyết toán.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setArchiveModal(true)}
            title="Thùng rác & Khôi phục"
            className="shrink-0 inline-flex items-center gap-1.5 rounded-xl2 border border-amber-500/40 bg-amber-50 px-3.5 py-2.5 text-xs font-bold text-amber-700 hover:bg-amber-500 hover:text-white transition-colors cursor-pointer shadow-sm"
          >
            <ArchiveBoxIcon className="h-4 w-4 text-amber-600" /> Thùng rác
          </button>
          <button
            onClick={() => { setShowAdd(true); setAddResult(""); }}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-xl2 bg-ink px-3.5 py-2.5 text-xs font-semibold text-white shadow-card hover:bg-steel transition-colors"
          >
            <PlusIcon className="h-4 w-4" /> Thêm dự án
          </button>
        </div>
      </div>

      {/* Bộ lọc dự án */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[240px]">
          <input
            type="text"
            placeholder="Tìm theo tên hoặc mã quản lý..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl2 border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel placeholder:text-muted"
          />
        </div>

        {/* Bộ lọc phòng ban — CHỈ HIỆN DÀNH CHO GIÁM ĐỐC, QUẢN TRỊ & QUẢN LÝ CẤP CAO */}
        {isSeniorManagerUp(me) && (
          <div className="w-full sm:w-[200px]">
            <select
              value={filterDept}
              onChange={(e) => setFilterDept(e.target.value)}
              className="w-full rounded-xl2 border border-line bg-white px-3 py-2.5 text-xs outline-none focus:border-steel text-ink"
            >
              <option value="">— Tất cả phòng ban —</option>
              {uniqueDepts.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        )}



        {/* Lọc theo THÁNG NHẬN dự án */}
        <div className="flex w-full items-center gap-1.5 sm:w-auto">
          <input
            type="month"
            value={filterMonth}
            onChange={(e) => setFilterMonth(e.target.value)}
            title="Lọc theo tháng nhận dự án"
            aria-label="Lọc theo tháng nhận dự án"
            className="w-full rounded-xl2 border border-line bg-white px-3 py-2.5 text-xs text-ink outline-none focus:border-steel sm:w-[170px]"
          />
          {filterMonth && (
            <button
              type="button"
              onClick={() => setFilterMonth("")}
              title="Bỏ lọc tháng"
              className="shrink-0 rounded-lg p-1.5 text-muted hover:bg-paper hover:text-ink"
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between text-xs text-muted">
        <span>Tìm thấy: <b>{filteredProjects.length}</b> dự án</span>
        {(searchQuery || filterDept || filterLead || filterMonth) && (
          <button
            onClick={() => {
              setSearchQuery("");
              setFilterDept("");
              setFilterLead("");
              setFilterMonth("");
            }}
            className="text-steel hover:text-ink font-semibold"
          >
            Xóa bộ lọc
          </button>
        )}
      </div>

      <div className="mt-3 overflow-auto rounded-xl2 border border-line bg-white shadow-card max-h-[calc(100vh-280px)]">
        {/* Bề rộng cột CỐ ĐỊNH: Tên dự án rộng nhất (co 1/2 đối với Phòng Bản đồ), các cột ngày & 担当 thu gọn. */}
        <table className={`w-full table-fixed border-collapse text-[11px] ${isBanDoMode ? "min-w-[980px]" : "min-w-[1280px]"}`}>
          {isBanDoMode ? (
            <colgroup>
              <col className="w-[30px]" />   {/* STT */}
              <col className="w-[85px]" />   {/* Mã QL */}
              <col className="w-[160px]" />  {/* Tên dự án — co 1/2 so với 320px, có ... cuối */}
              <col className="w-[66px]" />   {/* Nhóm */}
              <col className="w-[56px]" />   {/* GEO担当 */}
              <col className="w-[68px]" />   {/* DOSCO担当 */}
              <col className="w-[100px]" />  {/* Nội dung */}
              <col className="w-[52px]" />   {/* Time in */}
              <col className="w-[52px]" />   {/* Time out */}
              <col className="w-[52px]" />   {/* Time due */}
              <col className="w-[72px]" />   {/* Total time */}
              <col className="w-[74px]" />   {/* Trạng thái */}
              <col className="w-[64px]" />   {/* Real time */}
              <col className="w-[98px]" />   {/* Thao tác */}
            </colgroup>
          ) : (
            <colgroup>
              <col className="w-[34px]" />   {/* STT */}
              <col className="w-[96px]" />   {/* Mã QL — fit mã 9 ký tự */}
              <col className="w-[320px]" />  {/* Tên dự án — rộng nhất */}
              <col className="w-[76px]" />   {/* Nhóm — fit tên tiếng Nhật */}
              <col className="w-[62px]" />   {/* GEO担当 */}
              <col className="w-[78px]" />   {/* DOSCO担当 */}
              <col className="w-[150px]" />  {/* Ghi chú */}
              <col className="w-[64px]" />   {/* Time in */}
              <col className="w-[64px]" />   {/* Time out */}
              <col className="w-[64px]" />   {/* Time due */}
              <col className="w-[88px]" />   {/* Total time */}
              <col className="w-[82px]" />   {/* Trạng thái */}
              <col className="w-[74px]" />   {/* Tiến độ */}
              <col className="w-[112px]" />  {/* Thao tác */}
            </colgroup>
          )}
          <thead>
            <tr className="bg-paper text-left text-[11px] uppercase tracking-wide text-muted">
              <th className={`${TH} w-10 text-center`}>STT</th>
              <th className={TH}>Mã QL</th>
              <th className={TH}>Tên dự án</th>
              <th className={TH}>Nhóm</th>
              <th className={TH}>GEO担当</th>
              <th className={TH}>DOSCO担当</th>
              <th className={TH}>Nội dung</th>
              <th className={TH} title="Ngày nhận">Time in</th>
              <th className={TH} title="Ngày hoàn thành">Time out</th>
              <th className={TH} title="Hạn nội bộ">Time due</th>
              <th className={TH} title="Tổng thời gian">Total time</th>
              <th className={TH}>Trạng thái</th>
              <th className={TH} title="Thời gian làm thực tế realtime (tính từ chấm công tiến độ)">Real time</th>
              <th className={`${TH} text-center`}>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {filteredProjects.length === 0 && (
              <tr>
                <td className={`${TD} text-center text-muted`} colSpan={infoCols}>
                  Không tìm thấy dự án nào khớp với bộ lọc.
                </td>
              </tr>
            )}

            {filteredProjects.map((p, i) => {
              const effectiveStatus = computeAutoStatus(p);
              const st = PROJECT_STATUS[effectiveStatus] ?? PROJECT_STATUS.PLANNING;
              return (
                <tr
                  key={p.id}
                  onClick={() => router.push(`/projects/${p.id}`)}
                  className="cursor-pointer transition-colors odd:bg-white even:bg-paper/40 hover:bg-amber/10"
                >
                  <td className={`${TD} text-center text-muted tnum`}>{i + 1}</td>
                  <td className={`${TD} font-mono text-[13px] font-bold text-bad whitespace-nowrap`}>{p.code}</td>
                  <td className={`${TD} font-semibold text-ink`}>
                    <div className="truncate" title={p.name}>{p.name}</div>
                  </td>
                  <td className={`${TD} text-muted`}>
                    <div className="truncate" title={groupLabel(p.group_name)}>
                      {DEPT_JA[normalizeDept(p.group_name)] || normalizeDept(p.group_name) || "—"}
                    </div>
                  </td>
                  <td className={`${TD} text-muted`}>
                    <div className="truncate" title={p.geo_manager || ""}>{p.geo_manager || "—"}</div>
                  </td>
                  <td className={`${TD} text-muted`}>
                    <div className="truncate" title={p.dosco_manager || ""}>{p.dosco_manager || "—"}</div>
                  </td>
                  {/* ĐÁNH GIÁ — gõ THẲNG vào ô này, rời ô là tự lưu (không mở trang khác). */}
                  <td className={`${TD} align-top`} onClick={(e) => e.stopPropagation()}>
                    {canEditEval(p) ? (
                      <textarea
                        rows={1}
                        value={evalEdits[p.id] ?? p.evaluation ?? ""}
                        onChange={(e) => setEvalEdits((s) => ({ ...s, [p.id]: e.target.value }))}
                        onBlur={() => saveEvaluation(p)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            (e.target as HTMLTextAreaElement).blur();
                          }
                          if (e.key === "Escape") {
                            setEvalEdits((s) => {
                              const n = { ...s };
                              delete n[p.id];
                              return n;
                            });
                          }
                        }}
                        placeholder="Nội dung…"
                        title="Gõ trực tiếp — rời ô (hoặc Enter) là tự lưu; Esc để huỷ"
                        className="min-h-[26px] w-full resize-y rounded border border-transparent bg-transparent px-1.5 py-1 text-[11px] text-ink outline-none transition-colors placeholder:text-line hover:border-line focus:border-steel focus:bg-white"
                      />
                    ) : (
                      <span className="text-muted">{p.evaluation || "—"}</span>
                    )}
                  </td>
                  <td className={`${TD} text-muted whitespace-nowrap tnum`} title={p.start_date || ""}>{dm(p.start_date)}</td>
                  <td className={`${TD} text-muted whitespace-nowrap tnum`} title={p.end_date || ""}>{dm(p.end_date)}</td>
                  <td className={`${TD} text-muted whitespace-nowrap tnum`} title={p.internal_deadline || ""}>{dm(p.internal_deadline)}</td>
                  <td className={`${TD} text-muted whitespace-nowrap tnum`}>{calculateDuration(p.start_date, p.end_date, p.internal_deadline)}</td>
                  <td className={TD}>
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${st.cls}`}>
                      {st.label}
                    </span>
                  </td>
                  <td className={`${TD} text-center whitespace-nowrap`}>
                    <div className="flex flex-col items-center justify-center">
                      <span className="font-bold text-ink tnum text-xs">
                        {p.total_days && p.total_days > 0 ? `${p.total_days} ngày` : "0 ngày"}
                      </span>
                      {p.total_hours && p.total_hours > 0 ? (
                        <span className="text-[10px] text-muted tnum font-mono">({p.total_hours}h)</span>
                      ) : null}
                    </div>
                  </td>
                  <td className={`${TD} text-center whitespace-nowrap`} onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-center gap-1">
                      {canEditProject(p) ? (
                        <button
                          onClick={() => openEditModal(p)}
                          title="Sửa thông tin dự án"
                          className="inline-flex items-center gap-0.5 rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 transition-colors hover:bg-slate-200 hover:text-ink"
                        >
                          <PencilSquareIcon className="h-3 w-3 shrink-0 text-steel" />
                          Sửa
                        </button>
                      ) : (
                        <span className="text-[11px] text-muted">—</span>
                      )}
                      {canDelete && (
                        <button
                          onClick={() => handleQuickDelete(p)}
                          title="Xoá dự án"
                          className="inline-flex items-center gap-0.5 rounded border border-bad/30 bg-bad/10 px-1.5 py-0.5 text-[10px] font-semibold text-bad transition-colors hover:bg-bad hover:text-white"
                        >
                          <TrashIcon className="h-3 w-3 shrink-0" />
                          Xoá
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
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
                      <select value={nfGroup} onChange={(e) => setNfGroup(e.target.value)}
                        className="w-full rounded-xl2 border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel">
                        <option value="">— Chọn nhóm —</option>
                        {PROJECT_GROUPS.map((g) => (
                          <option key={g.ja} value={g.ja}>{g.ja} ({g.vi})</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-semibold text-muted">GEO担当 — phía Nhật</span>
                      <PersonPicker value={nfGeo} onChange={setNfGeo} options={geoOptsFor(nfGroup, nfGeo)} placeholder="— Chọn người phía Nhật —" />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-semibold text-muted">DOSCO担当 — phía Việt</span>
                      <PersonPicker
                        value={nfDosco}
                        onChange={setNfDosco}
                        options={doscoOptsFor(nfGroup, nfDosco)}
                        placeholder="— Chọn người phía Việt —"
                      />
                    </label>
                  </div>
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-semibold text-muted">Ghi chú</span>
                    <input value={nfEval} onChange={(e) => setNfEval(e.target.value)} placeholder="Nhập ghi chú dự án…"
                      className="w-full rounded-xl2 border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel" />
                  </label>
                  <div className="grid grid-cols-3 gap-3">
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-semibold text-muted">Ngày nhận</span>
                      <input type="date" value={nfStartDate} onChange={(e) => setNfStartDate(e.target.value)}
                        className="w-full rounded-xl2 border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel" />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-semibold text-muted">Ngày hoàn thành</span>
                      <input type="date" value={nfEndDate} onChange={(e) => setNfEndDate(e.target.value)}
                        className="w-full rounded-xl2 border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel" />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-semibold text-muted">Hạn nội bộ</span>
                      <input type="date" value={nfInternalDeadline} onChange={(e) => setNfInternalDeadline(e.target.value)}
                        className="w-full rounded-xl2 border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel" />
                    </label>
                  </div>
                  {nfStartDate && (nfEndDate || nfInternalDeadline) && (
                    <p className="text-xs text-muted">
                      Tổng thời gian: <b className="text-ink font-semibold">{calculateDuration(nfStartDate, nfEndDate, nfInternalDeadline)}</b>
                    </p>
                  )}

                  {canManage && (
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-semibold text-muted font-bold text-steel">Sao chép hạng mục từ dự án mẫu</span>
                      <select value={nfTemplateId} onChange={(e) => setNfTemplateId(e.target.value)}
                        className="w-full rounded-xl2 border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel">
                        <option value="">— Không sao chép hạng mục —</option>
                        {projects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.code ? `[${p.code}] ` : ""}{p.name}
                          </option>
                        ))}
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
      {editingProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-xl2 bg-white p-5 shadow-2xl animate-fade-in border border-line max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h3 className="text-sm font-bold text-ink flex items-center gap-1.5">
                <PencilSquareIcon className="h-5 w-5 text-steel" />
                Sửa thông tin dự án [{editingProject.code || editingProject.id}]
              </h3>
              <button onClick={() => setEditingProject(null)} className="rounded-full p-1 text-muted hover:bg-paper">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-3 space-y-3">
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-muted">Tên dự án <span className="text-bad">*</span></label>
                <input value={efName} onChange={(e) => setEfName(e.target.value)} className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-muted">Mã quản lý</label>
                  <input value={efCode} onChange={(e) => setEfCode(e.target.value)} className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel" />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-muted">Nhóm (グループ)</label>
                  <select value={efGroup} onChange={(e) => setEfGroup(e.target.value)} className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel">
                    <option value="">— Chọn nhóm —</option>
                    {PROJECT_GROUPS.map((g) => (
                      <option key={g.ja} value={g.ja}>{g.ja} ({g.vi})</option>
                    ))}
                    {/* Giữ giá trị CŨ không thuộc 3 nhóm chuẩn để không bị xóa mất khi lưu. */}
                    {efGroup && !PROJECT_GROUPS.some((g) => g.ja === efGroup) && (
                      <option value={efGroup}>{efGroup} (nhóm cũ)</option>
                    )}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-muted">GEO担当</label>
                  <PersonPicker value={efGeo} onChange={setEfGeo} options={geoOptsFor(efGroup, efGeo)} placeholder="— Chọn người phía Nhật —" />
                  <datalist id="geo-list-edit" className="hidden">
                    {mgrs.geo.map((m) => <option key={m} value={m} />)}
                  </datalist>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-muted">DOSCO担当</label>
                  <PersonPicker
                    value={efDosco}
                    onChange={setEfDosco}
                    options={doscoOptsFor(efGroup, efDosco)}
                    placeholder="— Chọn người phía Việt —"
                  />
                  <datalist id="dosco-list-edit" className="hidden">
                    {mgrs.dosco.map((m) => <option key={m} value={m} />)}
                  </datalist>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-muted">Trạng thái</label>
                <select value={efStatus} onChange={(e) => setEfStatus(e.target.value)} className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel">
                  <option value="PLANNING">Chuẩn bị</option>
                  <option value="IN_PROGRESS">Đang làm</option>
                  <option value="COMPLETED">Hoàn thành</option>
                </select>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-muted">Ngày nhận</label>
                  <input type="date" value={efStartDate} onChange={(e) => setEfStartDate(e.target.value)} className="w-full rounded-lg border border-line bg-paper px-2 py-2 text-xs outline-none focus:border-steel" />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-muted">Ngày hoàn thành</label>
                  <input type="date" value={efEndDate} onChange={(e) => setEfEndDate(e.target.value)} className="w-full rounded-lg border border-line bg-paper px-2 py-2 text-xs outline-none focus:border-steel" />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-muted">Hạn nội bộ</label>
                  <input type="date" value={efInternalDeadline} onChange={(e) => setEfInternalDeadline(e.target.value)} className="w-full rounded-lg border border-line bg-paper px-2 py-2 text-xs outline-none focus:border-steel" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-muted">Ghi chú</label>
                <input value={efEval} onChange={(e) => setEfEval(e.target.value)} placeholder="VD: Tốt, Xuất sắc..." className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel" />
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2 text-xs font-semibold">
              <button onClick={() => setEditingProject(null)} className="rounded-xl2 border border-line px-4 py-2 text-muted hover:bg-paper">
                Hủy bỏ
              </button>
              <button onClick={handleSaveEdit} disabled={savingEdit || !efName.trim()} className="rounded-xl2 bg-ink px-4 py-2 text-white hover:bg-steel disabled:opacity-50">
                {savingEdit ? "Đang lưu..." : "Lưu thay đổi"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ArchiveModal
        isOpen={archiveModal}
        onClose={() => setArchiveModal(false)}
        onRestored={() => api.projects().then(setProjects)}
      />
    </AppShell>
  );
}
