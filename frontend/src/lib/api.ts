// Lớp gọi API tới backend FastAPI. Tự gắn JWT vào header Authorization.
// Lưu ý: MVP lưu token trong localStorage cho đơn giản. Production nên dùng
// cookie httpOnly + NextAuth để an toàn hơn trước tấn công XSS.

import type { Company, Invoice, KpiSummary, Project, ProjectProfit, User, Bid, Contract, Payment, Progress, ProjectItem, Attendance, AttendanceSummary, Evaluation, Partner, SalaryConfig, Payroll, LeaveRequest, Equipment, EquipmentLog, ActivityLog, FinanceSummary, DebtRow, DesignDocument } from "./types";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000/api/v1";

// Gốc phục vụ file tĩnh (ảnh hóa đơn) từ backend. Production trỏ về domain ERP.
export const ASSET_BASE =
  process.env.NEXT_PUBLIC_ASSET_BASE || "http://localhost:8000";

const TOKEN_KEY = "dylight_token";

export const tokenStore = {
  get: () => (typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

/** Hàm fetch lõi: chèn token, parse JSON, ném lỗi có thông điệp tiếng Việt. */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = tokenStore.get();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (!(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });

  if (res.status === 401) {
    tokenStore.clear();
    if (typeof window !== "undefined") window.location.href = "/login";
    throw new Error("Phiên đăng nhập đã hết hạn.");
  }
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.detail || `Lỗi máy chủ (${res.status}).`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  // --- Auth ---
  async login(email: string, password: string): Promise<string> {
    // Backend dùng OAuth2 password form: trường 'username' = email.
    const form = new URLSearchParams({ username: email, password });
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    });
    if (!res.ok) throw new Error("Email hoặc mật khẩu không đúng.");
    const data = await res.json();
    tokenStore.set(data.access_token);
    return data.access_token;
  },
  async loginWithGoogle(credential: string): Promise<string> {
    // Gửi ID token của Google cho backend xác minh & cấp JWT của hệ thống.
    const res = await fetch(`${API_BASE}/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential }),
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => null);
      throw new Error(detail?.detail || "Đăng nhập Google thất bại.");
    }
    const data = await res.json();
    tokenStore.set(data.access_token);
    return data.access_token;
  },
  me: () => request<User>("/auth/me"),

  // --- Dữ liệu ---
  companies: () => request<Company[]>("/companies"),
  projects: () => request<Project[]>("/projects"),
  kpiSummary: () => request<KpiSummary>("/dashboard/summary"),
  profitByProject: () => request<ProjectProfit[]>("/dashboard/profit"),

  invoices: (status?: string) =>
    request<Invoice[]>(`/invoices${status ? `?status=${status}` : ""}`),

  uploadInvoice: (file: File, projectId?: number) => {
    const fd = new FormData();
    fd.append("file", file);
    if (projectId) fd.append("project_id", String(projectId));
    return request<Invoice>("/invoices/upload", { method: "POST", body: fd });
  },

  verifyInvoice: (id: number) =>
    request<Invoice>(`/invoices/${id}/verify`, { method: "POST" }),

  updateInvoice: (id: number, payload: Partial<Invoice>) =>
    request<Invoice>(`/invoices/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  // --- Bids ---
  bids: () => request<Bid[]>("/bids"),
  getBid: (id: number) => request<Bid>(`/bids/${id}`),
  createBid: (payload: Partial<Bid>) =>
    request<Bid>("/bids", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateBid: (id: number, payload: Partial<Bid>) =>
    request<Bid>(`/bids/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  // --- Projects ---
  getProject: (id: number) => request<Project>(`/projects/${id}`),
  updateProject: (id: number, payload: Partial<Project> & { member_ids?: number[] }) =>
    request<Project>(`/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  createProject: (payload: Partial<Project>) =>
    request<Project>("/projects", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  // --- Contracts ---
  contracts: (projectId?: number) =>
    request<Contract[]>(`/contracts${projectId ? `?project_id=${projectId}` : ""}`),
  createContract: (payload: Partial<Contract>) =>
    request<Contract>("/contracts", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  // --- Payments ---
  payments: (contractId?: number) =>
    request<Payment[]>(`/payments${contractId ? `?contract_id=${contractId}` : ""}`),
  createPayment: (payload: Partial<Payment>) =>
    request<Payment>("/payments", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  // --- Progress ---
  progress: (projectId?: number) =>
    request<Progress[]>(`/progress${projectId ? `?project_id=${projectId}` : ""}`),
  createProgress: (payload: Partial<Progress>) =>
    request<Progress>("/progress", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  // --- Project Items (Hạng mục dự toán / BOQ) ---
  projectItems: (projectId: number) =>
    request<ProjectItem[]>(`/project-items?project_id=${projectId}`),
  createProjectItem: (payload: Partial<ProjectItem> & { project_id: number; name: string }) =>
    request<ProjectItem>("/project-items", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateProjectItem: (id: number, payload: Partial<ProjectItem>) =>
    request<ProjectItem>(`/project-items/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteProjectItem: (id: number) =>
    request<void>(`/project-items/${id}`, { method: "DELETE" }),

  // --- Attendance (Chấm công) ---
  attendanceMe: (fromDate?: string, toDate?: string) => {
    const qs = new URLSearchParams();
    if (fromDate) qs.set("from_date", fromDate);
    if (toDate) qs.set("to_date", toDate);
    const s = qs.toString();
    return request<Attendance[]>(`/attendance/me${s ? `?${s}` : ""}`);
  },
  checkIn: () => request<Attendance>("/attendance/check-in", { method: "POST" }),
  checkOut: () => request<Attendance>("/attendance/check-out", { method: "POST" }),
  attendanceList: (params?: { user_id?: number; work_date?: string }) => {
    const qs = new URLSearchParams();
    if (params?.user_id) qs.set("user_id", String(params.user_id));
    if (params?.work_date) qs.set("work_date", params.work_date);
    const s = qs.toString();
    return request<Attendance[]>(`/attendance${s ? `?${s}` : ""}`);
  },
  attendanceSummary: (period?: string) =>
    request<AttendanceSummary[]>(`/attendance/summary${period ? `?period=${period}` : ""}`),

  // --- Evaluations (Đánh giá) ---
  evaluationsReceived: () => request<Evaluation[]>("/evaluations/received"),
  evaluationsGiven: () => request<Evaluation[]>("/evaluations/given"),
  evaluationsForUser: (evaluateeId: number) =>
    request<Evaluation[]>(`/evaluations?evaluatee_id=${evaluateeId}`),
  createEvaluation: (payload: { period: string; evaluatee_id: number; rating: number; comment?: string | null }) =>
    request<Evaluation>("/evaluations", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  // --- Partners (Đối tác) — chỉ Giám đốc ---
  partners: (type?: string) =>
    request<Partner[]>(`/partners${type ? `?type=${type}` : ""}`),
  createPartner: (payload: Partial<Partner> & { name: string }) =>
    request<Partner>("/partners", { method: "POST", body: JSON.stringify(payload) }),
  updatePartner: (id: number, payload: Partial<Partner>) =>
    request<Partner>(`/partners/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deletePartner: (id: number) =>
    request<void>(`/partners/${id}`, { method: "DELETE" }),

  // --- Payroll (Bảng lương) — chỉ Giám đốc ---
  salaryStaff: () => request<SalaryConfig[]>("/payroll/staff"),
  setSalary: (userId: number, payload: Partial<SalaryConfig>) =>
    request<SalaryConfig>(`/payroll/staff/${userId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  generatePayroll: (period: string) =>
    request<Payroll[]>(`/payroll/generate?period=${period}`, { method: "POST" }),
  payrollList: (period?: string) =>
    request<Payroll[]>(`/payroll${period ? `?period=${period}` : ""}`),

  // --- Tài chính (Giám đốc) ---
  financeSummary: () => request<FinanceSummary>("/finance/summary"),
  debts: () => request<DebtRow[]>("/finance/debts"),

  // --- Audit (Giám đốc) ---
  auditLogs: (limit = 200) => request<ActivityLog[]>(`/audit?limit=${limit}`),

  // --- Nghỉ phép ---
  createLeave: (payload: { from_date: string; to_date: string; reason?: string | null }) =>
    request<LeaveRequest>("/leave", { method: "POST", body: JSON.stringify(payload) }),
  myLeaves: () => request<LeaveRequest[]>("/leave/me"),
  leaveList: (status?: string) => request<LeaveRequest[]>(`/leave${status ? `?status=${status}` : ""}`),
  decideLeave: (id: number, status: "APPROVED" | "REJECTED") =>
    request<LeaveRequest>(`/leave/${id}/decide`, { method: "POST", body: JSON.stringify({ status }) }),

  // --- Thiết bị (Quản lý+) ---
  equipment: () => request<Equipment[]>("/equipment"),
  createEquipment: (payload: Partial<Equipment> & { name: string }) =>
    request<Equipment>("/equipment", { method: "POST", body: JSON.stringify(payload) }),
  updateEquipment: (id: number, payload: Partial<Equipment>) =>
    request<Equipment>(`/equipment/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  equipmentLogs: (equipmentId?: number) =>
    request<EquipmentLog[]>(`/equipment/logs${equipmentId ? `?equipment_id=${equipmentId}` : ""}`),
  createEquipmentLog: (payload: { equipment_id: number; project_id?: number | null; log_date?: string | null; hours_used?: number; fuel?: number; note?: string | null }) =>
    request<EquipmentLog>("/equipment/logs", { method: "POST", body: JSON.stringify(payload) }),

  // --- Đổi mật khẩu ---
  changePassword: (old_password: string, new_password: string) =>
    request<void>("/auth/change-password", { method: "POST", body: JSON.stringify({ old_password, new_password }) }),

  // --- Hồ sơ thiết kế (cầu đường) — xem: mọi người; sửa: Quản lý+ ---
  designDocs: (params?: { project_id?: number; phase?: string; status?: string }) => {
    const qs = new URLSearchParams();
    if (params?.project_id) qs.set("project_id", String(params.project_id));
    if (params?.phase) qs.set("phase", params.phase);
    if (params?.status) qs.set("status", params.status);
    const s = qs.toString();
    return request<DesignDocument[]>(`/design-docs${s ? `?${s}` : ""}`);
  },
  createDesignDoc: (payload: Partial<DesignDocument> & { project_id: number; phase: string; name: string }) =>
    request<DesignDocument>("/design-docs", { method: "POST", body: JSON.stringify(payload) }),
  updateDesignDoc: (id: number, payload: Partial<DesignDocument>) =>
    request<DesignDocument>(`/design-docs/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteDesignDoc: (id: number) =>
    request<void>(`/design-docs/${id}`, { method: "DELETE" }),

  // --- Users ---
  users: () => request<User[]>("/auth/users"),
  createUser: (payload: Partial<User> & { email: string; full_name: string; password?: string }) =>
    request<User>("/auth/users", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateUser: (id: number, payload: Partial<User>) =>
    request<User>(`/auth/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
};

