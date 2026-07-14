// Kiểu dữ liệu phản chiếu schema của backend (giữ đồng bộ với app/schemas.py).

export type Role = "ADMIN" | "DIRECTOR" | "MANAGER" | "ACCOUNTANT" | "FIELD_STAFF";

export interface User {
  id: number;
  company_id: number;
  email: string;
  full_name: string;
  role: Role;
  is_active: boolean;
  is_approved: boolean;
  phone?: string | null;
  address?: string | null;
  dob?: string | null;
  identity_card?: string | null;
  cv_details?: string | null;
  schedule?: string | null;
  department?: string | null;
  manager_id?: number | null;
  manager_name?: string | null;
  yunatt_code?: string | null;   // mã nhân viên trên máy chấm công Yunatt
  work_start?: string | null;    // giờ làm cơ sở "HH:MM" (đánh giá đi muộn)
  work_end?: string | null;      // giờ ra cơ sở "HH:MM"
  has_subordinates?: boolean;    // BE tính: người này có ≥1 cấp dưới trực tiếp
}

export interface Company {
  id: number;
  name: string;
  code: string;
  tax_code?: string | null;
  is_active: boolean;
}

export interface KpiSummary {
  active_contracts: number;
  total_contract_value: number;
  total_invoice_cost: number;
  total_collected: number;
  estimated_profit: number;
  pending_invoices: number;
}

export interface ProjectProfit {
  project_id: number;
  project_name: string;
  contract_value: number;
  cost: number;
  profit: number;
  margin_percent: number;
}

export type ProjectStatus =
  | "PLANNING" | "IN_PROGRESS" | "ON_HOLD" | "COMPLETED" | "CLOSED";

export interface Project {
  id: number;
  company_id: number;
  bid_id?: number | null;
  code: string;                       // 管理番号 (mã quản lý)
  name: string;                       // プロジェクト名
  group_name?: string | null;         // グループ (nhóm)
  geo_manager?: string | null;        // GEO担当 (tên, text)
  dosco_manager?: string | null;      // DOSCO担当 (tên, text)
  location?: string | null;
  manager_name?: string | null;
  lead_id?: number | null;
  lead_name?: string | null;
  status: ProjectStatus;
  start_date?: string | null;
  end_date?: string | null;
  internal_deadline?: string | null;
  evaluation?: string | null;
  created_at: string;
  members?: User[];
  progress_percent?: number; // % tiến độ THỰC (trung bình các mốc), do BE tính
}

export type InvoiceStatus =
  | "PENDING" | "PROCESSING" | "EXTRACTED" | "VERIFIED" | "REJECTED";

export interface Invoice {
  id: number;
  company_id: number;
  project_id?: number | null;
  contract_id?: number | null;
  image_url?: string | null;
  original_filename?: string | null;
  supplier_name?: string | null;
  supplier_tax_code?: string | null;
  invoice_number?: string | null;
  invoice_date?: string | null;
  amount_no_vat: number;
  vat_amount: number;
  total_amount: number;
  category?: string | null;
  ocr_confidence?: number | null;
  status: InvoiceStatus;
  created_at: string;
}

export type BidStatus = "DRAFT" | "SUBMITTED" | "WON" | "LOST" | "CANCELLED";

export interface Bid {
  id: number;
  company_id: number;
  code: string;
  name: string;
  investor?: string | null;
  package_value: number | null;   // null khi bị ẩn (chỉ Giám đốc thấy giá gói thầu)
  status: BidStatus;
  submit_date?: string | null;
  result_date?: string | null;
  note?: string | null;
  created_at: string;
}

export type ContractStatus = "DRAFT" | "ACTIVE" | "COMPLETED" | "LIQUIDATED";

export interface Contract {
  id: number;
  company_id: number;
  project_id: number;
  code: string;
  name: string;
  partner?: string | null;
  value_no_vat: number;
  vat_percent: number;
  status: ContractStatus;
  sign_date?: string | null;
  created_at: string;
}

export type PaymentType = "ADVANCE" | "PROGRESS" | "FINAL";
export type PaymentDirection = "IN" | "OUT";

export interface Payment {
  id: number;
  company_id: number;
  contract_id: number;
  code?: string | null;
  payment_type: PaymentType;
  direction: PaymentDirection;
  amount: number;
  payment_date?: string | null;
  note?: string | null;
  created_at: string;
}

export interface Progress {
  id: number;
  company_id: number;
  project_id: number;
  title: string;
  percent_complete: number;
  planned_date?: string | null;
  actual_date?: string | null;
  note?: string | null;
  created_at: string;
}

// Chấm công (attendance) — 1 bản ghi / người / ngày.
export type AttendanceSource = "MANUAL" | "MACHINE" | "API";

export interface Attendance {
  id: number;
  company_id: number;
  user_id: number;
  work_date: string;          // "YYYY-MM-DD"
  check_in?: string | null;   // ISO datetime
  check_out?: string | null;  // ISO datetime
  source: AttendanceSource;
  device_id?: string | null;
  note?: string | null;
  worked_minutes: number;
  is_late: boolean;
  created_at: string;
  user_name?: string | null;
}

