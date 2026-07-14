"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  MapPinIcon,
  UserIcon,
  UserGroupIcon,
  CalendarDaysIcon,
  PlusIcon,
  CheckBadgeIcon,
  ArrowLeftIcon,
  ClockIcon,
  DocumentTextIcon,
  XMarkIcon,
  UsersIcon,
  TableCellsIcon,
  ChatBubbleLeftRightIcon,
  StarIcon,
  TrashIcon,
  PencilSquareIcon,
} from "@heroicons/react/24/outline";
import AppShell from "@/components/app-shell";
import ProjectItemsTab from "@/components/project-items-tab";
import ProjectScheduleGrid from "@/components/project-schedule-grid";
import ProjectTeamTab from "@/components/project-team-tab";
import ProjectEvaluationTab from "@/components/project-evaluation-tab";
import { api } from "@/lib/api";
import { canSeeMoney, roleTitle, isDirector } from "@/lib/roles";
import { formatVND, formatDate } from "@/lib/format";
import type { Project, Contract, Progress, User } from "@/lib/types";

const PROJECT_STATUS: Record<string, { label: string; cls: string }> = {
  PLANNING: { label: "Chuẩn bị", cls: "bg-line text-muted" },
  IN_PROGRESS: { label: "Đang làm", cls: "bg-steel/10 text-steel" },
  ON_HOLD: { label: "Tạm dừng", cls: "bg-amber/20 text-amber-deep" },
  COMPLETED: { label: "Hoàn thành", cls: "bg-ok/15 text-ok" },
  CLOSED: { label: "Đã đóng", cls: "bg-bad/15 text-bad" },
};

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = Number(params.id);

  const [project, setProject] = useState<Project | null>(null);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [progressLogs, setProgressLogs] = useState<Progress[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"contracts" | "items" | "progress" | "team" | "eval">("contracts");

  // Current user & company users
  const [currentUser, setCurrentUser] = useState<User | null>(api.cachedUser());
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [mgrs, setMgrs] = useState<{ geo: string[]; dosco: string[] }>({ geo: [], dosco: [] });

  // Nhân viên (STAFF) không được xem TIỀN của dự án. Backend là nguồn chân lý
  // (chặn GET hợp đồng/thanh toán/hóa đơn với STAFF, mask khối lượng/đơn giá hạng mục);
  // FE gate để ẩn UI cho khớp và tránh gọi API bị 403.
  const showMoney = canSeeMoney(currentUser?.role);

  // Modals & Member management states
  const [contractModal, setContractModal] = useState(false);
  const [progressModal, setProgressModal] = useState(false);
  const [membersModal, setMembersModal] = useState(false);
  const [selectedMemberIds, setSelectedMemberIds] = useState<number[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);
  const [geoInput, setGeoInput] = useState("");       // GEO担当 (text)
  const [doscoInput, setDoscoInput] = useState("");   // DOSCO担当 (text)
  const [groupNameInput, setGroupNameInput] = useState<string>("");              // グループ
  const [codeInput, setCodeInput] = useState("");     // 管理番号 (mã QL)
  const [nameInput, setNameInput] = useState("");     // プロジェクト名 (tên dự án)
  const [startInput, setStartInput] = useState("");   // ngày bắt đầu YYYY-MM-DD
  const [endInput, setEndInput] = useState("");       // ngày kết thúc YYYY-MM-DD
  const [savingMembers, setSavingMembers] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sửa mốc tiến độ (null = đang tạo mới, khác null = đang sửa mốc này).
  const [editingProgressId, setEditingProgressId] = useState<number | null>(null);

  // New item form states
  const [newContract, setNewContract] = useState({
    code: "",
    name: "",
    partner: "",
    value_no_vat: 0,
    vat_percent: 10,
    sign_date: "",
    status: "ACTIVE",
  });

  const [newProgress, setNewProgress] = useState({
    title: "",
    percent_complete: 0,
    planned_date: "",
    actual_date: "",
    note: "",
  });

  function loadData(silent = false) {
    if (isNaN(projectId)) return;
    // Chưa biết vai trò (chưa nạp xong /me) thì chờ — tránh gọi nhầm endpoint tiền
    // với STAFF (bị 403) rồi lại phải nạp lại.
    if (currentUser == null) return;
    // Poll (silent) KHÔNG bật spinner để tránh nháy màn hình.
    if (!silent) setLoading(true);

    // Nhân viên: chỉ nạp thông tin dự án + tiến độ (không có tiền).
    if (!showMoney) {
      Promise.all([api.getProject(projectId), api.progress(projectId)])
        .then(([proj, prog]) => {
          setProject(proj);
          setProgressLogs(prog);
          setContracts([]);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
      return;
    }

    Promise.all([
      api.getProject(projectId),
      api.contracts(projectId),
      api.progress(projectId),
    ])
      .then(([proj, contrs, prog]) => {
        setProject(proj);
        setContracts(contrs);
        setProgressLogs(prog);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  // Quyền quản trị dự án (thêm/bớt thành viên, đặt chủ trì, sửa/xóa mốc):
  // Giám đốc/Admin HOẶC chính người chủ trì.
  // Backend là nguồn chân lý (chỉ Director/Admin hoặc lead) — FE gate để ẩn nút cho khớp.
  const canManage =
    !!currentUser &&
    (currentUser.role === "DIRECTOR" ||
      currentUser.role === "ADMIN" ||
      project?.lead_id === currentUser.id);

  // Load current user once.
  useEffect(() => {
    api.me()
      .then((me) => {
        setCurrentUser(me);
        // Nhân viên không có tab tiền -> mặc định vào "Hạng mục" (không phải "Hợp đồng").
        if (!canSeeMoney(me.role)) setActiveTab("items");
        // Trang khác mở thẳng 1 tab qua ?tab=... (VD: bảng Tiến độ dự án -> tab Tiến độ).
        // Tab tiền chỉ nhận khi có quyền xem tiền.
        const want = new URLSearchParams(window.location.search).get("tab");
        const allowed: string[] = ["items", "progress", "team", "eval"];
        if (canSeeMoney(me.role)) allowed.push("contracts");
        if (want && allowed.includes(want)) {
          setActiveTab(want as "contracts" | "items" | "progress" | "team" | "eval");
        }
      })
      .catch(() => {});
  }, []);

  // Nạp danh sách nhân sự để chọn thành viên/chủ trì — chỉ khi user có quyền quản trị
  // dự án này (Director/Admin hoặc chính người chủ trì, kể cả người chủ trì là cấp trung).
  useEffect(() => {
    if (canManage && allUsers.length === 0) {
      api.users().then(setAllUsers).catch(() => {});
      api.projectManagers().then(setMgrs).catch(() => {});
    }
  }, [canManage, allUsers.length]);

  useEffect(loadData, [projectId, currentUser, showMoney]);

  // Poll ~20s để cập nhật tiến độ / hợp đồng / thanh toán gần thời gian thực.
  // Tạm dừng khi có modal đang mở (tránh ghi đè state khi người dùng đang thao tác).
  useEffect(() => {
    if (currentUser == null || isNaN(projectId)) return;
    const anyModalOpen = contractModal || progressModal || membersModal;
    if (anyModalOpen) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") loadData(true);
    }, 20_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, currentUser, showMoney, contractModal, progressModal, membersModal]);

  // Sync selectedMemberIds / lead when project changes
  useEffect(() => {
    if (project) {
      setSelectedMemberIds(project.members?.map((m) => m.id) ?? []);
      setSelectedLeadId(project.lead_id ?? null);
      setGeoInput(project.geo_manager ?? "");
      setDoscoInput(project.dosco_manager ?? "");
      setGroupNameInput(project.group_name ?? "");
      setCodeInput(project.code ?? "");
      setNameInput(project.name ?? "");
      setStartInput(project.start_date ?? "");
      setEndInput(project.end_date ?? "");
    }
  }, [project]);

  function handleToggleMember(userId: number) {
    setSelectedMemberIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  }

  async function handleSaveMembers() {
    if (!project) return;
    // Tên dự án bắt buộc; ngày kết thúc không được trước ngày bắt đầu.
    if (!nameInput.trim()) { setError("Tên dự án không được để trống."); return; }
    if (startInput && endInput && endInput < startInput) {
      setError("Ngày kết thúc phải sau ngày bắt đầu.");
      return;
    }
    setSavingMembers(true);
    setError(null);
    try {
      // Người chủ trì phải nằm trong danh sách thành viên (nếu có) để nhất quán.
      const memberIds =
        selectedLeadId != null && !selectedMemberIds.includes(selectedLeadId)
          ? [...selectedMemberIds, selectedLeadId]
          : selectedMemberIds;
      await api.updateProject(project.id, {
        member_ids: memberIds,
        lead_id: selectedLeadId,
        name: nameInput.trim(),
        code: codeInput.trim() || project.code,   // không để trống mã (NOT NULL)
        start_date: startInput || null,
        end_date: endInput || null,
        geo_manager: geoInput.trim() || null,
        dosco_manager: doscoInput.trim() || null,
        group_name: groupNameInput.trim() || null,
      });
      setMembersModal(false);
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cập nhật dự án thất bại.");
    } finally {
      setSavingMembers(false);
    }
  }

  // Mở nhóm chat của dự án (ChatWidget lắng nghe sự kiện này để get-or-create nhóm).
  function openProjectChat() {
    window.dispatchEvent(new CustomEvent("open-project-chat", { detail: { projectId } }));
  }

  async function handleStatusChange(status: string) {
    if (!project) return;
    setProject({ ...project, status: status as Project["status"] });   // cập nhật ngay cho mượt
    try {
      await api.updateProject(project.id, { status: status as Project["status"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đổi trạng thái thất bại.");
      loadData();
    }
  }

  async function handleDeleteProject() {
    if (!project) return;
    if (!window.confirm(
      `Xoá dự án "${project.name}" và TOÀN BỘ dữ liệu của nó (hợp đồng, hóa đơn, thanh toán, hạng mục, tiến độ, chat dự án)?\n\nKhông thể hoàn tác.`
    )) return;
    try {
      await api.deleteProject(projectId);
      router.push("/projects");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Xoá dự án thất bại.");
    }
  }

  async function handleDeleteProgress(id: number) {
    if (!window.confirm("Xóa mốc tiến độ này?")) return;
    try {
      await api.deleteProgress(id);
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Xóa mốc tiến độ thất bại.");
    }
  }

  function openEditProgress(p: Progress) {
    setEditingProgressId(p.id);
    setNewProgress({
      title: p.title,
      percent_complete: Number(p.percent_complete),
      planned_date: p.planned_date ?? "",
      actual_date: p.actual_date ?? "",
      note: p.note ?? "",
    });
    setError(null);
    setProgressModal(true);
  }

  function openCreateProgress() {
    setEditingProgressId(null);
    setNewProgress({ title: "", percent_complete: 0, planned_date: "", actual_date: "", note: "" });
    setError(null);
    setProgressModal(true);
  }

  async function handleAddContract(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!newContract.code || !newContract.name) {
      setError("Vui lòng điền đầy đủ Mã và Tên hợp đồng.");
      return;
    }
    try {
      await api.createContract({
        ...newContract,
        project_id: projectId,
        value_no_vat: Number(newContract.value_no_vat),
        vat_percent: Number(newContract.vat_percent),
        sign_date: newContract.sign_date || null,
        status: newContract.status as any,
      });
      setContractModal(false);
      setNewContract({
        code: "",
        name: "",
        partner: "",
        value_no_vat: 0,
        vat_percent: 10,
        sign_date: "",
        status: "ACTIVE",
      });
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Thêm hợp đồng thất bại.");
    }
  }

  async function handleAddProgress(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!newProgress.title) {
      setError("Vui lòng điền Tên hạng mục/mốc.");
      return;
    }
    try {
      const payload = {
        percent_complete: Number(newProgress.percent_complete),
        title: newProgress.title,
        note: newProgress.note,
        planned_date: newProgress.planned_date || null,
        actual_date: newProgress.actual_date || null,
      };
      if (editingProgressId != null) {
        await api.updateProgress(editingProgressId, payload);
      } else {
        await api.createProgress({ ...payload, project_id: projectId });
      }
      setProgressModal(false);
      setEditingProgressId(null);
      setNewProgress({
        title: "",
        percent_complete: 0,
        planned_date: "",
        actual_date: "",
        note: "",
      });
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lưu tiến độ thất bại.");
    }
  }

  if (loading) {
    return (
      <AppShell>
        <p className="py-20 text-center text-xs text-muted">Đang tải chi tiết dự án...</p>
      </AppShell>
    );
  }

  if (!project) {
    return (
      <AppShell>
        <div className="text-center py-20">
          <p className="text-sm text-bad font-semibold">Không tìm thấy dự án.</p>
          <button onClick={() => router.push("/projects")} className="mt-4 text-xs text-steel font-medium underline">
            Quay lại danh sách
          </button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      {/* Nút quay lại */}
      <button
        onClick={() => router.push("/projects")}
        className="flex items-center gap-1 text-xs text-muted hover:text-ink mb-4 font-semibold"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Quay lại dự án
      </button>

      {/* Thông tin chung dự án */}
      <div className="rounded-xl2 bg-white p-4 lg:p-6 shadow-card border border-line/50">
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="font-mono text-[10px] text-muted">{project.code}</span>
            <h1 className="text-base lg:text-xl font-bold text-ink leading-tight">{project.name}</h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={openProjectChat}
              className="inline-flex items-center gap-1 rounded-xl2 bg-steel px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-card hover:bg-ink transition-colors"
            >
              <ChatBubbleLeftRightIcon className="h-4 w-4" />
              Chat dự án
            </button>
            {isDirector(currentUser?.role) && (
              <button
                onClick={handleDeleteProject}
                title="Xoá dự án"
                className="inline-flex items-center gap-1 rounded-xl2 border border-bad/40 bg-bad/10 px-2.5 py-1.5 text-[11px] font-semibold text-bad hover:bg-bad hover:text-white transition-colors"
              >
                <TrashIcon className="h-4 w-4" />
                Xoá dự án
              </button>
            )}
            {canManage ? (
              <select
                value={project.status}
                onChange={(e) => handleStatusChange(e.target.value)}
                title="Đổi trạng thái dự án"
                className={`cursor-pointer rounded-full border-0 px-2.5 py-1 text-[11px] font-bold outline-none focus:ring-2 focus:ring-amber ${PROJECT_STATUS[project.status]?.cls}`}
              >
                <option value="PLANNING">Chuẩn bị</option>
                <option value="IN_PROGRESS">Đang làm</option>
                <option value="COMPLETED">Hoàn thành</option>
              </select>
            ) : (
              <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${PROJECT_STATUS[project.status]?.cls}`}>
                {PROJECT_STATUS[project.status]?.label}
              </span>
            )}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 lg:grid-cols-3 gap-y-2 gap-x-4 text-xs text-muted">
          {project.location && (
            <p className="flex items-center gap-1.5">
              <MapPinIcon className="h-4 w-4 text-muted/80" />
              {project.location}
            </p>
          )}
          {project.manager_name && (
            <p className="flex items-center gap-1.5">
              <UserIcon className="h-4 w-4 text-muted/80" />
              {project.manager_name}
            </p>
          )}
          {project.lead_name && (
            <p className="flex items-center gap-1.5">
              <StarIcon className="h-4 w-4 text-amber" />
              Chủ trì: <span className="font-medium text-ink">{project.lead_name}</span>
            </p>
          )}
          {project.group_name && (
            <p className="flex items-center gap-1.5">
              <UserGroupIcon className="h-4 w-4 text-muted/80" />
              Nhóm: <span className="font-medium text-ink">{project.group_name}</span>
            </p>
          )}
          {project.geo_manager && (
            <p className="flex items-center gap-1.5">
              <UserIcon className="h-4 w-4 text-muted/80" />
              GEO担当: <span className="font-medium text-ink">{project.geo_manager}</span>
            </p>
          )}
          {project.start_date && (
            <p className="flex items-center gap-1.5 col-span-2">
              <CalendarDaysIcon className="h-4 w-4 text-muted/80" />
              Ngày khởi công: <span className="font-medium text-ink">{formatDate(project.start_date)}</span>
              {project.end_date && ` — Hoàn thành: ${formatDate(project.end_date)}`}
            </p>
          )}
        </div>

        {/* Thành viên thực hiện dự án */}
        <div className="mt-4 border-t border-line/60 pt-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-ink uppercase tracking-wider flex items-center gap-1.5 text-steel">
              <UsersIcon className="h-4 w-4" />
              Thành viên thực hiện ({project.members?.length ?? 0})
            </h3>
            {canManage && (
              <button
                onClick={() => setMembersModal(true)}
                className="text-[11px] font-semibold text-steel hover:text-ink underline flex items-center gap-0.5"
              >
                <PencilSquareIcon className="h-3 w-3" />
                Sửa dự án
              </button>
            )}
          </div>
          
          <div className="mt-2 flex flex-wrap gap-1.5">
            {!project.members || project.members.length === 0 ? (
              <p className="text-[11px] text-muted italic">Chưa phân công thành viên thực hiện.</p>
            ) : (
              project.members.map((member) => {
                const isLead = project.lead_id === member.id;
                return (
                  <span
                    key={member.id}
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold text-ink ${isLead ? "bg-amber/15 border-amber/50" : "bg-paper border-line/50"}`}
                    title={`${roleTitle(member.role, member.has_subordinates)} - ${member.phone || "Không có SĐT"}`}
                  >
                    {isLead ? (
                      <StarIcon className="h-3 w-3 text-amber" />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-amber" />
                    )}
                    {member.full_name}
                    {isLead && <span className="text-[9px] font-bold text-amber-deep">(Chủ trì)</span>}
                    <span className="text-[9px] text-muted">({roleTitle(member.role, member.has_subordinates)})</span>
                  </span>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Tabs điều hướng — nhân viên chỉ thấy Hạng mục + Tiến độ (không có tab tiền) */}
      <div className="mt-6 flex border-b border-line">
        {showMoney && (
          <TabButton active={activeTab === "contracts"} onClick={() => setActiveTab("contracts")} label="Hợp đồng" icon={DocumentTextIcon} count={contracts.length} />
        )}
        <TabButton active={activeTab === "items"} onClick={() => setActiveTab("items")} label="Hạng mục" icon={TableCellsIcon} />
        <TabButton active={activeTab === "progress"} onClick={() => setActiveTab("progress")} label="Tiến độ" icon={ClockIcon} count={progressLogs.length} />
        <TabButton active={activeTab === "team"} onClick={() => setActiveTab("team")} label="Phân công" icon={UsersIcon} count={project.members?.length ?? 0} />
        <TabButton active={activeTab === "eval"} onClick={() => setActiveTab("eval")} label="Đánh giá" icon={StarIcon} />
      </div>

      {/* Nội dung Tab */}
      <div className="mt-4">
        {/* Tab Hợp đồng */}
        {showMoney && activeTab === "contracts" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-muted uppercase">Danh sách hợp đồng ({contracts.length})</h3>
              <button
                onClick={() => setContractModal(true)}
                className="flex items-center gap-1 text-xs font-semibold text-amber hover:text-amber-deep"
              >
                <PlusIcon className="h-4 w-4" />
                Thêm hợp đồng
              </button>
            </div>

            {contracts.length === 0 ? (
              <p className="rounded-xl2 bg-white p-6 text-center text-xs text-muted shadow-card">
                Chưa có hợp đồng nào được ký kết cho dự án này.
              </p>
            ) : (
              <div className="space-y-3 lg:space-y-0 lg:grid lg:grid-cols-2 lg:gap-3">
              {contracts.map((c) => (
                <div key={c.id} className="rounded-xl2 bg-white p-3.5 lg:p-4 shadow-card border border-line/40">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="font-mono text-[9px] text-muted">{c.code}</span>
                      <h4 className="text-sm font-semibold text-ink leading-snug">{c.name}</h4>
                      {c.partner && <p className="text-xs text-muted">Bên ký: {c.partner}</p>}
                    </div>
                    <span className="rounded-full bg-steel/10 px-2 py-0.5 text-[9px] font-bold text-steel">
                      {c.status === "ACTIVE" ? "Hiệu lực" : c.status}
                    </span>
                  </div>
                  <div className="mt-2.5 pt-2.5 border-t border-line flex justify-between text-xs">
                    <div>
                      <p className="text-muted">Giá trị (chưa VAT)</p>
                      <p className="font-bold text-ink tnum">{formatVND(c.value_no_vat)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-muted">Ngày ký</p>
                      <p className="font-medium text-ink">{c.sign_date ? formatDate(c.sign_date) : "—"}</p>
                    </div>
                  </div>
                </div>
              ))}
              </div>
            )}
          </div>
        )}

        {/* Tab Hạng mục (bảng dự toán Excel) */}
        {/* Bảng dự toán: ẩn Khối lượng + Đơn giá + Thành tiền + tiểu tổng + tổng cho MỌI
            vai trò (theo yêu cầu bỏ phần dự toán) — chỉ giữ tên hạng mục, ĐVT, % hoàn thành. */}
        {activeTab === "items" && <ProjectItemsTab projectId={projectId} canSeeMoney={false} />}

        {/* Tab Phân công — ai làm gì, bao lâu (từ giao việc lọc theo dự án) */}
        {activeTab === "team" && (
          <ProjectTeamTab
            projectId={projectId}
            members={project.members ?? []}
            leadId={project.lead_id ?? null}
            canManage={canManage}
          />
        )}

        {/* Tab Đánh giá — chấm chéo 360° giữa các thành viên dự án */}
        {activeTab === "eval" && (
          <ProjectEvaluationTab
            projectId={projectId}
            currentUserId={currentUser?.id ?? null}
          />
        )}

        {/* Tab Tiến độ */}
        {activeTab === "progress" && (
          <div className="space-y-4">
            {/* Bảng Excel từng ngày: ai làm gì, bao lâu, còn mấy ngày đến hạn dự án */}
            <ProjectScheduleGrid
              projectId={projectId}
              startDate={project.start_date ?? null}
              endDate={project.end_date ?? null}
              members={project.members ?? []}
              leadId={project.lead_id ?? null}
            />

            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-muted uppercase">Nhật ký tiến độ ({progressLogs.length})</h3>
              <button
                onClick={openCreateProgress}
                className="flex items-center gap-1 text-xs font-semibold text-amber hover:text-amber-deep"
              >
                <PlusIcon className="h-4 w-4" />
                Cập nhật tiến độ
              </button>
            </div>

            {progressLogs.length === 0 ? (
              <p className="rounded-xl2 bg-white p-6 text-center text-xs text-muted shadow-card">
                Chưa ghi nhận nhật ký tiến độ nào.
              </p>
            ) : (
              <div className="relative pl-4 border-l-2 border-line space-y-5 ml-2 pt-2">
                {progressLogs.map((p) => {
                  const completed = Number(p.percent_complete) === 100;
                  return (
                    <div key={p.id} className="relative">
                      {/* Tròn đánh dấu mốc */}
                      <span className={`absolute -left-[23px] top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full ring-4 ring-paper ${completed ? "bg-ok" : "bg-amber"}`} />
                      
                      <div className="rounded-xl2 bg-white p-3 shadow-card border border-line/40">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="text-sm font-semibold text-ink leading-tight">{p.title}</h4>
                          <div className="flex shrink-0 items-center gap-1.5">
                            {canManage && (
                              <>
                                <button
                                  onClick={() => openEditProgress(p)}
                                  className="rounded-full p-1 text-muted hover:bg-paper hover:text-steel"
                                  title="Sửa mốc"
                                >
                                  <PencilSquareIcon className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  onClick={() => handleDeleteProgress(p.id)}
                                  className="rounded-full p-1 text-muted hover:bg-paper hover:text-bad"
                                  title="Xóa mốc"
                                >
                                  <TrashIcon className="h-3.5 w-3.5" />
                                </button>
                              </>
                            )}
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${completed ? "bg-ok/10 text-ok" : "bg-amber/10 text-amber-deep"}`}>
                              {p.percent_complete}%
                            </span>
                          </div>
                        </div>
                        {p.note && <p className="mt-1 text-xs text-muted">{p.note}</p>}
                        <div className="mt-2.5 pt-2 border-t border-line flex justify-between text-[10px] text-muted">
                          <span>Kế hoạch: {p.planned_date ? formatDate(p.planned_date) : "—"}</span>
                          {p.actual_date && <span className="font-semibold text-ok">Thực tế: {formatDate(p.actual_date)}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

      </div>

      {/* Modal Thêm Hợp Đồng */}
      <AnimatePresence>
        {contractModal && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25 }}
              className="w-full max-w-md lg:max-w-lg rounded-t-xl2 bg-white p-5 lg:p-6 shadow-card"
            >
              <div className="flex items-center justify-between border-b border-line pb-3">
                <h2 className="text-sm font-bold text-ink">Thêm hợp đồng mới</h2>
                <button onClick={() => setContractModal(false)} className="rounded-full p-1 hover:bg-paper">
                  <XMarkIcon className="h-5 w-5 text-muted" />
                </button>
              </div>

              <form onSubmit={handleAddContract} className="mt-4 space-y-3">
                {error && <p className="text-xs text-bad">{error}</p>}
                
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold text-muted block mb-1">Mã hợp đồng *</label>
                    <input
                      type="text"
                      required
                      placeholder="HD-01/2026"
                      value={newContract.code}
                      onChange={(e) => setNewContract({ ...newContract, code: e.target.value })}
                      className="w-full rounded-xl2 border border-line bg-paper px-3 py-2 text-xs focus:bg-white focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-muted block mb-1">Đối tác/Bên ký</label>
                    <input
                      type="text"
                      placeholder="Tên đối tác..."
                      value={newContract.partner}
                      onChange={(e) => setNewContract({ ...newContract, partner: e.target.value })}
                      className="w-full rounded-xl2 border border-line bg-paper px-3 py-2 text-xs focus:bg-white focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-muted block mb-1">Tên hợp đồng *</label>
                  <input
                    type="text"
                    required
                    placeholder="VD: Thi công san lấp..."
                    value={newContract.name}
                    onChange={(e) => setNewContract({ ...newContract, name: e.target.value })}
                    className="w-full rounded-xl2 border border-line bg-paper px-3 py-2 text-xs focus:bg-white focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold text-muted block mb-1">Giá trị chưa VAT (VND)</label>
                    <input
                      type="number"
                      placeholder="VD: 5000000000"
                      value={newContract.value_no_vat || ""}
                      onChange={(e) => setNewContract({ ...newContract, value_no_vat: Number(e.target.value) })}
                      className="w-full rounded-xl2 border border-line bg-paper px-3 py-2 text-xs focus:bg-white focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-muted block mb-1">% Thuế VAT</label>
                    <input
                      type="number"
                      value={newContract.vat_percent}
                      onChange={(e) => setNewContract({ ...newContract, vat_percent: Number(e.target.value) })}
                      className="w-full rounded-xl2 border border-line bg-paper px-3 py-2 text-xs focus:bg-white focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold text-muted block mb-1">Ngày ký hợp đồng</label>
                    <input
                      type="date"
                      value={newContract.sign_date}
                      onChange={(e) => setNewContract({ ...newContract, sign_date: e.target.value })}
                      className="w-full rounded-xl2 border border-line bg-paper px-3 py-2 text-xs focus:bg-white focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-muted block mb-1">Trạng thái hợp đồng</label>
                    <select
                      value={newContract.status}
                      onChange={(e) => setNewContract({ ...newContract, status: e.target.value })}
                      className="w-full rounded-xl2 border border-line bg-paper px-3 py-2 text-xs focus:bg-white focus:outline-none"
                    >
                      <option value="DRAFT">Nháp</option>
                      <option value="ACTIVE">Hiệu lực</option>
                      <option value="COMPLETED">Hoàn thành</option>
                      <option value="LIQUIDATED">Đã thanh lý</option>
                    </select>
                  </div>
                </div>

                <div className="pt-2 flex gap-2">
                  <button
                    type="submit"
                    className="flex-1 rounded-xl2 bg-amber py-2.5 text-xs font-semibold text-ink text-center"
                  >
                    Thêm hợp đồng
                  </button>
                  <button
                    type="button"
                    onClick={() => setContractModal(false)}
                    className="rounded-xl2 bg-paper px-4 py-2.5 text-xs text-muted font-medium"
                  >
                    Hủy
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal Cập Nhật Tiến Độ */}
      <AnimatePresence>
        {progressModal && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25 }}
              className="w-full max-w-md lg:max-w-lg rounded-t-xl2 bg-white p-5 lg:p-6 shadow-card"
            >
              <div className="flex items-center justify-between border-b border-line pb-3">
                <h2 className="text-sm font-bold text-ink">
                  {editingProgressId != null ? "Sửa mốc tiến độ" : "Cập nhật tiến độ dự án"}
                </h2>
                <button onClick={() => { setProgressModal(false); setEditingProgressId(null); }} className="rounded-full p-1 hover:bg-paper">
                  <XMarkIcon className="h-5 w-5 text-muted" />
                </button>
              </div>

              <form onSubmit={handleAddProgress} className="mt-4 space-y-3">
                {error && <p className="text-xs text-bad">{error}</p>}
                
                <div>
                  <label className="text-[11px] font-semibold text-muted block mb-1">Mốc / Hạng mục thi công *</label>
                  <input
                    type="text"
                    required
                    placeholder="VD: Đổ bê tông sàn tầng 1"
                    value={newProgress.title}
                    onChange={(e) => setNewProgress({ ...newProgress, title: e.target.value })}
                    className="w-full rounded-xl2 border border-line bg-paper px-3 py-2 text-xs focus:bg-white focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-muted block mb-1">% Hoàn thành ({newProgress.percent_complete}%)</label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={newProgress.percent_complete}
                    onChange={(e) => setNewProgress({ ...newProgress, percent_complete: Number(e.target.value) })}
                    className="w-full h-1.5 bg-line rounded-lg appearance-none cursor-pointer"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold text-muted block mb-1">Ngày dự kiến hoàn thành</label>
                    <input
                      type="date"
                      value={newProgress.planned_date}
                      onChange={(e) => setNewProgress({ ...newProgress, planned_date: e.target.value })}
                      className="w-full rounded-xl2 border border-line bg-paper px-3 py-2 text-xs focus:bg-white focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-muted block mb-1">Ngày thực tế hoàn thành</label>
                    <input
                      type="date"
                      value={newProgress.actual_date}
                      onChange={(e) => setNewProgress({ ...newProgress, actual_date: e.target.value })}
                      className="w-full rounded-xl2 border border-line bg-paper px-3 py-2 text-xs focus:bg-white focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-muted block mb-1">Ghi chú tiến độ</label>
                  <textarea
                    rows={2}
                    placeholder="Thông tin thêm..."
                    value={newProgress.note}
                    onChange={(e) => setNewProgress({ ...newProgress, note: e.target.value })}
                    className="w-full rounded-xl2 border border-line bg-paper px-3 py-2 text-xs focus:bg-white focus:outline-none"
                  />
                </div>

                <div className="pt-2 flex gap-2">
                  <button
                    type="submit"
                    className="flex-1 rounded-xl2 bg-amber py-2.5 text-xs font-semibold text-ink text-center"
                  >
                    {editingProgressId != null ? "Lưu thay đổi" : "Ghi nhận tiến độ"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setProgressModal(false); setEditingProgressId(null); }}
                    className="rounded-xl2 bg-paper px-4 py-2.5 text-xs text-muted font-medium"
                  >
                    Hủy
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal Cập nhật thành viên dự án */}
      <AnimatePresence>
        {membersModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl2 bg-white p-5 shadow-card"
            >
              <div className="flex items-center justify-between border-b border-line pb-3">
                <h3 className="text-sm font-bold text-ink flex items-center gap-1.5">
                  <PencilSquareIcon className="h-5 w-5 text-steel" />
                  Sửa dự án
                </h3>
                <button
                  onClick={() => setMembersModal(false)}
                  className="rounded-full p-1.5 text-muted hover:bg-paper hover:text-ink"
                >
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>

              {/* Thông tin dự án: Tên / Mã QL / Thời gian bắt đầu–kết thúc */}
              <div className="mt-3 space-y-2.5">
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-muted">Tên dự án (プロジェクト名) <span className="text-bad">*</span></label>
                  <input
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    placeholder="Tên dự án"
                    className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-muted">Mã quản lý (管理番号)</label>
                  <input
                    value={codeInput}
                    onChange={(e) => setCodeInput(e.target.value)}
                    placeholder="VD: NF-001"
                    className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-muted">Ngày bắt đầu</label>
                    <input
                      type="date"
                      value={startInput}
                      onChange={(e) => setStartInput(e.target.value)}
                      className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-muted">Ngày kết thúc</label>
                    <input
                      type="date"
                      value={endInput}
                      min={startInput || undefined}
                      onChange={(e) => setEndInput(e.target.value)}
                      className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
                    />
                  </div>
                </div>
                <div className="border-t border-line/60 pt-2.5">
                  <label className="mb-1 block text-[11px] font-semibold text-muted">Nhóm (グループ)</label>
                  <input
                    value={groupNameInput}
                    onChange={(e) => setGroupNameInput(e.target.value)}
                    placeholder="VD: Nhóm A"
                    className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-muted">GEO担当 (chọn hoặc gõ)</label>
                    <input
                      list="geo-mgr-list"
                      value={geoInput}
                      onChange={(e) => setGeoInput(e.target.value)}
                      placeholder="Bấm để chọn…"
                      className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-muted">DOSCO担当 (chọn hoặc gõ)</label>
                    <input
                      list="dosco-mgr-list"
                      value={doscoInput}
                      onChange={(e) => setDoscoInput(e.target.value)}
                      placeholder="Bấm để chọn…"
                      className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
                    />
                  </div>
                  <datalist id="geo-mgr-list">{mgrs.geo.map((n) => <option key={n} value={n} />)}</datalist>
                  <datalist id="dosco-mgr-list">{mgrs.dosco.map((n) => <option key={n} value={n} />)}</datalist>
                </div>
              </div>

              <p className="mt-3 text-[11px] text-muted">
                Tick chọn thành viên. Bấm <StarIcon className="inline h-3 w-3 text-amber" /> để đặt
                <b className="text-ink"> người chủ trì</b> (chỉ 1 người). Bấm lại ngôi sao đang bật để gỡ chủ trì.
              </p>

              {/* Danh sách checklist thành viên + chọn chủ trì */}
              <div className="mt-3 max-h-60 overflow-y-auto space-y-2.5 pr-1">
                {allUsers.length === 0 ? (
                  <p className="text-center text-xs text-muted py-4">Đang tải danh sách nhân viên…</p>
                ) : (
                  allUsers.map((u) => {
                    const isChecked = selectedMemberIds.includes(u.id);
                    const isLead = selectedLeadId === u.id;
                    return (
                      <div
                        key={u.id}
                        className={`flex items-center justify-between rounded-lg border p-3 transition-colors ${isLead ? "border-amber/50 bg-amber/10" : "border-line/60 hover:bg-paper"}`}
                      >
                        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => handleToggleMember(u.id)}
                            className="h-4 w-4 rounded border-line text-steel focus:ring-steel cursor-pointer"
                          />
                          <span className="min-w-0">
                            <span className="block text-xs font-semibold text-ink truncate">{u.full_name}</span>
                            <span className="block text-[10px] text-muted">{roleTitle(u.role, u.has_subordinates)} · {u.email}</span>
                          </span>
                        </label>
                        <button
                          type="button"
                          onClick={() => setSelectedLeadId((prev) => (prev === u.id ? null : u.id))}
                          title={isLead ? "Gỡ chủ trì" : "Đặt làm chủ trì"}
                          className={`ml-2 shrink-0 rounded-full p-1.5 transition-colors ${isLead ? "text-amber" : "text-muted hover:bg-paper hover:text-amber"}`}
                        >
                          <StarIcon className={`h-4 w-4 ${isLead ? "fill-amber" : ""}`} />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
              {error && <p className="mt-2 text-[11px] text-bad">{error}</p>}

              {/* Actions */}
              <div className="mt-5 flex gap-3 border-t border-line pt-3">
                <button
                  onClick={() => setMembersModal(false)}
                  className="flex-1 rounded-xl2 border border-line py-2 text-xs font-semibold text-muted hover:bg-paper hover:text-ink transition-colors"
                >
                  Hủy bỏ
                </button>
                <button
                  onClick={handleSaveMembers}
                  disabled={savingMembers}
                  className="flex-1 rounded-xl2 bg-ink text-white py-2 text-xs font-semibold hover:bg-steel transition-colors flex items-center justify-center gap-1 disabled:opacity-50"
                >
                  {savingMembers ? (
                    <div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-amber" />
                  ) : (
                    "Lưu thay đổi"
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </AppShell>
  );
}

function TabButton({
  active,
  onClick,
  label,
  icon: Icon,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  count?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 pb-2 flex flex-col items-center gap-1 border-b-2 text-center transition-all ${
        active ? "border-amber text-ink font-semibold" : "border-transparent text-muted"
      }`}
    >
      <Icon className="h-5 w-5" />
      <span className="text-[10px] leading-tight flex items-center gap-1">
        {label}
        {count !== undefined && count > 0 && (
          <span className={`rounded-full px-1.5 text-[8px] font-bold ${active ? "bg-amber text-ink" : "bg-line text-muted"}`}>
            {count}
          </span>
        )}
      </span>
    </button>
  );
}
