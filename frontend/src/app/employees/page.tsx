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
} from "@heroicons/react/24/outline";
import AppShell from "@/components/app-shell";
import { api } from "@/lib/api";
import { ROLE_LABEL } from "@/lib/roles";
import type { User, Role } from "@/lib/types";

export default function EmployeesPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
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
    manager_id: "",
  };
  const [showCreate, setShowCreate] = useState(false);
  const [createData, setCreateData] = useState(emptyCreate);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  useEffect(() => {
    // 1. Get current logged in user to check permission
    api.me()
      .then((me) => {
        setCurrentUser(me);
        if (me.role === "FIELD_STAFF") {
          setLoading(false);
          return;
        }
        // 2. Fetch all company users
        api.users()
          .then((data) => {
            setUsers(data);
            setLoading(false);
          })
          .catch(() => setLoading(false));
      })
      .catch(() => {
        router.push("/login");
      });
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
      });
      setSuccessMsg("");
      setErrorMsg("");
    }
  }, [selectedUser]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-steel border-t-amber" />
      </div>
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

  const filteredUsers = users.filter((u) =>
    u.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedUser) return;
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
            {users.length} thành viên
          </span>
        </section>

        {/* Quy tắc cấp quyền truy cập web */}
        <section className="flex items-start gap-2 rounded-xl2 border border-line bg-white p-3 text-[11px] text-muted shadow-card">
          <ShieldCheckIcon className="h-4 w-4 shrink-0 text-steel" />
          <p>
            Người dùng đăng nhập bằng <span className="font-semibold text-ink">tài khoản Google cá nhân</span>.{" "}
            {canManage
              ? "Bạn (Quản trị web / Giám đốc) có thể thêm người mới bằng email Gmail của họ, đổi vai trò, hoặc khóa quyền truy cập."
              : "Chỉ Giám đốc & Quản trị web mới được thêm/sửa người được truy cập."}
          </p>
        </section>

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
                  onClick={() => canManage && setSelectedUser(u)}
                  className={`rounded-xl2 bg-white p-4 shadow-card transition-all border-l-4 ${canManage ? "cursor-pointer" : ""} ${
                    isSelected ? "border-amber bg-amber/5" : "border-transparent hover:border-slate-300"
                  } ${u.is_active ? "" : "opacity-60"}`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-ink">{u.full_name}</h3>
                      <p className="text-[11px] text-muted font-mono mt-0.5">{u.email}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="text-[11px] font-medium text-steel">
                          {ROLE_LABEL[u.role] || u.role}
                        </span>
                        <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${u.is_active ? "bg-ok/10 text-ok" : "bg-bad/10 text-bad"}`}>
                          {u.is_active ? "Đang truy cập" : "Đã khóa"}
                        </span>
                      </div>
                    </div>
                    {canManage && (
                      <span className="rounded-md bg-paper p-1.5 text-muted hover:text-ink">
                        <PencilSquareIcon className="h-4 w-4" />
                      </span>
                    )}
                  </div>
                  {u.manager_name && (
                    <div className="mt-2 border-t border-line/50 pt-2 text-[10px] text-muted flex items-center gap-1">
                      <span>Quản lý trực tiếp:</span>
                      <span className="font-semibold text-ink">{u.manager_name}</span>
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
                <h2 className="text-sm font-bold text-ink">{selectedUser.full_name}</h2>
                <p className="text-[11px] text-muted">{ROLE_LABEL[selectedUser.role]}</p>
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
                  <label className="block text-[11px] font-semibold text-muted">Email Google (Gmail) *</label>
                  <input
                    type="email"
                    required
                    value={createData.email}
                    onChange={(e) => setCreateData({ ...createData, email: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
                    placeholder="ten@gmail.com"
                  />
                  <p className="mt-1 text-[10px] text-muted">
                    Nhập đúng địa chỉ Gmail người này dùng để đăng nhập. Chỉ email đã thêm ở đây mới vào được web.
                  </p>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-muted">Mật khẩu (tùy chọn)</label>
                  <input
                    type="text"
                    minLength={6}
                    value={createData.password}
                    onChange={(e) => setCreateData({ ...createData, password: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
                    placeholder="Để trống nếu chỉ đăng nhập bằng Google"
                  />
                  <p className="mt-1 text-[10px] text-muted">
                    Bỏ trống ⇒ tài khoản chỉ đăng nhập bằng Google. Nhập (≥6 ký tự) nếu muốn cấp thêm đăng nhập bằng mật khẩu.
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