export interface AttendanceSummary {
  user_id: number;
  full_name: string;
  present_days: number;
  late_days: number;
  total_hours: number;
}

// Đồng bộ tự động từ Yunatt (máy chấm công cloud).
export interface YunattUnmatched {
  staff_number: string;
  staff_name?: string | null;
}
export interface YunattSyncResult {
  months: string[];
  rows: number;
  matched: number;
  days_updated: number;
  days_no_checkout: number;
  unmatched: YunattUnmatched[];
}
export interface YunattPerson {
  staff_number: string;
  staff_name?: string | null;
  user_id?: number | null;     // nhân viên ERP đã map (nếu có)
  user_name?: string | null;
}
// Trạng thái lần đồng bộ Yunatt gần nhất (theo dõi job tự động 20:00).
export interface YunattSyncStatus {
  ran_at: string;              // ISO datetime
  ok: boolean;
  trigger: "auto" | "manual";
  months?: string | null;
  rows: number;
  matched: number;
  days_updated: number;
  days_no_checkout: number;
  unmatched_count: number;
  message?: string | null;     // nội dung lỗi nếu ok=false
}

// Đánh giá 2 chiều nhân viên <-> quản lý trực tiếp.
export type EvaluationDirection = "STAFF_TO_MANAGER" | "MANAGER_TO_STAFF";

export interface Evaluation {
  id: number;
  company_id: number;
  period: string;             // tuần = ngày Thứ 7 "YYYY-MM-DD" (tự suy từ eval_date)
  eval_date?: string | null;  // ngày chấm "YYYY-MM-DD"
  project_id?: number | null; // dự án (tùy chọn)
  project_name?: string | null;
  evaluator_id: number;
  evaluatee_id: number;
  direction: EvaluationDirection;
  rating: number;             // 1-5
  comment?: string | null;
  created_at: string;
  evaluator_name?: string | null;
  evaluatee_name?: string | null;
}

// Đánh giá CHÉO 360° theo DỰ ÁN — các thành viên chấm lẫn nhau (1 phiếu/người/dự án).
export interface ProjectEvaluation {
  id: number;
  project_id: number;
  evaluator_id: number;         // = 0 khi phiếu "về mình" đã ẩn danh người chấm
  evaluatee_id: number;
  rating: number;               // 1-5
  comment?: string | null;
  created_at: string;
  evaluator_name?: string | null;
  evaluatee_name?: string | null;
}

export interface ProjectEvalParticipant {
  user_id: number;
  full_name: string;
  role: Role;
  department?: string | null;
  is_lead: boolean;
}

export interface ProjectEvalSummaryRow {
  user_id: number;
  full_name: string;
  avg_rating: number;
  num_ratings: number;
}

export interface ProjectEvaluationView {
  project_id: number;
  can_manage: boolean;                     // chủ trì/Giám đốc -> thấy tổng hợp cả nhóm
  participants: ProjectEvalParticipant[];
  given: ProjectEvaluation[];              // phiếu MÌNH đã chấm (prefill form)
  received: ProjectEvaluation[];           // phiếu VỀ MÌNH (đã ẩn danh người chấm)
  my_avg?: number | null;
  my_count: number;
  summary: ProjectEvalSummaryRow[];        // chỉ khi can_manage
  all_evaluations: ProjectEvaluation[];    // chỉ khi can_manage — từng phiếu, có tên
}

// Đối tác (Partner) — Chủ đầu tư / Nhà cung cấp / Nhà thầu phụ.
export type PartnerType = "INVESTOR" | "SUPPLIER" | "SUBCONTRACTOR";

export interface Partner {
  id: number;
  company_id: number;
  type: PartnerType;
  name: string;
  tax_code?: string | null;
  contact_person?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  note?: string | null;
  is_active: boolean;
  created_at: string;
}

// Phòng ban (danh mục do Admin/Giám đốc quản lý).
export interface Department {
  id: number;
  name: string;
  order_index: number;
}

// Bảng lương (Payroll).
export type SalaryType = "MONTHLY" | "DAILY";

export interface SalaryConfig {
  id: number;            // = user id
  full_name: string;
  base_salary: number;
  salary_type: SalaryType;
  allowance: number;
  num_dependents: number;
}

export interface Payroll {
  id: number;
  company_id: number;
  user_id: number;
  period: string;        // "YYYY-MM"
  working_days: number;
  base_amount: number;
  allowance: number;
  gross: number;
  insurance: number;
  personal_income_tax: number;
  net: number;
  note?: string | null;
  created_at: string;
  user_name?: string | null;
}

// Nghỉ phép
export type LeaveStatus = "PENDING" | "APPROVED" | "REJECTED";
export interface LeaveRequest {
  id: number; company_id: number; user_id: number;
  from_date: string; to_date: string; reason?: string | null;
  status: LeaveStatus; decided_by_id?: number | null; decided_at?: string | null;
  created_at: string; user_name?: string | null; days: number;
}

