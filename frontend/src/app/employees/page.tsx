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
} from "@heroicons/react/24/outline";
import AppShell from "@/components/app-shell";
import { api } from "@/lib/api";
import { ROLE_LABEL, roleTitle } from "@/lib/roles";
import { useNicknames } from "@/lib/nicknames";
import type { User, Role, Project, Assignment } from "@/lib/types";

export default function EmployeesPage() {
  const router = useRouter();
  const nick = useNicknames();
  const [currentUser, setCurrentUser] = useState<User | null>(api.cachedUser());
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  
  // States for the edit form
  const [formData, setFormData] = useState({
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
      });
      setSuccessMsg("");
      setErrorMsg("");
      setNewPassword("");
      setResetMsg("");
      setAssignTitle("");
      setAssignDesc("");
      setAssignProjectId("");
      setAssignMsg("");
      api.assignments(selectedUser.id).then(setAssignmentsList).catch(() => setAssignmentsList([]));
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

  const filteredUsers = approvedUsers.filter((u) =>
    u.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

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

        {/* Danh sách nhân viên */}
        <section className="space-y-2 lg:space-y-0 lg:grid lg:grid-cols-2 lg:gap-3 xl:grid-cols-3">
          {filteredUsers.length === 0 ? (
            <p className="rounded-xl2 bg-white p-4 text-center text-xs text-muted shadow-card lg:col-span-full">
              Không tìm thấy nhân viên nào phù hợp.
            </p>
          ) : (
            filteredUsers.map((u) => {
              const isSelected = selectedUser?.id === u.id;
              return (
                <div
                  key={u.id}
                  onClick={() => canAssign && setSelectedUser(u)}
                  className={`rounded-xl2 bg-white p-4 shadow-card transition-all border-l-4 ${canAssign ? "cursor-pointer" : ""} ${
                    isSelected ? "border-amber bg-amber/5" : "border-transparent hover:border-slate-300"
                  } ${u.is_active ? "" : "opacity-60"}`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-ink">{nick(u.id, u.full_name)}</h3>
                      <p className="text-[11px] text-muted font-mono mt-0.5">{u.email}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="text-[11px] font-medium text-steel">
                          {roleTitle(u.role, u.has_subordinates)}
                        </span>
                        <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${u.is_active ? "bg-ok/10 text-ok" : "bg-bad/10 text-bad"}`}>
                          {u.is_active ? "Đang truy cập" : "Đã khóa"}
                        </span>
                      </div>
                    </div>
                    {canAssign && (
                      <span className="rounded-md bg-paper p-1.5 text-muted hover:text-ink">
                        <PencilSquareIcon className="h-4 w-4" />
                      </span>
                    )}
                  </div>
                  {(u.department || u.manager_name) && (
                    <div className="mt-2 flex flex-col gap-0.5 border-t border-line/50 pt-2 text-[10px] text-muted">
                      {u.department && (
                        <span className="flex items-center gap-1">
                          <BuildingOffice2Icon className="h-3 w-3" /> Phòng ban:{" "}
                          <span className="font-semibold text-ink">{u.department}</span>
                        </span>
                      )}
                      {u.manager_name && (
                        <span>Quản lý trực tiếp: <span className="font-semibold text-ink">{u.manager_name}</span></span>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </section>
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
              {/* Thông tin hồ sơ */}
              <div className="space-y-3 rounded-xl2 bg-white p-4 shadow-card">
                <h3 className="text-xs font-bold text-ink uppercase tracking-wider flex items-center gap-1.5 text-steel">
                  <IdentificationIcon className="h-4 w-4" />
                  Thông tin hồ sơ & liên hệ
                </h3>

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

              {/* Phân cấp Quản lý & Vai trò */}
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

                <div>
                  <label className="block text-[11px] font-semibold text-muted">Bộ phận / Phòng ban</label>
                  <input
                    type="text"
                    value={formData.department}
                    onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
                    placeholder="VD: Phòng Thiết kế cầu / Tổ Khảo sát"
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
                  <label className="block text-[11px] font-semibold text-muted">Bộ phận / Phòng ban</label>
                  <input
                    type="text"
                    value={createData.department}
                    onChange={(e) => setCreateData({ ...createData, department: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
                    placeholder="VD: Phòng Thiết kế cầu"
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
    </AppShell>
  );
}
