"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  UsersIcon,
  UserPlusIcon,
  PencilSquareIcon,
  ClockIcon,
  AcademicCapIcon,
  IdentificationIcon,
  XMarkIcon,
  CheckIcon,
  ShieldCheckIcon,
  KeyIcon,
  BriefcaseIcon,
  BuildingOffice2Icon,
  ListBulletIcon,
  Squares2X2Icon,
  UserGroupIcon,
  PlusIcon,
} from "@heroicons/react/24/outline";
import AppShell from "@/components/app-shell";
import { api } from "@/lib/api";
import { ROLE_LABEL, roleTitle } from "@/lib/roles";
import { useNicknames } from "@/lib/nicknames";
import type { User, Role, Project, Assignment, Department } from "@/lib/types";
import { PRESET_DEPARTMENTS } from "@/lib/departments";
import FilterBar, { NO_FILTERS, type Filters } from "@/components/filter-bar";

// Một người có thể thuộc NHIỀU phòng cùng lúc — lưu trong cột `department`,
// các phòng ngăn cách bởi dấu phẩy (VD: "Phòng BIM, Phòng AI").
const splitDepts = (s?: string | null): string[] =>
  (s || "").split(",").map((x) => x.trim()).filter(Boolean);
const joinDepts = (arr: string[]): string =>
  Array.from(new Set(arr.map((x) => x.trim()).filter(Boolean))).join(", ");
const toggleDept = (current: string | null | undefined, dept: string): string => {
  const set = splitDepts(current);
  const i = set.indexOf(dept);
  if (i >= 0) set.splice(i, 1);
  else set.push(dept);
  return joinDepts(set);
};

