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
import ProjectTimesheet from "@/components/project-timesheet";
import ProjectTeamTab from "@/components/project-team-tab";
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

// Trạng thái mốc tiến độ (bảng tiến độ có cấu trúc).
const PROGRESS_STATUS: Record<string, { label: string; cls: string }> = {
  TODO: { label: "Chưa làm", cls: "bg-line text-muted" },
  DOING: { label: "Đang làm", cls: "bg-amber/15 text-amber-deep" },
  DONE: { label: "Hoàn thành", cls: "bg-ok/15 text-ok" },
};

function getRoleRank(role?: string | null, hasSubordinates?: boolean | null): number {
  if (!role) return 99;
  if (role === "ADMIN" || role === "DIRECTOR") return 0;
  if (role === "MANAGER" || (role === "FIELD_STAFF" && hasSubordinates)) return 1;
  if (role === "ACCOUNTANT") return 2;
  return 3; // FIELD_STAFF without subordinates (Nhân viên)
}

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = Number(params.id);

  const [project, setProject] = useState<Project | null>(null);
  const [progressLogs, setProgressLogs] = useState<Progress[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"items" | "progress" | "team">("items");

  // Current user & company users
  const [currentUser, setCurrentUser] = useState<User | null>(api.cachedUser());
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [mgrs, setMgrs] = useState<{ geo: string[]; dosco: string[] }>({ geo: [], dosco: [] });

  // Nhân viên (STAFF) không được xem TIỀN của dự án. Backend là nguồn chân lý
  // (chặn GET hợp đồng/thanh toán/hóa đơn với STAFF, mask khối lượng/đơn giá hạng mục);
  // FE gate để ẩn UI cho khớp và tránh gọi API bị 403.
  const showMoney = canSeeMoney(currentUser?.role);

  // Modals & Member management states
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

  const [newProgress, setNewProgress] = useState({
    title: "",
    percent_complete: 0,
    planned_date: "",
    actual_date: "",
    note: "",
    assignee_id: "" as number | "",   // người thực hiện
    quantity: "",                      // khối lượng (chuỗi để gõ mượt)
    status: "TODO",                    // TODO / DOING / DONE
  });

  function loadData(silent = false) {
    if (isNaN(projectId)) return;
    if (currentUser == null) return;
    if (!silent) setLoading(true);

    Promise.all([
      api.getProject(projectId),
      api.progress(projectId),
    ])
      .then(([proj, prog]) => {
        setProject(proj);
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
        const want = new URLSearchParams(window.location.search).get("tab");
        const allowed = ["items", "progress", "team"];
        if (want && allowed.includes(want)) {
          setActiveTab(want as "items" | "progress" | "team");
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
    const anyModalOpen = progressModal || membersModal;
    if (anyModalOpen) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") loadData(true);
    }, 20_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, currentUser, showMoney, progressModal, membersModal]);

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
      assignee_id: p.assignee_id ?? "",
      quantity: p.quantity != null ? String(p.quantity) : "",
      status: p.status ?? "TODO",
    });
    setError(null);
    setProgressModal(true);
  }

  function openCreateProgress() {
    setEditingProgressId(null);
    setNewProgress({ title: "", percent_complete: 0, planned_date: "", actual_date: "", note: "", assignee_id: "", quantity: "", status: "TODO" });
    setError(null);
    setProgressModal(true);
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
        assignee_id: newProgress.assignee_id === "" ? null : Number(newProgress.assignee_id),
        quantity: newProgress.quantity === "" ? 0 : Number(newProgress.quantity),
        status: newProgress.status,
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
        assignee_id: "",
        quantity: "",
        status: "TODO",
      });
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lưu tiến độ thất bại.");
    }
  }

  if (loading) {
    return (
      <AppShell maxWidthClass="max-w-md lg:max-w-none lg:px-4">
        <p className="py-20 text-center text-xs text-muted">Đang tải chi tiết dự án...</p>
      </AppShell>
    );
  }

  if (!project) {
    return (
      <AppShell maxWidthClass="max-w-md lg:max-w-none lg:px-4">
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
    <AppShell maxWidthClass="max-w-md lg:max-w-none lg:px-4">
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
            <span className="font-mono text-sm font-bold text-bad">{project.code}</span>
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
            {(() => {
              const otherMembers = (project.members ?? [])
                .filter((m) => m.id !== project.lead_id)
                .sort((a, b) => {
                  const rankA = getRoleRank(a.role, a.has_subordinates);
                  const rankB = getRoleRank(b.role, b.has_subordinates);
                  if (rankA !== rankB) return rankA - rankB;
                  return a.full_name.localeCompare(b.full_name, "vi");
                });
              if (otherMembers.length === 0) {
                return <p className="text-[11px] text-muted italic">Chưa phân công thành viên thực hiện.</p>;
              }
              return otherMembers.map((member) => (
                <span
                  key={member.id}
                  className="inline-flex items-center gap-1 rounded-md border bg-paper border-line/50 px-2 py-0.5 text-[10px] font-semibold text-ink"
                  title={`${roleTitle(member.role, member.has_subordinates)} - ${member.phone || "Không có SĐT"}`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-amber" />
                  {member.full_name}
                  <span className="text-[9px] text-muted">({roleTitle(member.role, member.has_subordinates)})</span>
                </span>
              ));
            })()}
          </div>
        </div>
      </div>

      {/* Tabs điều hướng */}
      <div className="mt-6 flex border-b border-line">
        <TabButton active={activeTab === "items"} onClick={() => setActiveTab("items")} label="Hạng mục" icon={TableCellsIcon} />
        <TabButton active={activeTab === "progress"} onClick={() => setActiveTab("progress")} label="Tiến độ" icon={ClockIcon} count={progressLogs.length} />
        <TabButton active={activeTab === "team"} onClick={() => setActiveTab("team")} label="Phân công" icon={UsersIcon} count={project.members?.length ?? 0} />
      </div>

      {/* Nội dung Tab */}
      <div className="mt-4">

        {/* Tab Hạng mục (bảng dự toán Excel) */}
        {/* Bảng dự toán: ẩn Khối lượng + Đơn giá + Thành tiền + tiểu tổng + tổng cho MỌI
            vai trò (theo yêu cầu bỏ phần dự toán) — chỉ giữ tên hạng mục, ĐVT, % hoàn thành. */}
        {activeTab === "items" && <ProjectItemsTab projectId={projectId} canSeeMoney={false} members={project.members ?? []} canManage={canManage} />}

        {/* Tab Phân công — ai làm gì, bao lâu (từ giao việc lọc theo dự án) */}
        {activeTab === "team" && (
          <ProjectTeamTab
            projectId={projectId}
            members={project.members ?? []}
            leadId={project.lead_id ?? null}
            canManage={canManage}
          />
        )}

        {/* Tab Tiến độ */}
        {activeTab === "progress" && (
          <div className="space-y-4">
            {/* Bảng tiến độ ngày = NHÂN CÔNG theo ngày: chỉ cần điền số giờ vào là chạy. */}
            <ProjectTimesheet
              projectId={projectId}
              members={project.members ?? []}
              currentUserId={currentUser?.id ?? null}
              canManage={canManage}
              startDate={project.start_date ?? null}
              endDate={project.end_date ?? null}
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

            <div className="overflow-x-auto rounded-xl2 border border-line bg-white shadow-card">
                <table className="w-full min-w-[720px] border-collapse text-xs">
                  <thead>
                    <tr className="bg-paper text-left text-[11px] uppercase tracking-wide text-muted">
                      <th className="w-10 border border-line px-3 py-2 text-center">STT</th>
                      <th className="border border-line px-3 py-2">Công việc</th>
                      <th className="border border-line px-3 py-2">Người thực hiện</th>
                      <th className="border border-line px-3 py-2 text-right">Khối lượng</th>
                      <th className="border border-line px-3 py-2">Thời gian</th>
                      <th className="border border-line px-3 py-2">Trạng thái</th>
                      {canManage && <th className="w-16 border border-line px-3 py-2 text-center"></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {progressLogs.length === 0 ? (
                      <tr>
                        <td colSpan={canManage ? 7 : 6} className="border border-line px-3 py-6 text-center text-muted">
                          Chưa ghi nhận nhật ký tiến độ nào. Bấm <b className="text-amber-deep">Cập nhật tiến độ</b> để thêm.
                        </td>
                      </tr>
                    ) : progressLogs.map((p, i) => {
                      const st = PROGRESS_STATUS[p.status ?? "TODO"] ?? PROGRESS_STATUS.TODO;
                      return (
                        <tr key={p.id} className="align-top odd:bg-white even:bg-paper/40">
                          <td className="border border-line px-3 py-2 text-center text-muted tnum">{i + 1}</td>
                          <td className="border border-line px-3 py-2">
                            <p className="font-semibold text-ink">{p.title}</p>
                            {p.note && <p className="mt-0.5 text-[11px] text-muted">{p.note}</p>}
                          </td>
                          <td className="whitespace-nowrap border border-line px-3 py-2 text-ink">{p.assignee_name || "—"}</td>
                          <td className="border border-line px-3 py-2 text-right text-ink tnum">
                            {p.quantity ? Number(p.quantity).toLocaleString("vi-VN") : "—"}
                          </td>
                          <td className="whitespace-nowrap border border-line px-3 py-2 text-muted">
                            {p.planned_date ? formatDate(p.planned_date) : "—"}
                            {p.actual_date && <span className="block text-[10px] font-semibold text-ok">TT: {formatDate(p.actual_date)}</span>}
                          </td>
                          <td className="border border-line px-3 py-2">
                            <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${st.cls}`}>{st.label}</span>
                          </td>
                          {canManage && (
                            <td className="border border-line px-2 py-2">
                              <div className="flex items-center justify-center gap-1">
                                <button onClick={() => openEditProgress(p)} title="Sửa" className="rounded p-1 text-muted hover:bg-paper hover:text-steel">
                                  <PencilSquareIcon className="h-3.5 w-3.5" />
                                </button>
                                <button onClick={() => handleDeleteProgress(p.id)} title="Xóa" className="rounded p-1 text-muted hover:bg-paper hover:text-bad">
                                  <TrashIcon className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
          </div>
        )}

      </div>



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

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold text-muted block mb-1">Người thực hiện</label>
                    <select
                      value={newProgress.assignee_id}
                      onChange={(e) => setNewProgress({ ...newProgress, assignee_id: e.target.value ? Number(e.target.value) : "" })}
                      className="w-full rounded-xl2 border border-line bg-paper px-3 py-2 text-xs focus:bg-white focus:outline-none"
                    >
                      <option value="">— Chọn người —</option>
                      {(project.members ?? []).map((m) => (
                        <option key={m.id} value={m.id}>{m.full_name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-muted block mb-1">Khối lượng</label>
                    <input
                      type="number"
                      placeholder="VD: 120"
                      value={newProgress.quantity}
                      onChange={(e) => setNewProgress({ ...newProgress, quantity: e.target.value })}
                      className="w-full rounded-xl2 border border-line bg-paper px-3 py-2 text-xs focus:bg-white focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-muted block mb-1">Trạng thái</label>
                  <select
                    value={newProgress.status}
                    onChange={(e) => setNewProgress({ ...newProgress, status: e.target.value })}
                    className="w-full rounded-xl2 border border-line bg-paper px-3 py-2 text-xs focus:bg-white focus:outline-none"
                  >
                    <option value="TODO">Chưa làm</option>
                    <option value="DOING">Đang làm</option>
                    <option value="DONE">Hoàn thành</option>
                  </select>
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
