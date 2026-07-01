// Lớp gọi API tới backend FastAPI. Tự gắn JWT vào header Authorization.
// Lưu ý: MVP lưu token trong localStorage cho đơn giản. Production nên dùng
// cookie httpOnly + NextAuth để an toàn hơn trước tấn công XSS.

import type { Company, Invoice, KpiSummary, Project, ProjectProfit, User, Bid, Contract, Payment, Progress, ProjectItem, Attendance, AttendanceSummary, Evaluation, Partner, SalaryConfig, Payroll, LeaveRequest, Equipment, EquipmentLog, ActivityLog, FinanceSummary, DebtRow, DesignDocument, Notification, Assignment, Colleague, EvaluationSummary, YunattSyncResult, YunattPerson, YunattSyncStatus, Conversation, ChatMessage } from "./types";

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
  addProjectMember: (projectId: number, userId: number) =>
    request<Project>(`/projects/${projectId}/members`, {
      method: "POST",
      body: JSON.stringify({ user_id: userId }),
    }),
  removeProjectMember: (projectId: number, userId: number) =>
    request<Project>(`/projects/${projectId}/members/${userId}`, { method: "DELETE" }),
  setProjectLead: (projectId: number, leadId: number | null) =>
    request<Project>(`/projects/${projectId}/lead`, {
      method: "PUT",
      body: JSON.stringify({ lead_id: leadId }),
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
  updateProgress: (id: number, payload: Partial<Progress>) =>
    request<Progress>(`/progress/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteProgress: (id: number) =>
    request<void>(`/progress/${id}`, { method: "DELETE" }),

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
  attendanceList: (params?: { user_id?: number; work_date?: string; from_date?: string; to_date?: string }) => {
    const qs = new URLSearchParams();
    if (params?.user_id) qs.set("user_id", String(params.user_id));
    if (params?.work_date) qs.set("work_date", params.work_date);
    if (params?.from_date) qs.set("from_date", params.from_date);
    if (params?.to_date) qs.set("to_date", params.to_date);
    const s = qs.toString();
    return request<Attendance[]>(`/attendance${s ? `?${s}` : ""}`);
  },
  attendanceSummary: (period?: string) =>
    request<AttendanceSummary[]>(`/attendance/summary${period ? `?period=${period}` : ""}`),
  importAttendance: (punches: { employee_ref: string; timestamp: string }[]) =>
    request<{ rows: number; matched: number; days_updated: number; days_no_checkout: number; unmatched: string[] }>(
      "/attendance/import",
      { method: "POST", body: JSON.stringify({ punches }) }
    ),
  // Đồng bộ tự động từ Yunatt (backend đăng nhập + kéo dữ liệu). Chạy lâu (~15-30s).
  syncYunatt: () => request<YunattSyncResult>("/attendance/sync-yunatt", { method: "POST" }),
  yunattPersons: () => request<YunattPerson[]>("/attendance/yunatt/persons"),
  yunattStatus: () => request<YunattSyncStatus | null>("/attendance/yunatt/status"),

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
  evaluationsSummary: (period: string) =>
    request<EvaluationSummary[]>(`/evaluations/summary?period=${period}`),
  allEvaluations: (period: string) =>
    request<Evaluation[]>(`/evaluations/all?period=${period}`),

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
  payrollSharing: () => request<{ shared: boolean }>("/payroll/sharing"),
  setPayrollSharing: (shared: boolean) =>
    request<{ shared: boolean }>("/payroll/sharing", { method: "PATCH", body: JSON.stringify({ shared }) }),
  myPayroll: (period?: string) =>
    request<{ shared: boolean; items: Payroll[] }>(`/payroll/me${period ? `?period=${period}` : ""}`),

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
  resetUserPassword: (id: number, new_password: string) =>
    request<void>(`/auth/users/${id}/reset-password`, {
      method: "POST",
      body: JSON.stringify({ new_password }),
    }),

  // --- Thông báo nội bộ ---
  notifications: (limit = 50) => request<Notification[]>(`/notifications/me?limit=${limit}`),
  unreadCount: () => request<{ count: number }>("/notifications/me/unread-count"),
  sendNotification: (payload: { title: string; body?: string | null; target: string; target_user_id?: number | null }) =>
    request<{ sent: number }>("/notifications", { method: "POST", body: JSON.stringify(payload) }),
  markNotificationRead: (id: number) => request<void>(`/notifications/${id}/read`, { method: "POST" }),
  markAllNotificationsRead: () => request<void>("/notifications/me/read-all", { method: "POST" }),

  // --- Giao việc / phân công ---
  assignments: (assigneeId?: number) =>
    request<Assignment[]>(`/assignments${assigneeId ? `?assignee_id=${assigneeId}` : ""}`),
  createAssignment: (payload: { assignee_id: number; title: string; description?: string | null; project_id?: number | null }) =>
    request<Assignment>("/assignments", { method: "POST", body: JSON.stringify(payload) }),
  updateAssignment: (id: number, payload: { status?: string; title?: string; description?: string | null }) =>
    request<Assignment>(`/assignments/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),

  // --- Đồng nghiệp: biệt danh riêng + gom team ---
  colleagues: () => request<Colleague[]>("/colleagues"),
  nicknameMap: () => request<Record<string, string>>("/colleagues/nicknames"),
  setNickname: (userId: number, nickname: string | null) =>
    request<Colleague>(`/colleagues/${userId}/nickname`, { method: "PUT", body: JSON.stringify({ nickname }) }),
  addToTeam: (userId: number) => request<Colleague>(`/colleagues/${userId}/team`, { method: "POST" }),
  removeFromTeam: (userId: number) => request<Colleague>(`/colleagues/${userId}/team`, { method: "DELETE" }),

  // --- Chat (nhắn tin nội bộ) ---
  chatConversations: () => request<Conversation[]>("/chat/conversations"),
  chatUnreadCount: () => request<{ count: number }>("/chat/unread-count"),
  createConversation: (payload: { type: string; member_ids: number[]; title?: string | null }) =>
    request<Conversation>("/chat/conversations", { method: "POST", body: JSON.stringify(payload) }),
  chatMessages: (id: number, before?: number) =>
    request<ChatMessage[]>(`/chat/conversations/${id}/messages${before ? `?before=${before}` : ""}`),
  sendChatMessage: (id: number, body: string) =>
    request<ChatMessage>(`/chat/conversations/${id}/messages`, { method: "POST", body: JSON.stringify({ body }) }),
  markConversationRead: (id: number) =>
    request<void>(`/chat/conversations/${id}/read`, { method: "POST" }),
  projectConversation: (projectId: number) =>
    request<Conversation>(`/chat/project/${projectId}`),
  reactToMessage: (messageId: number, emoji: string) =>
    request<ChatMessage>(`/chat/messages/${messageId}/reaction`, {
      method: "PUT",
      body: JSON.stringify({ emoji }),
    }),
  removeReaction: (messageId: number) =>
    request<ChatMessage>(`/chat/messages/${messageId}/reaction`, { method: "DELETE" }),
  renameConversation: (id: number, title: string) =>
    request<Conversation>(`/chat/conversations/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),
  addConversationMembers: (id: number, memberIds: number[]) =>
    request<Conversation>(`/chat/conversations/${id}/members`, {
      method: "POST",
      body: JSON.stringify({ member_ids: memberIds }),
    }),
  removeConversationMember: (id: number, userId: number) =>
    request<void>(`/chat/conversations/${id}/members/${userId}`, { method: "DELETE" }),
};