export default function EmployeesPage() {
  const router = useRouter();
  const nick = useNicknames();
  const [currentUser, setCurrentUser] = useState<User | null>(api.cachedUser());
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  // Cách xem danh sách nhân sự: phẳng, gom theo phòng ban, hay gom theo quản lý.
  const [viewMode, setViewMode] = useState<"list" | "department" | "manager">("list");
  // Danh mục phòng ban lấy từ backend (nguồn chân lý); Admin/Giám đốc thêm/đổi tên.
  const [departments, setDepartments] = useState<Department[]>([]);
  const [showDeptManager, setShowDeptManager] = useState(false);
  // Bộ lọc dùng chung: theo phòng ban + theo người chủ trì (= quản lý trực tiếp).
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  
  // States for the edit form
  const [formData, setFormData] = useState({
    full_name: "",
    email: "",
    phone: "",
    address: "",
    dob: "",
    identity_card: "",
    cv_details: "",
    schedule: "",
    department: "",
    manager_id: "",
    role: "" as Role | "",
    is_active: true,
    work_start: "",
    work_end: "",
  });
  
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // States for the "create new employee" form
  const emptyCreate = {
    email: "",
    full_name: "",
    password: "",
    role: "FIELD_STAFF" as Role,
    phone: "",
    department: "",
    manager_id: "",
  };
  const [showCreate, setShowCreate] = useState(false);
  const [createData, setCreateData] = useState(emptyCreate);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  // Duyệt tài khoản chờ (đăng nhập Google lần đầu): chọn vị trí cho từng người.
  const [pendingRole, setPendingRole] = useState<Record<number, Role>>({});
  const [pendingError, setPendingError] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  // Admin đặt lại mật khẩu cho nhân viên đang chọn.
  const [newPassword, setNewPassword] = useState("");
  const [resetMsg, setResetMsg] = useState("");
  const [resetting, setResetting] = useState(false);

  // Giao việc cho nhân viên đang chọn (Giám đốc/Quản lý) + danh sách việc đã giao.
  const [projectsList, setProjectsList] = useState<Project[]>([]);
  const [assignmentsList, setAssignmentsList] = useState<Assignment[]>([]);
  const [assignTitle, setAssignTitle] = useState("");
  const [assignProjectId, setAssignProjectId] = useState("");
  const [assignDesc, setAssignDesc] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [assignMsg, setAssignMsg] = useState("");

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    // 1. Get current logged in user to check permission
    api.me()
      .then((me) => {
        if (!alive) return;
        setCurrentUser(me);
        if (me.role === "FIELD_STAFF") {
          setLoading(false);
          return;
        }
        // Danh sách dự án (cho ô chọn khi giao việc).
        api.projects().then((d) => alive && setProjectsList(d)).catch(() => {});
        // Danh mục phòng ban của công ty (đổ vào ô chọn phòng + modal quản lý).
        api.departments().then((d) => alive && setDepartments(d)).catch(() => {});
        // 2. Fetch all company users (lần đầu bật spinner, poll thì không).
        api.users()
          .then((data) => {
            if (!alive) return;
            setUsers(data);
            setLoading(false);
          })
          .catch(() => alive && setLoading(false));
        // Poll ~20s: cập nhật danh sách chờ duyệt + cờ has_subordinates.
        timer = setInterval(() => {
          if (document.visibilityState === "visible") {
            api.users().then((d) => alive && setUsers(d)).catch(() => {});
          }
        }, 20_000);
      })
      .catch(() => {
        router.push("/login");
      });
    return () => { alive = false; if (timer) clearInterval(timer); };
  }, [router]);

  // Update form data when selected user changes
  useEffect(() => {
    if (selectedUser) {
      setFormData({
        full_name: selectedUser.full_name || "",
        email: selectedUser.email || "",
        phone: selectedUser.phone || "",
        address: selectedUser.address || "",
        dob: selectedUser.dob || "",
        identity_card: selectedUser.identity_card || "",
        cv_details: selectedUser.cv_details || "",
        schedule: selectedUser.schedule || "",
        manager_id: selectedUser.manager_id ? String(selectedUser.manager_id) : "",
        role: selectedUser.role || "",
        is_active: selectedUser.is_active,
        department: selectedUser.department || "",
        work_start: selectedUser.work_start || "",
        work_end: selectedUser.work_end || "",
      });
      setSuccessMsg("");
      setErrorMsg("");
      setNewPassword("");
      setResetMsg("");
      setAssignTitle("");
      setAssignDesc("");
      setAssignProjectId("");
      setAssignMsg("");
      api.assignments({ assigneeId: selectedUser.id }).then(setAssignmentsList).catch(() => setAssignmentsList([]));
    }
  }, [selectedUser]);

  if (loading) {
    return (
      <AppShell><div className="flex min-h-[70vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-steel border-t-amber" />
      </div></AppShell>
    );
  }

  // Access denied if field staff tries to access
  if (!currentUser || currentUser.role === "FIELD_STAFF") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-paper p-4 text-center">
        <XMarkIcon className="h-16 w-16 text-bad" />
        <h1 className="mt-4 text-lg font-bold text-ink">Không có quyền truy cập</h1>
        <p className="mt-2 text-sm text-muted max-w-xs">
          Trang này chỉ dành cho cấp Quản lý, Kế toán và Ban Giám đốc.
        </p>
      </div>
    );
  }

  // CHỈ Quản trị web (ADMIN) & Giám đốc được thêm/sửa người truy cập (khớp quyền backend).
  // Các vai trò khác chỉ XEM danh sách (không thêm/sửa/khóa).
  const canManage =
    currentUser.role === "ADMIN" || currentUser.role === "DIRECTOR";

  // Filter possible managers: ADMIN, DIRECTOR, MANAGER
  const potentialManagers = users.filter(
    (u) => (u.role === "ADMIN" || u.role === "DIRECTOR" || u.role === "MANAGER") && u.id !== selectedUser?.id
  );

  // Chờ duyệt = tự đăng ký Google, chưa được duyệt và chưa bị từ chối.
  const pendingUsers = users.filter((u) => !u.is_approved && u.is_active);
  const approvedUsers = users.filter((u) => u.is_approved);

  const filteredUsers = approvedUsers.filter(
    (u) =>
      (u.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.email.toLowerCase().includes(searchQuery.toLowerCase())) &&
      (!filters.dept || splitDepts(u.department).includes(filters.dept)) &&
      (filters.leadId === "" || u.manager_id === filters.leadId)
  );

  // Gợi ý phòng ban: danh mục từ backend (Admin/Giám đốc quản lý) + phòng nào đã có
  // sẵn trong dữ liệu nhưng chưa nằm trong danh mục (giữ tương thích dữ liệu cũ).
  // Nếu chưa nạp được danh mục thì lùi về danh sách cố định PRESET_DEPARTMENTS.
  const knownDepartments = departments.length
    ? departments.map((d) => d.name)
    : PRESET_DEPARTMENTS;
  const extraDepartments = Array.from(
    new Set(users.flatMap((u) => splitDepts(u.department)))
  )
    .filter((d) => !knownDepartments.includes(d))
    .sort((a, b) => a.localeCompare(b, "vi"));
  const departmentOptions = [...knownDepartments, ...extraDepartments];

  // Một nhóm nhân sự (theo phòng ban hoặc theo quản lý) khi hiển thị dạng gom.
  type EmpGroup = {
    key: string;
    label: string;
    subtitle?: string;
    members: User[];
    headIds: Set<number>;   // id những người "phụ trách" nhóm (in đậm + huy hiệu)
  };

  // GOM THEO PHÒNG BAN: mỗi phòng ban 1 nhóm; người phụ trách = quản lý trong phòng
  // (vai trò MANAGER, hoặc có cấp dưới, hoặc đang là quản lý trực tiếp của người khác trong phòng).
  function buildDepartmentGroups(): EmpGroup[] {
    // Một người thuộc nhiều phòng -> xuất hiện ở nhiều nhóm.
    const map = new Map<string, { label: string; members: User[] }>();
    for (const u of filteredUsers) {
      const depts = splitDepts(u.department);
      const entries = depts.length ? depts : ["__none__"];
      for (const d of entries) {
        const key = d === "__none__" ? "__none__" : d.toLowerCase();
        const label = d === "__none__" ? "Chưa phân phòng ban" : d;
        const g = map.get(key);
        if (g) g.members.push(u);
        else map.set(key, { label, members: [u] });
      }
    }
    const groups: EmpGroup[] = [];
    for (const [key, { label, members }] of map) {
      const referenced = new Set(
        members.map((m) => m.manager_id).filter((x): x is number => !!x)
      );
      const headIds = new Set(
        members
          .filter((m) => m.role === "MANAGER" || m.has_subordinates || referenced.has(m.id))
          .map((m) => m.id)
      );
      members.sort((a, b) => {
        const ah = headIds.has(a.id) ? 0 : 1;
        const bh = headIds.has(b.id) ? 0 : 1;
        return ah - bh || a.full_name.localeCompare(b.full_name, "vi");
      });
      const headNames = members.filter((m) => headIds.has(m.id)).map((m) => nick(m.id, m.full_name));
      const subtitle =
        key === "__none__"
          ? undefined
          : headNames.length
          ? `Phụ trách: ${headNames.join(", ")}`
          : "Chưa có người phụ trách";
      groups.push({ key, label, subtitle, members, headIds });
    }
    groups.sort((a, b) =>
      a.key === "__none__" ? 1 : b.key === "__none__" ? -1 : a.label.localeCompare(b.label, "vi")
    );
    return groups;
  }

  // GOM THEO QUẢN LÝ: mỗi quản lý trực tiếp 1 nhóm gồm các cấp dưới; tiêu đề nhóm là
  // tên quản lý + chức vụ + phòng ban của họ. Người chưa có quản lý gom vào cuối.
  function buildManagerGroups(): EmpGroup[] {
    const byId = new Map(users.map((u) => [u.id, u]));
    const map = new Map<string, User[]>();
    for (const u of filteredUsers) {
      const key = u.manager_id ? String(u.manager_id) : "__none__";
      const arr = map.get(key);
      if (arr) arr.push(u);
      else map.set(key, [u]);
    }
    const groups: EmpGroup[] = [];
    for (const [key, members] of map) {
      members.sort((a, b) => a.full_name.localeCompare(b.full_name, "vi"));
      let label: string;
      let subtitle: string | undefined;
      if (key === "__none__") {
        label = "Chưa có quản lý trực tiếp";
      } else {
        const mgr = byId.get(Number(key));
        label = mgr ? nick(mgr.id, mgr.full_name) : `Quản lý #${key}`;
        const parts: string[] = [];
        if (mgr) parts.push(roleTitle(mgr.role, mgr.has_subordinates));
        if (mgr?.department) parts.push(mgr.department);
        subtitle = parts.join(" · ") || undefined;
      }
      groups.push({ key, label, subtitle, members, headIds: new Set() });
    }
    groups.sort((a, b) =>
      a.key === "__none__" ? 1 : b.key === "__none__" ? -1 : a.label.localeCompare(b.label, "vi")
    );
    return groups;
  }

  const groups =
    viewMode === "department"
      ? buildDepartmentGroups()
      : viewMode === "manager"
      ? buildManagerGroups()
      : [];

  // Duyệt: cấp quyền + phân vị trí. Từ chối: khóa tài khoản (rời khỏi danh sách chờ).
  async function handleApprove(u: User) {
    setBusyId(u.id);
    setPendingError("");
    try {
      const role = pendingRole[u.id] || "FIELD_STAFF";
      const updated = await api.updateUser(u.id, { is_approved: true, is_active: true, role });
      setUsers((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    } catch (err: any) {
      setPendingError(err.message || "Không duyệt được tài khoản.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(u: User) {
    setBusyId(u.id);
    setPendingError("");
    try {
      const updated = await api.updateUser(u.id, { is_active: false });
      setUsers((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    } catch (err: any) {
      setPendingError(err.message || "Không từ chối được tài khoản.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleResetPassword() {
    if (!selectedUser || newPassword.length < 6) return;
    setResetting(true);
    setResetMsg("");
    try {
      await api.resetUserPassword(selectedUser.id, newPassword);
      setResetMsg(`Đã đặt lại mật khẩu cho ${selectedUser.full_name}. Hãy gửi mật khẩu mới cho nhân viên.`);
      setNewPassword("");
    } catch (err: any) {
      setResetMsg(err.message || "Không đặt lại được mật khẩu.");
    } finally {
      setResetting(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    // Quản lý chỉ ở chế độ giao việc — không sửa hồ sơ (chặn cả khi lỡ bấm Enter).
    if (!selectedUser || !canManage) return;
    setSaving(true);
    setSuccessMsg("");
    setErrorMsg("");

    try {
      const payload: Partial<User> = {
        full_name: formData.full_name.trim() || undefined,
        email: formData.email.trim().toLowerCase() || undefined,
        phone: formData.phone || null,
        address: formData.address || null,
        dob: formData.dob || null,
        identity_card: formData.identity_card || null,
        cv_details: formData.cv_details || null,
        schedule: formData.schedule || null,
        manager_id: formData.manager_id ? Number(formData.manager_id) : null,
        role: formData.role ? (formData.role as Role) : undefined,
        is_active: formData.is_active,
        department: formData.department || null,
        work_start: formData.work_start || null,
        work_end: formData.work_end || null,
      };

      const updated = await api.updateUser(selectedUser.id, payload);
      
      // Update local state list
      setUsers(users.map((u) => (u.id === updated.id ? updated : u)));
      setSelectedUser(updated);
      setSuccessMsg("Cập nhật thông tin nhân viên thành công!");
    } catch (err: any) {
      setErrorMsg(err.message || "Không thể cập nhật thông tin nhân viên.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError("");
    try {
      const created = await api.createUser({
        email: createData.email.trim().toLowerCase(),
        full_name: createData.full_name.trim(),
        // Bỏ trống = tài khoản chỉ đăng nhập bằng Google (backend tự sinh mật khẩu).
        password: createData.password ? createData.password : undefined,
        role: createData.role,
        phone: createData.phone || null,
        department: createData.department || null,
        manager_id: createData.manager_id ? Number(createData.manager_id) : null,
      });
      setUsers((prev) => [...prev, created]);
      setShowCreate(false);
      setCreateData(emptyCreate);
    } catch (err: any) {
      setCreateError(err.message || "Không thể tạo nhân viên mới.");
    } finally {
      setCreating(false);
    }
  }

  // Giám đốc/Quản lý mới được giao việc (khớp quyền backend require_roles(DIRECTOR, MANAGER)).
  const canAssign =
    currentUser?.role === "ADMIN" || currentUser?.role === "DIRECTOR" || currentUser?.role === "MANAGER";

  async function handleAddAssignment() {
    if (!selectedUser || !assignTitle.trim()) return;
    setAssigning(true);
    setAssignMsg("");
    try {
      const created = await api.createAssignment({
        assignee_id: selectedUser.id,
        title: assignTitle.trim(),
        description: assignDesc.trim() || null,
        project_id: assignProjectId ? Number(assignProjectId) : null,
      });
      setAssignmentsList((prev) => [created, ...prev]);
      setAssignTitle("");
      setAssignDesc("");
      setAssignProjectId("");
      setAssignMsg("Đã giao việc & gửi thông báo cho nhân viên.");
    } catch (err: any) {
      setAssignMsg(err.message || "Không giao được việc.");
    } finally {
      setAssigning(false);
    }
  }

  async function handleAssignmentStatus(a: Assignment, status: string) {
    try {
      const updated = await api.updateAssignment(a.id, { status });
      setAssignmentsList((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    } catch {
      /* noop */
    }
  }

  return (
    <AppShell>
      {/* Gợi ý phòng ban dùng chung cho ô nhập ở form thêm & sửa nhân viên */}
      <datalist id="dept-options">
        {departmentOptions.map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>
      <div className="space-y-4 lg:space-y-6">
        {/* Header */}
        <section className="flex items-center justify-between rounded-xl2 bg-ink p-4 lg:p-6 text-white shadow-card">
          <div className="flex items-center gap-2">
            <UsersIcon className="h-5 w-5 text-amber" />
            <h1 className="text-base lg:text-xl font-bold">Danh sách Nhân sự</h1>
          </div>
          <span className="rounded-full bg-white/10 px-3 py-0.5 text-xs text-white/80">
            {approvedUsers.length} thành viên
          </span>
        </section>

        {/* Quy tắc cấp quyền truy cập web */}
        <section className="flex items-start gap-2 rounded-xl2 border border-line bg-white p-3 text-[11px] text-muted shadow-card">
          <ShieldCheckIcon className="h-4 w-4 shrink-0 text-steel" />
          <p>
            {canManage ? (
              <>
                Cấp quyền bằng cách <span className="font-semibold text-ink">tạo tài khoản (email + mật khẩu) và phân vị trí</span>,
                rồi gửi thông tin đăng nhập cho nhân viên. Chỉ Giám đốc &amp; Quản trị web được thêm / sửa / khóa / đặt lại mật khẩu.
              </>
            ) : (
              "Chỉ Giám đốc & Quản trị web mới được thêm/sửa người được truy cập."
            )}
          </p>
        </section>

        {/* Hàng chờ duyệt — người đăng nhập Google lần đầu */}
        {canManage && pendingUsers.length > 0 && (
          <section className="rounded-xl2 border border-amber/40 bg-amber/5 p-4 shadow-card">
            <div className="flex items-center gap-2">
              <ClockIcon className="h-5 w-5 text-amber-deep" />
              <h2 className="text-sm font-bold text-ink">Chờ duyệt ({pendingUsers.length})</h2>
            </div>
            <p className="mt-1 text-[11px] text-muted">
              Người đăng nhập Google lần đầu — chọn vị trí rồi bấm <b>Duyệt</b> để cấp quyền vào hệ thống. Lần sau họ vào thẳng.
            </p>
            {pendingError && <p className="mt-2 text-[11px] font-medium text-bad">{pendingError}</p>}
            <div className="mt-3 space-y-2">
              {pendingUsers.map((u) => (
                <div
                  key={u.id}
                  className="flex flex-col gap-2 rounded-xl2 bg-white p-3 shadow-card sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">{nick(u.id, u.full_name)}</p>
                    <p className="truncate font-mono text-[11px] text-muted">{u.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={pendingRole[u.id] || "FIELD_STAFF"}
                      onChange={(e) => setPendingRole({ ...pendingRole, [u.id]: e.target.value as Role })}
                      className="rounded-lg border border-line bg-paper px-2 py-1.5 text-xs outline-none focus:border-steel"
                    >
                      {Object.keys(ROLE_LABEL).map((r) => (
                        <option key={r} value={r}>{ROLE_LABEL[r as Role]}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => handleApprove(u)}
                      disabled={busyId === u.id}
                      className="rounded-xl2 bg-ok px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      Duyệt
                    </button>
                    <button
                      onClick={() => handleReject(u)}
                      disabled={busyId === u.id}
                      className="rounded-xl2 border border-line px-3 py-1.5 text-xs font-semibold text-muted hover:bg-paper disabled:opacity-50"
                    >
                      Từ chối
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Tìm kiếm + Thêm nhân viên */}
        <section className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Tìm theo tên hoặc email…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="min-w-0 flex-1 rounded-xl2 border border-line bg-white px-4 py-3 text-sm text-ink outline-none placeholder:text-muted focus:border-steel focus:ring-1 focus:ring-steel transition-all"
          />
          {canManage && (
            <button
              onClick={() => {
                setCreateData(emptyCreate);
                setCreateError("");
                setShowCreate(true);
              }}
              className="flex shrink-0 items-center gap-1.5 rounded-xl2 bg-ink px-3.5 py-3 text-xs font-semibold text-white shadow-card hover:bg-steel transition-colors"
            >
              <UserPlusIcon className="h-4 w-4" />
              Thêm
            </button>
          )}
        </section>

        {/* Lọc theo phòng ban + người chủ trì (áp cho cả 3 chế độ xem) */}
        <FilterBar
          show={{ dept: true, lead: true }}
          value={filters}
          onChange={setFilters}
          leadLabel="người chủ trì"
        />

        {/* Chế độ xem: phẳng / gom theo phòng ban / gom theo quản lý */}
        <section className="flex w-fit items-center gap-1 rounded-xl2 border border-line bg-white p-1 text-xs shadow-card">
          {([
            ["list", "Danh sách", ListBulletIcon],
            ["department", "Theo phòng ban", Squares2X2Icon],
            ["manager", "Theo quản lý", UserGroupIcon],
          ] as const).map(([mode, label, Icon]) => (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-semibold transition-colors ${
                viewMode === mode ? "bg-ink text-white shadow-card" : "text-muted hover:bg-paper"
              }`}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </section>

        {/* Quản lý danh mục phòng ban (chỉ Admin & Giám đốc) — chỉ hiện ở chế độ Theo phòng ban */}
        {viewMode === "department" && canManage && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setShowDeptManager(true)}
              className="flex items-center gap-1.5 rounded-xl2 border border-line bg-white px-3 py-2 text-xs font-semibold text-steel shadow-card hover:bg-paper transition-colors"
            >
              <BuildingOffice2Icon className="h-4 w-4" />
              Quản lý phòng ban
            </button>
          </div>
        )}

        {/* Danh sách nhân viên */}
        {viewMode === "list" ? (
          <section className="space-y-2 lg:space-y-0 lg:grid lg:grid-cols-2 lg:gap-3 xl:grid-cols-3">
            {filteredUsers.length === 0 ? (
              <p className="rounded-xl2 bg-white p-4 text-center text-xs text-muted shadow-card lg:col-span-full">
                Không tìm thấy nhân viên nào phù hợp.
              </p>
            ) : (
              filteredUsers.map((u) => (
                <EmployeeCard
                  key={u.id}
                  u={u}
                  selected={selectedUser?.id === u.id}
                  clickable={canAssign}
                  onClick={() => canAssign && setSelectedUser(u)}
                  nick={nick}
                />
              ))
            )}
          </section>
        ) : (
          <section className="space-y-4">
            {groups.length === 0 ? (
              <p className="rounded-xl2 bg-white p-4 text-center text-xs text-muted shadow-card">
                Không tìm thấy nhân viên nào phù hợp.
              </p>
            ) : (
              groups.map((g) => (
                <div
                  key={g.key}
                  className="overflow-hidden rounded-xl2 border border-line bg-white/60 shadow-card"
                >
                  <header className="flex items-center justify-between gap-2 border-b border-line bg-ink/[0.03] px-4 py-3">
                    <div className="flex min-w-0 items-center gap-2">
                      {viewMode === "manager" ? (
                        <UserGroupIcon className="h-5 w-5 shrink-0 text-steel" />
                      ) : (
                        <BuildingOffice2Icon className="h-5 w-5 shrink-0 text-steel" />
                      )}
                      <div className="min-w-0">
                        <h2 className="truncate text-sm font-bold text-ink">{g.label}</h2>
                        {g.subtitle && (
                          <p className="truncate text-[10px] text-muted">{g.subtitle}</p>
                        )}
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full bg-paper px-2.5 py-0.5 text-[11px] font-semibold text-muted">
                      {g.members.length} người
                    </span>
                  </header>
                  <div className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3">
                    {g.members.map((u) => (
                      <EmployeeCard
                        key={u.id}
                        u={u}
                        selected={selectedUser?.id === u.id}
                        clickable={canAssign}
                        onClick={() => canAssign && setSelectedUser(u)}
                        nick={nick}
                        head={g.headIds.has(u.id)}
                        showDept={viewMode !== "department"}
                        showManager={viewMode !== "manager"}
                      />
                    ))}
                  </div>
                </div>
              ))
            )}
          </section>
        )}
      </div>

      {/* Slide-over/Modal Form Chỉnh sửa chi tiết */}
      {selectedUser && (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink/50 backdrop-blur-sm transition-opacity">
          <div className="w-full max-w-md bg-paper flex flex-col h-full shadow-2xl animate-slide-in">
            {/* Modal Header */}
            <header className="flex items-center justify-between border-b border-line bg-white px-4 py-3">
              <div>
                <h2 className="text-sm font-bold text-ink">{nick(selectedUser.id, selectedUser.full_name)}</h2>
                <p className="text-[11px] text-muted">{roleTitle(selectedUser.role, selectedUser.has_subordinates)}</p>
              </div>
              <button
                onClick={() => setSelectedUser(null)}
                className="rounded-full p-1.5 text-muted hover:bg-paper hover:text-ink"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </header>

            {/* Modal Body / Form */}
            <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-4 space-y-4 pb-20">
              {successMsg && (
                <div className="flex items-center gap-2 rounded-xl2 bg-ok/10 p-3 text-xs font-medium text-ok">
                  <CheckIcon className="h-4 w-4 shrink-0" />
                  <span>{successMsg}</span>
                </div>
              )}
              {errorMsg && (
                <div className="flex items-center gap-2 rounded-xl2 bg-bad/10 p-3 text-xs font-medium text-bad">
                  <XMarkIcon className="h-4 w-4 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {!canManage && (
                <div className="rounded-xl2 bg-white p-3 text-[11px] text-muted shadow-card">
                  Bạn đang ở chế độ <b className="text-ink">giao việc</b>. Chỉ Giám đốc/Quản trị mới sửa được hồ sơ, vai trò, mật khẩu.
                </div>
              )}

              {canManage && (
              <>
              {/* Tài khoản đăng nhập */}
              <div className="space-y-3 rounded-xl2 bg-white p-4 shadow-card">
                <h3 className="text-xs font-bold text-ink uppercase tracking-wider flex items-center gap-1.5 text-steel">
                  <IdentificationIcon className="h-4 w-4" />
                  Tài khoản đăng nhập
                </h3>

                <div>
                  <label className="block text-[11px] font-semibold text-muted">Họ và tên *</label>
                  <input
                    type="text"
                    required
                    value={formData.full_name}
                    onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
                    placeholder="VD: Nguyễn Văn A"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-muted">Email đăng nhập *</label>
                  <input
                    type="email"
                    required
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
                    placeholder="ten@dosco.vn"
                  />
                  <p className="mt-1 text-[10px] text-muted">
                    Email để nhân viên đăng nhập. (Nếu sau này bật đăng nhập Google thì đây cũng là email Google của họ.)
                  </p>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-muted">Số điện thoại</label>
                  <input
                    type="text"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
                    placeholder="Nhập số điện thoại"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-muted">
                    Bộ phận / Phòng ban{" "}
                    <span className="font-normal text-muted/70">(chọn 1 hoặc nhiều)</span>
                  </label>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {departmentOptions.map((d) => {
                      const on = splitDepts(formData.department).includes(d);
                      return (
                        <button
                          type="button"
                          key={d}
                          onClick={() => setFormData({ ...formData, department: toggleDept(formData.department, d) })}
                          className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                            on ? "border-steel bg-steel/10 text-steel" : "border-line text-muted hover:bg-paper"
                          }`}
                        >
                          {on ? "✓ " : ""}
                          {d}
                        </button>
                      );
                    })}
                  </div>
                  <input
                    type="text"
                    list="dept-options"
                    value={formData.department}
                    onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                    className="mt-2 w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
                    placeholder="VD: Phòng BIM, Phòng AI"
                  />
                  <p className="mt-1 text-[10px] text-muted">
                    Người làm ở nhiều phòng (VD: BIM + AI) sẽ hiện ở cả các nhóm tương ứng.
                  </p>
                </div>
              </div>

              {/* Vai trò & Phân cấp quản lý */}
              <div className="space-y-3 rounded-xl2 bg-white p-4 shadow-card">
                <h3 className="text-xs font-bold text-ink uppercase tracking-wider flex items-center gap-1.5 text-steel">
                  <ShieldCheckIcon className="h-4 w-4" />
                  Vai trò & Phân cấp quản lý
                </h3>
                
                <div>
                  <label className="block text-[11px] font-semibold text-muted">Vai trò hệ thống</label>
                  <select
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value as Role })}
                    className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
                  >
                    {Object.keys(ROLE_LABEL).map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r as Role]}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-muted">Quyền truy cập web</label>
                  <div className="mt-1 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, is_active: true })}
                      className={`flex-1 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${formData.is_active ? "border-ok bg-ok/10 text-ok" : "border-line text-muted hover:bg-paper"}`}
                    >
                      Cho phép
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, is_active: false })}
                      className={`flex-1 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${!formData.is_active ? "border-bad bg-bad/10 text-bad" : "border-line text-muted hover:bg-paper"}`}
                    >
                      Khóa truy cập
                    </button>
                  </div>
                  <p className="mt-1 text-[10px] text-muted">Khóa ⇒ người này không đăng nhập được nữa (cả Google lẫn mật khẩu).</p>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-muted">Người quản lý trực tiếp</label>
                  <select
                    value={formData.manager_id}
                    onChange={(e) => setFormData({ ...formData, manager_id: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
                  >
                    <option value="">-- Chưa chỉ định người quản lý --</option>
                    {potentialManagers.map((mgr) => (
                      <option key={mgr.id} value={mgr.id}>
                        {mgr.full_name} ({ROLE_LABEL[mgr.role]})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Thông tin hồ sơ */}
              <div className="space-y-3 rounded-xl2 bg-white p-4 shadow-card">
                <h3 className="text-xs font-bold text-ink uppercase tracking-wider flex items-center gap-1.5 text-steel">
                  <IdentificationIcon className="h-4 w-4" />
                  Thông tin hồ sơ & liên hệ
                </h3>

                <div>
                  <label className="block text-[11px] font-semibold text-muted">Số CCCD / Hộ chiếu</label>
                  <input
                    type="text"
                    value={formData.identity_card}
                    onChange={(e) => setFormData({ ...formData, identity_card: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
                    placeholder="Nhập số CCCD"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-muted">Ngày sinh</label>
                  <input
                    type="date"
                    value={formData.dob}
                    onChange={(e) => setFormData({ ...formData, dob: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-muted">Địa chỉ thường trú</label>
                  <textarea
                    rows={2}
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel resize-none"
                    placeholder="Nhập địa chỉ đầy đủ"
                  />
                </div>
              </div>

              {/* Đặt lại mật khẩu (admin cấp lại khi nhân viên quên) */}
              <div className="space-y-3 rounded-xl2 bg-white p-4 shadow-card">
                <h3 className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 text-steel">
                  <KeyIcon className="h-4 w-4" />
                  Đặt lại mật khẩu
                </h3>
                {resetMsg && <p className="text-[11px] font-medium text-ok">{resetMsg}</p>}
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="block text-[11px] font-semibold text-muted">Mật khẩu mới (≥6 ký tự)</label>
                    <input
                      type="text"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
                      placeholder="Nhập mật khẩu mới rồi gửi cho nhân viên"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleResetPassword}
                    disabled={resetting || newPassword.length < 6}
                    className="shrink-0 rounded-xl2 bg-steel px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {resetting ? "Đang lưu…" : "Đặt lại"}
                  </button>
                </div>
              </div>
              </>
              )}

              {/* Phần việc / Giao việc (Giám đốc/Quản lý giao cho người này) */}
              {canAssign && (
                <div className="space-y-3 rounded-xl2 bg-white p-4 shadow-card">
                  <h3 className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 text-steel">
                    <BriefcaseIcon className="h-4 w-4" />
                    Phần việc / Giao việc
                  </h3>
                  <div className="space-y-2 rounded-lg bg-paper p-3">
                    <input
                      value={assignTitle}
                      onChange={(e) => setAssignTitle(e.target.value)}
                      placeholder="Tên phần việc / nhiệm vụ *"
                      className="w-full rounded-lg border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel"
                    />
                    <select
                      value={assignProjectId}
                      onChange={(e) => setAssignProjectId(e.target.value)}
                      className="w-full rounded-lg border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel"
                    >
                      <option value="">— Gắn dự án (tùy chọn) —</option>
                      {projectsList.map((p) => (
                        <option key={p.id} value={p.id}>{p.code ? `${p.code} — ` : ""}{p.name}</option>
                      ))}
                    </select>
                    <textarea
                      value={assignDesc}
                      onChange={(e) => setAssignDesc(e.target.value)}
                      rows={2}
                      placeholder="Mô tả (tùy chọn)"
                      className="w-full rounded-lg border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel"
                    />
                    {assignMsg && <p className="text-[11px] font-medium text-ok">{assignMsg}</p>}
                    <button
                      type="button"
                      onClick={handleAddAssignment}
                      disabled={assigning || !assignTitle.trim()}
                      className="w-full rounded-xl2 bg-ink py-2 text-xs font-semibold text-white hover:bg-steel disabled:opacity-50"
                    >
                      {assigning ? "Đang giao…" : `Giao việc cho ${selectedUser.full_name}`}
                    </button>
                  </div>
                  {assignmentsList.length === 0 ? (
                    <p className="text-center text-[11px] text-muted">Chưa giao việc nào cho người này.</p>
                  ) : (
                    <div className="space-y-2">
                      {assignmentsList.map((a) => (
                        <div key={a.id} className="rounded-lg border border-line p-2.5">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-xs font-semibold text-ink">{a.title}</p>
                            <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${a.status === "DONE" ? "bg-ok/10 text-ok" : a.status === "IN_PROGRESS" ? "bg-amber/15 text-amber-deep" : "bg-line text-muted"}`}>
                              {a.status === "DONE" ? "Hoàn thành" : a.status === "IN_PROGRESS" ? "Đang làm" : "Mới giao"}
                            </span>
                          </div>
                          {a.project_name && <p className="mt-0.5 text-[10px] text-steel">Dự án: {a.project_name}</p>}
                          {a.description && <p className="mt-0.5 text-[10px] text-muted">{a.description}</p>}
                          <div className="mt-1.5 flex gap-1.5">
                            {["ASSIGNED", "IN_PROGRESS", "DONE"].map((s) => (
                              <button
                                key={s}
                                type="button"
                                onClick={() => handleAssignmentStatus(a, s)}
                                className={`rounded-md px-2 py-0.5 text-[9px] font-semibold ${a.status === s ? "bg-ink text-white" : "bg-paper text-muted hover:bg-line"}`}
                              >
                                {s === "ASSIGNED" ? "Mới" : s === "IN_PROGRESS" ? "Đang làm" : "Xong"}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {canManage && (
              <>
              {/* Giờ làm việc cơ sở — dùng đánh giá đi muộn (giờ vào) */}
              <div className="space-y-3 rounded-xl2 bg-white p-4 shadow-card">
                <h3 className="text-xs font-bold text-ink uppercase tracking-wider flex items-center gap-1.5 text-steel">
                  <ClockIcon className="h-4 w-4" />
                  Giờ làm việc cơ sở
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-muted mb-1">Giờ vào</label>
                    <input
                      type="time"
                      value={formData.work_start}
                      onChange={(e) => setFormData({ ...formData, work_start: e.target.value })}
                      className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-muted mb-1">Giờ ra</label>
                    <input
                      type="time"
                      value={formData.work_end}
                      onChange={(e) => setFormData({ ...formData, work_end: e.target.value })}
                      className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
                    />
                  </div>
                </div>
                <p className="text-[10px] text-muted">
                  Nhân viên vào <b className="text-ink">muộn hơn giờ vào</b> sẽ bị tính đi muộn (trang Chấm công).
                  Để trống = dùng mốc chung của công ty.
                </p>
              </div>

              {/* Lịch làm việc */}
              <div className="space-y-3 rounded-xl2 bg-white p-4 shadow-card">
                <h3 className="text-xs font-bold text-ink uppercase tracking-wider flex items-center gap-1.5 text-steel">
                  <ClockIcon className="h-4 w-4" />
                  Lịch làm việc tuần này
                </h3>
                <div>
                  <textarea
                    rows={4}
                    value={formData.schedule}
                    onChange={(e) => setFormData({ ...formData, schedule: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
                    placeholder="Ví dụ:&#10;Thứ 2 - 6: Làm việc tại công trường 1B&#10;Thứ 7: Họp giao ban văn phòng"
                  />
                </div>
              </div>

              {/* Sơ yếu lý lịch */}
              <div className="space-y-3 rounded-xl2 bg-white p-4 shadow-card">
                <h3 className="text-xs font-bold text-ink uppercase tracking-wider flex items-center gap-1.5 text-steel">
                  <AcademicCapIcon className="h-4 w-4" />
                  Sơ yếu lý lịch (CV)
                </h3>
                <div>
                  <textarea
                    rows={6}
                    value={formData.cv_details}
                    onChange={(e) => setFormData({ ...formData, cv_details: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
                    placeholder="Thông tin học vấn, kinh nghiệm làm việc, kỹ năng chuyên môn..."
                  />
                </div>
              </div>
              </>
              )}
            </form>

            {/* Modal Actions */}
            <footer className="absolute bottom-0 inset-x-0 bg-white border-t border-line p-4 flex gap-3">
              <button
                type="button"
                onClick={() => setSelectedUser(null)}
                className="flex-1 rounded-xl2 border border-line py-2.5 text-xs font-semibold text-muted hover:bg-paper hover:text-ink transition-colors"
              >
                Hủy bỏ
              </button>
              {canManage && (
                <button
                  type="submit"
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 rounded-xl2 bg-ink text-white py-2.5 text-xs font-semibold hover:bg-steel transition-colors flex items-center justify-center gap-1 disabled:opacity-50"
                >
                  {saving ? (
                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-amber" />
                  ) : (
                    <>
                      <CheckIcon className="h-4 w-4" />
                      Lưu thay đổi
                    </>
                  )}
                </button>
              )}
            </footer>
          </div>
        </div>
      )}

      {/* Modal Tạo nhân viên mới */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink/50 backdrop-blur-sm">
          <div className="w-full max-w-md bg-paper flex flex-col h-full shadow-2xl animate-slide-in">
            <header className="flex items-center justify-between border-b border-line bg-white px-4 py-3">
              <div className="flex items-center gap-2">
                <UserPlusIcon className="h-5 w-5 text-steel" />
                <h2 className="text-sm font-bold text-ink">Thêm nhân viên mới</h2>
              </div>
              <button
                onClick={() => setShowCreate(false)}
                className="rounded-full p-1.5 text-muted hover:bg-paper hover:text-ink"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </header>

            <form onSubmit={handleCreate} className="flex-1 overflow-y-auto p-4 space-y-4 pb-24">
              {createError && (
                <div className="flex items-center gap-2 rounded-xl2 bg-bad/10 p-3 text-xs font-medium text-bad">
                  <XMarkIcon className="h-4 w-4 shrink-0" />
                  <span>{createError}</span>
                </div>
              )}

              <div className="space-y-3 rounded-xl2 bg-white p-4 shadow-card">
                <h3 className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 text-steel">
                  <IdentificationIcon className="h-4 w-4" />
                  Tài khoản đăng nhập
                </h3>

                <div>
                  <label className="block text-[11px] font-semibold text-muted">Họ và tên *</label>
                  <input
                    type="text"
                    required
                    value={createData.full_name}
                    onChange={(e) => setCreateData({ ...createData, full_name: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
                    placeholder="VD: Nguyễn Văn A"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-muted">Email đăng nhập *</label>
                  <input
                    type="email"
                    required
                    value={createData.email}
                    onChange={(e) => setCreateData({ ...createData, email: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
                    placeholder="ten@dosco.vn"
                  />
                  <p className="mt-1 text-[10px] text-muted">
                    Email để nhân viên đăng nhập. (Nếu sau này bật đăng nhập Google thì đây cũng là email Google của họ.)
                  </p>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-muted">Mật khẩu đăng nhập</label>
                  <input
                    type="text"
                    minLength={6}
                    value={createData.password}
                    onChange={(e) => setCreateData({ ...createData, password: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
                    placeholder="VD: dosco@2026"
                  />
                  <p className="mt-1 text-[10px] text-muted">
                    Đặt mật khẩu rồi gửi cho nhân viên (đăng nhập xong họ có thể tự đổi). Bỏ trống nếu chỉ dùng Google.
                  </p>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-muted">Số điện thoại</label>
                  <input
                    type="text"
                    value={createData.phone}
                    onChange={(e) => setCreateData({ ...createData, phone: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
                    placeholder="Nhập số điện thoại"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-muted">
                    Bộ phận / Phòng ban{" "}
                    <span className="font-normal text-muted/70">(chọn 1 hoặc nhiều)</span>
                  </label>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {departmentOptions.map((d) => {
                      const on = splitDepts(createData.department).includes(d);
                      return (
                        <button
                          type="button"
                          key={d}
                          onClick={() => setCreateData({ ...createData, department: toggleDept(createData.department, d) })}
                          className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                            on ? "border-steel bg-steel/10 text-steel" : "border-line text-muted hover:bg-paper"
                          }`}
                        >
                          {on ? "✓ " : ""}
                          {d}
                        </button>
                      );
                    })}
                  </div>
                  <input
                    type="text"
                    list="dept-options"
                    value={createData.department}
                    onChange={(e) => setCreateData({ ...createData, department: e.target.value })}
                    className="mt-2 w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
                    placeholder="VD: Phòng BIM, Phòng AI"
                  />
                </div>
              </div>

              <div className="space-y-3 rounded-xl2 bg-white p-4 shadow-card">
                <h3 className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 text-steel">
                  <ShieldCheckIcon className="h-4 w-4" />
                  Vai trò & Phân cấp quản lý
                </h3>

                <div>
                  <label className="block text-[11px] font-semibold text-muted">Vai trò hệ thống</label>
                  <select
                    value={createData.role}
                    onChange={(e) => setCreateData({ ...createData, role: e.target.value as Role })}
                    className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
                  >
                    {Object.keys(ROLE_LABEL).map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r as Role]}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-muted">Người quản lý trực tiếp</label>
                  <select
                    value={createData.manager_id}
                    onChange={(e) => setCreateData({ ...createData, manager_id: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
                  >
                    <option value="">-- Chưa chỉ định người quản lý --</option>
                    {users
                      .filter((u) => u.role === "ADMIN" || u.role === "DIRECTOR" || u.role === "MANAGER")
                      .map((mgr) => (
                        <option key={mgr.id} value={mgr.id}>
                          {mgr.full_name} ({ROLE_LABEL[mgr.role]})
                        </option>
                      ))}
                  </select>
                </div>
              </div>
            </form>

            <footer className="absolute bottom-0 inset-x-0 bg-white border-t border-line p-4 flex gap-3">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="flex-1 rounded-xl2 border border-line py-2.5 text-xs font-semibold text-muted hover:bg-paper hover:text-ink transition-colors"
              >
                Hủy bỏ
              </button>
              <button
                type="submit"
                onClick={handleCreate}
                disabled={creating}
                className="flex-1 rounded-xl2 bg-ink text-white py-2.5 text-xs font-semibold hover:bg-steel transition-colors flex items-center justify-center gap-1 disabled:opacity-50"
              >
                {creating ? (
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-amber" />
                ) : (
                  <>
                    <CheckIcon className="h-4 w-4" />
                    Tạo nhân viên
                  </>
                )}
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* Modal Quản lý phòng ban (Admin & Giám đốc): thêm phòng mới + đổi tên phòng */}
      {showDeptManager && (
        <DepartmentManagerModal
          departments={departments}
          onClose={() => setShowDeptManager(false)}
          onChanged={() => {
            api.departments().then(setDepartments).catch(() => {});
            api.users().then(setUsers).catch(() => {});
          }}
        />
      )}
    </AppShell>
  );
}

// Thẻ 1 nhân viên — dùng chung cho cả xem phẳng lẫn xem gom (phòng ban / quản lý).
//   head        : người phụ trách nhóm (viền + huy hiệu "Phụ trách").
//   showDept    : hiện dòng "Phòng ban" (ẩn khi đang gom theo phòng ban cho đỡ lặp).
//   showManager : hiện dòng "Quản lý trực tiếp" (ẩn khi đang gom theo quản lý).
function EmployeeCard({
  u,
  selected,
  clickable,
  onClick,
  nick,
  head = false,
  showDept = true,
  showManager = true,
}: {
  u: User;
  selected: boolean;
  clickable: boolean;
  onClick: () => void;
  nick: (id: number, name: string) => string;
  head?: boolean;
  showDept?: boolean;
  showManager?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      className={`rounded-xl2 bg-white p-4 shadow-card transition-all border-l-4 ${clickable ? "cursor-pointer" : ""} ${
        selected
          ? "border-amber bg-amber/5"
          : head
          ? "border-steel/60"
          : "border-transparent hover:border-slate-300"
      } ${u.is_active ? "" : "opacity-60"}`}
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-sm font-semibold text-ink">{nick(u.id, u.full_name)}</h3>
            {head && (
              <span className="shrink-0 rounded-full bg-steel/10 px-1.5 py-0.5 text-[9px] font-semibold text-steel">
                Phụ trách
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate font-mono text-[11px] text-muted">{u.email}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-medium text-steel">
              {roleTitle(u.role, u.has_subordinates)}
            </span>
            <span
              className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${u.is_active ? "bg-ok/10 text-ok" : "bg-bad/10 text-bad"}`}
            >
              {u.is_active ? "Đang truy cập" : "Đã khóa"}
            </span>
          </div>
        </div>
        {clickable && (
          <span className="shrink-0 rounded-md bg-paper p-1.5 text-muted hover:text-ink">
            <PencilSquareIcon className="h-4 w-4" />
          </span>
        )}
      </div>
      {((showDept && u.department) || (showManager && u.manager_name)) && (
        <div className="mt-2 flex flex-col gap-0.5 border-t border-line/50 pt-2 text-[10px] text-muted">
          {showDept && u.department && (
            <span className="flex items-center gap-1">
              <BuildingOffice2Icon className="h-3 w-3" /> Phòng ban:{" "}
              <span className="font-semibold text-ink">{u.department}</span>
            </span>
          )}
          {showManager && u.manager_name && (
            <span>
              Quản lý trực tiếp: <span className="font-semibold text-ink">{u.manager_name}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// Modal quản lý DANH MỤC phòng ban: thêm phòng mới (kể cả phòng chưa có ai) và
// đổi tên phòng. Đổi tên sẽ cascade ở backend (cập nhật users/hạng mục/biểu đồ),
// nên sau mỗi thao tác gọi onChanged() để nạp lại danh mục + danh sách nhân sự.
function DepartmentManagerModal({
  departments,
  onClose,
  onChanged,
}: {
  departments: Department[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState<number | "new" | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const nameOf = (d: Department) => (edits[d.id] ?? d.name);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setMsg("");
    const name = newName.trim();
    if (!name) { setErr("Nhập tên phòng ban."); return; }
    setBusy("new");
    try {
      await api.createDepartment(name);
      setNewName("");
      setMsg(`Đã thêm phòng "${name}".`);
      onChanged();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Thêm phòng ban thất bại.");
    } finally {
      setBusy(null);
    }
  }

  async function handleRename(d: Department) {
    setErr("");
    setMsg("");
    const name = nameOf(d).trim();
    if (!name) { setErr("Tên phòng ban không được để trống."); return; }
    if (name === d.name) return;
    setBusy(d.id);
    try {
      await api.renameDepartment(d.id, name);
      setMsg(`Đã đổi tên thành "${name}".`);
      setEdits((prev) => { const n = { ...prev }; delete n[d.id]; return n; });
      onChanged();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Đổi tên phòng ban thất bại.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl2 bg-white p-5 shadow-2xl">
        <header className="flex items-center justify-between border-b border-line pb-3">
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-ink">
            <BuildingOffice2Icon className="h-5 w-5 text-steel" />
            Quản lý phòng ban
          </h3>
          <button onClick={onClose} className="rounded-full p-1.5 text-muted hover:bg-paper hover:text-ink">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </header>

        {/* Thêm phòng mới */}
        <form onSubmit={handleAdd} className="mt-4 flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <label className="mb-1 block text-[11px] font-semibold text-muted">Thêm phòng ban mới</label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="VD: Phòng Kinh doanh"
              className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
            />
          </div>
          <button
            type="submit"
            disabled={busy === "new"}
            className="flex shrink-0 items-center gap-1 rounded-lg bg-ink px-3 py-2 text-xs font-semibold text-white hover:bg-steel transition-colors disabled:opacity-50"
          >
            <PlusIcon className="h-4 w-4" />
            Thêm
          </button>
        </form>

        {(err || msg) && (
          <p className={`mt-2 text-[11px] ${err ? "text-bad" : "text-ok"}`}>{err || msg}</p>
        )}

        {/* Danh sách phòng ban — đổi tên tại chỗ */}
        <div className="mt-4 space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
            Danh sách phòng ban ({departments.length})
          </p>
          {departments.length === 0 ? (
            <p className="rounded-lg bg-paper p-3 text-center text-xs text-muted">Chưa có phòng ban nào.</p>
          ) : (
            departments.map((d) => {
              const changed = nameOf(d).trim() !== d.name && nameOf(d).trim() !== "";
              return (
                <div key={d.id} className="flex items-center gap-2 rounded-lg border border-line/60 p-2">
                  <PencilSquareIcon className="h-4 w-4 shrink-0 text-muted" />
                  <input
                    value={nameOf(d)}
                    onChange={(e) => setEdits((prev) => ({ ...prev, [d.id]: e.target.value }))}
                    className="min-w-0 flex-1 rounded-md border border-transparent bg-paper px-2 py-1.5 text-xs text-ink outline-none focus:border-steel focus:bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => handleRename(d)}
                    disabled={!changed || busy === d.id}
                    className="flex shrink-0 items-center gap-1 rounded-md bg-steel px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-ink transition-colors disabled:opacity-40"
                  >
                    <CheckIcon className="h-3.5 w-3.5" />
                    Lưu
                  </button>
                </div>
              );
            })
          )}
        </div>

        <p className="mt-3 text-[10px] text-muted">
          Đổi tên phòng sẽ tự cập nhật cho tất cả nhân sự và hạng mục đang thuộc phòng đó.
        </p>
      </div>
    </div>
  );
}