// Thiết bị
export interface Equipment {
  id: number; company_id: number; code?: string | null; name: string;
  status: string; note?: string | null; created_at: string;
}
export interface EquipmentLog {
  id: number; company_id: number; equipment_id: number; project_id?: number | null;
  log_date?: string | null; hours_used: number; fuel: number; note?: string | null;
  created_at: string; equipment_name?: string | null; project_name?: string | null;
}

// Nhật ký hoạt động (audit)
export interface ActivityLog {
  id: number; company_id: number; user_id?: number | null; action: string;
  entity_type?: string | null; entity_id?: number | null; detail?: string | null;
  created_at: string; user_name?: string | null;
}

// Tài chính
export interface FinanceSummary {
  total_in: number; total_out: number; balance: number;
  total_contract_value: number; total_cost: number;
}
export interface DebtRow {
  contract_id: number; contract_code: string; project_name?: string | null;
  partner?: string | null; contract_value: number; collected: number;
  remaining: number; collect_percent: number;
}

// Hồ sơ thiết kế (đặc thù cty thiết kế cầu đường)
export type DesignPhase = "SURVEY" | "BASIC" | "TECHNICAL" | "SHOP";
export type DesignDocStatus = "DRAFT" | "SUBMITTED" | "REVIEWING" | "APPROVED" | "REVISE";
export interface DesignDocument {
  id: number; company_id: number; project_id: number;
  phase: DesignPhase; code?: string | null; name: string;
  discipline?: string | null; version?: string | null; status: DesignDocStatus;
  file_url?: string | null; note?: string | null;
  created_at: string; project_name?: string | null; created_by_name?: string | null;
}

// Hạng mục dự toán (BOQ) — mô hình 2 cấp: nhóm cha (parent_id=null) + đầu việc con.
export interface ProjectItem {
  id: number;
  company_id: number;
  project_id: number;
  parent_id: number | null;
  order_index: number;
  code?: string | null;
  name: string;
  unit?: string | null;
  quantity: number;
  unit_price: number;
  amount: number;          // thành tiền = khối lượng × đơn giá (đầu việc con)
  progress: number;        // % hoàn thành đầu việc (0..100) — dùng tính tiến độ dự án
  department?: string | null;  // phòng ban phụ trách (gán ở cấp nhóm cha)
  note?: string | null;
  created_at: string;
}

// Tiến độ theo ngày — 1 điểm = (ngày, phòng ban, %). department "" = toàn dự án.
export interface ProgressPoint {
  date: string;        // "YYYY-MM-DD"
  department: string;  // "" = toàn dự án
  percent: number;
}
export interface ProgressHistory {
  project_id: number;
  snapshots: ProgressPoint[];
}

// Thông báo nội bộ
export interface Notification {
  id: number;
  sender_id?: number | null;
  sender_name?: string | null;
  title: string;
  body?: string | null;
  is_read: boolean;
  created_at: string;
}

// Giao việc / phân công
export interface Assignment {
  id: number;
  company_id: number;
  assigner_id: number;
  assigner_name?: string | null;
  assignee_id: number;
  assignee_name?: string | null;
  project_id?: number | null;
  project_name?: string | null;
  title: string;
  description?: string | null;
  status: string;
  started_at?: string | null;   // BE tự đóng dấu khi bắt đầu làm
  done_at?: string | null;      // BE tự đóng dấu khi hoàn thành
  created_at: string;
}

// Đồng nghiệp (danh bạ) + biệt danh riêng tư của mình
export interface Colleague {
  id: number;
  full_name: string;
  role: Role;
  department?: string | null;
  manager_id?: number | null;
  manager_name?: string | null;
  my_nickname?: string | null;
  in_my_team: boolean;
  has_subordinates?: boolean;    // BE tính: người này có ≥1 cấp dưới trực tiếp
}

// Tổng hợp điểm đánh giá 1 người nhận trong kỳ (cho Giám đốc)
export interface EvaluationSummary {
  user_id: number;
  full_name: string;
  role: Role;
  avg_rating: number;
  num_ratings: number;
}

// Chat nội bộ — hội thoại 1-1 (DIRECT) và nhóm tự tạo (GROUP).
export type ConversationType = "DIRECT" | "GROUP";

export interface ChatMember {
  user_id: number;
  user_name?: string | null;
}

export interface Conversation {
  id: number;
  type: ConversationType;
  title?: string | null;          // DIRECT: FE hiển thị tên người kia
  project_id?: number | null;     // != null => nhóm chat gắn dự án
  members: ChatMember[];
  last_message?: string | null;   // preview tin cuối
  last_message_at?: string | null;
  unread: number;                 // số tin chưa đọc của mình
  created_at: string;
}

export interface ReactionAgg {
  emoji: string;
  count: number;
  mine: boolean;
}

export interface ChatMessage {
  id: number;
  conversation_id: number;
  sender_id: number;
  sender_name?: string | null;
  body: string;
  created_at: string;
  reactions?: ReactionAgg[];
}

