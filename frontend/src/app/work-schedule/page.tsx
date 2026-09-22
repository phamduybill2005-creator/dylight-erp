"use client";

// Trang Lịch làm việc (Work Schedule)
// - Hiển thị 5 kiểu trạng thái nghỉ/đi muộn theo đơn nghỉ phép ĐÃ ĐƯỢC DUYỆT:
//   1. Đi muộn sáng (Xanh biển: #0284c7)
//   2. Đi muộn chiều (Xanh ngọc: #0d9488)
//   3. Nghỉ sáng (Vàng hổ phách ấm: #d97706)
//   4. Nghỉ chiều (Tím thạch anh: #7c3aed)
//   5. Nghỉ cả ngày (Đỏ hoa hồng trầm: #e11d48)
// - Ngày không có đơn: bảng trắng sạch sẽ.
// - Chế độ Tháng: giữ cột ngày đủ rộng và cho phép cuộn ngang trên màn hình nhỏ.
// - Chế độ Tuần: 7 ngày rộng rãi, thoáng đãng.
// - Chỉ hiển thị nhân viên đang làm việc.

import { useEffect, useMemo, useState } from "react";
import { useStickyState } from "@/lib/use-sticky-state";
import { useRouter } from "next/navigation";
import {
  CalendarDaysIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MagnifyingGlassIcon,
  ArrowDownTrayIcon,
  XMarkIcon,
  FunnelIcon,
  CheckCircleIcon,
  TrashIcon,
  AcademicCapIcon,
} from "@heroicons/react/24/outline";
import * as XLSX from "xlsx";
import AppShell from "@/components/app-shell";
import { splitDepts } from "@/components/filter-bar";
import { PRESET_DEPARTMENTS } from "@/lib/departments";
import { normalizeDept } from "@/lib/groups";
import StudentScheduleModal from "@/components/student-schedule-modal";
import { api } from "@/lib/api";
import { isManagerUp } from "@/lib/roles";
import { getApprovedLeavesForDate, resolveLatestApprovedLeave } from "@/lib/schedule-helpers";
import { dateLocal, formatDate, todayLocal } from "@/lib/format";
import type { LeaveRequest, User } from "@/lib/types";

// 5 kiểu hiển thị chuẩn theo yêu cầu: 5 họ màu riêng biệt, không chói mắt, độ tương phản cao dễ nhìn chữ
export interface ScheduleType {
  key: string;
  label: string;
  bgClass: string;
  textClass: string;
  borderClass: string;
  hexColor: string;
}

const SCHEDULE_TYPES: ScheduleType[] = [
  {
    key: "LATE_MORNING",
    label: "Đi muộn sáng",
    bgClass: "bg-[#0284c7]", // Xanh biển dịu mát
    textClass: "text-white font-bold",
    borderClass: "border-[#0369a1]",
    hexColor: "#0284c7",
  },
  {
    key: "LATE_AFTERNOON",
    label: "Đi muộn chiều",
    bgClass: "bg-[#0d9488]", // Xanh ngọc lục bảo sâu
    textClass: "text-white font-bold",
    borderClass: "border-[#0f766e]",
    hexColor: "#0d9488",
  },
  {
    key: "MORNING",
    label: "Nghỉ sáng",
    bgClass: "bg-[#d97706]", // Vàng hổ phách mật ong ấm (không chói lóa)
    textClass: "text-white font-bold",
    borderClass: "border-[#b45309]",
    hexColor: "#d97706",
  },
  {
    key: "AFTERNOON",
    label: "Nghỉ chiều",
    bgClass: "bg-[#7c3aed]", // Tím thạch anh hoàng hôn sang trọng
    textClass: "text-white font-bold",
    borderClass: "border-[#6d28d9]",
    hexColor: "#7c3aed",
  },
  {
    key: "FULL",
    label: "Nghỉ cả ngày",
    bgClass: "bg-[#e11d48]", // Đỏ hoa hồng trầm thanh lịch
    textClass: "text-white font-bold",
    borderClass: "border-[#be123c]",
    hexColor: "#e11d48",
  },
];

// Ánh xạ phân loại đơn nghỉ phép sang 1 trong 5 kiểu
function getScheduleType(leaveType?: string | null): ScheduleType {
  if (!leaveType) return SCHEDULE_TYPES[4]; // Mặc định FULL (Nghỉ cả ngày)
  const t = leaveType.toUpperCase();
  if (t === "LATE_MORNING" || t === "LATE") return SCHEDULE_TYPES[0]; // Đi muộn sáng
  if (t === "LATE_AFTERNOON") return SCHEDULE_TYPES[1]; // Đi muộn chiều
  if (t === "MORNING") return SCHEDULE_TYPES[2]; // Nghỉ sáng
  if (t === "AFTERNOON") return SCHEDULE_TYPES[3]; // Nghỉ chiều
  return SCHEDULE_TYPES[4]; // Nghỉ cả ngày
}

// Tên các thứ trong tuần tiếng Việt
const DAY_NAMES_VI = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const FULL_DAY_NAMES_VI = [
  "Chủ nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"
];

// Helper tính ngày đầu tuần (Thứ 2)
function getMonday(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(date.setDate(diff));
}

// Helper lấy số thứ tự tuần trong năm
function getWeekNumber(d: Date): number {
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
  }
  return 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
}

// Rút gọn tên nhân viên để hiển thị vừa vặn trong cột không bị vỡ layout
function formatShortName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) return fullName.toUpperCase();
  if (parts.length === 2) return `${parts[0][0]}.${parts[1]}`.toUpperCase();
  const initials = parts.slice(0, -1).map((p) => p[0].toUpperCase()).join(".");
  return `${initials}.${parts[parts.length - 1].toUpperCase()}`;
}

export default function WorkSchedulePage() {
  const router = useRouter();
  const [me, setMe] = useState<User | null>(api.cachedUser());
  const [users, setUsers] = useState<User[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);

  // Chế độ xem: "MONTH" (Theo tháng) hoặc "WEEK" (Theo tuần)
  const [viewMode, setViewMode] = useStickyState<"MONTH" | "WEEK">("schedule.viewMode", "MONTH");

  // Thời gian đang chọn — NHỚ qua F5: sessionStorage chỉ giữ chuỗi nên lưu "YYYY-MM-DD",
  // trong trang vẫn dùng Date như cũ (setCurrentDate nhận Date).
  const today = todayLocal();
  const [currentDateStr, setCurrentDateStr] = useStickyState("schedule.date", today);
  const currentDate = useMemo(() => {
    const [y, m, d] = currentDateStr.split("-").map(Number);
    return new Date(y, m - 1, d);
  }, [currentDateStr]);
  const setCurrentDate = (d: Date) => setCurrentDateStr(dateLocal(d));

  // Bộ lọc
  const [deptFilter, setDeptFilter] = useStickyState("schedule.dept", "");
  const [searchTerm, setSearchTerm] = useStickyState("schedule.search", "");

  // Modal chi tiết khi click vào ô bất kỳ
  const [selectedCell, setSelectedCell] = useState<{
    user: User;
    dateStr: string;
    dayNum: number;
    dayOfWeek: number;
    leave?: LeaveRequest;
    allLeaves?: LeaveRequest[];
  } | null>(null);

  // Ghi chú tạm thời cho các ô
  const [cellNotes, setCellNotes] = useState<Record<string, string>>({});
  const [noteInput, setNoteInput] = useState("");
  const [expandedMobileUser, setExpandedMobileUser] = useState<number | null>(null);

  // Modal Đăng ký lịch sinh viên
  const [studentModalOpen, setStudentModalOpen] = useState(false);
  const [modalStudentUserId, setModalStudentUserId] = useState<number | undefined>();
  const [modalStudentDate, setModalStudentDate] = useState<Date | undefined>();

  // Nạp danh sách nhân sự (CHỈ NHÂN VIÊN ĐANG LÀM VIỆC)
  useEffect(() => {
    api.me()
      .then((u) => {
        setMe(u);
        return api.users();
      })
      .then((userList) => {
        // Lọc bỏ nhân viên cũ: chỉ lấy người đang hoạt động và đã duyệt
        const activeUsers = userList.filter((u) => u.is_active !== false && u.is_approved !== false);
        const sorted = [...activeUsers].sort((a, b) => {
          const roleOrder: Record<string, number> = {
            DIRECTOR: 1,
            MANAGER: 2,
            ENGINEER: 4,
            STAFF: 5,
          };
          const rA = roleOrder[a.role] || 99;
          const rB = roleOrder[b.role] || 99;
          if (rA !== rB) return rA - rB;
          return a.full_name.localeCompare(b.full_name, "vi");
        });
        setUsers(sorted);
      })
      .catch(() => router.push("/login"))
      .finally(() => setLoading(false));
  }, [router]);

  // Tính toán danh sách ngày theo chế độ xem
  const { dateRange, daysList, periodLabel } = useMemo(() => {
    if (viewMode === "MONTH") {
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth();
      const lastDay = new Date(year, month + 1, 0).getDate();
      const list: { date: Date; dateStr: string; dayNum: number; dayOfWeek: number }[] = [];

      for (let day = 1; day <= lastDay; day++) {
        const d = new Date(year, month, day);
        list.push({
          date: d,
          dateStr: dateLocal(d),
          dayNum: day,
          dayOfWeek: d.getDay(),
        });
      }

      const mStr = `${year}-${String(month + 1).padStart(2, "0")}`;
      const fDate = `${mStr}-01`;
      const tDate = `${mStr}-${String(lastDay).padStart(2, "0")}`;
      const label = `Tháng ${month + 1}/${year}`;

      return {
        dateRange: { from_date: fDate, to_date: tDate, month: mStr },
        daysList: list,
        periodLabel: label,
      };
    } else {
      // Chế độ Tuần: 7 ngày Thứ 2 -> Chủ nhật
      const monday = getMonday(currentDate);
      const list: { date: Date; dateStr: string; dayNum: number; dayOfWeek: number }[] = [];

      for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        list.push({
          date: d,
          dateStr: dateLocal(d),
          dayNum: d.getDate(),
          dayOfWeek: d.getDay(),
        });
      }

      const fDate = list[0].dateStr;
      const tDate = list[6].dateStr;
      const weekNum = getWeekNumber(monday);
      const label = `Tuần ${weekNum} (${formatDate(fDate)} - ${formatDate(tDate)})`;

      return {
        dateRange: { from_date: fDate, to_date: tDate },
        daysList: list,
        periodLabel: label,
      };
    }
  }, [viewMode, currentDate]);

  // Nạp danh sách đơn nghỉ phép trong kỳ: CHỈ LẤY ĐƠN ĐÃ ĐƯỢC DUYỆT (APPROVED) TỪ THÁNG 9/2026 TRỞ ĐI
  const loadLeaves = () => {
    if (dateRange.to_date < "2026-09-01") {
      setLeaves([]);
      return;
    }

    const effectiveFrom = dateRange.from_date < "2026-09-01" ? "2026-09-01" : dateRange.from_date;

    api.leaveSchedule({
      from_date: effectiveFrom,
      to_date: dateRange.to_date,
      month: dateRange.month,
      status: "APPROVED",
    })
      .then((data) => {
        setLeaves(data.filter((l) => l.status === "APPROVED" && l.from_date >= "2026-09-01"));
      })
      .catch((err) => {
        console.error("Lỗi khi tải lịch nghỉ:", err);
      });
  };

  useEffect(() => {
    loadLeaves();
  }, [dateRange]);

  // Điều hướng thời gian
  const prevPeriod = () => {
    const d = new Date(currentDate);
    if (viewMode === "MONTH") {
      d.setMonth(d.getMonth() - 1);
    } else {
      d.setDate(d.getDate() - 7);
    }
    setCurrentDate(d);
  };

  const nextPeriod = () => {
    const d = new Date(currentDate);
    if (viewMode === "MONTH") {
      d.setMonth(d.getMonth() + 1);
    } else {
      d.setDate(d.getDate() + 7);
    }
    setCurrentDate(d);
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  // Tra cứu danh sách đơn nghỉ ĐÃ DUYỆT của 1 nhân viên trong 1 ngày (được duyệt sau cùng đứng đầu)
  const getApprovedLeaves = (userId: number, dateStr: string): LeaveRequest[] => {
    return getApprovedLeavesForDate(leaves, userId, dateStr);
  };

  // Tra cứu đơn nghỉ ĐÃ DUYỆT sau cùng của 1 nhân viên trong 1 ngày cụ thể (chỉ từ tháng 9/2026)
  const getApprovedLeave = (userId: number, dateStr: string): LeaveRequest | undefined => {
    return resolveLatestApprovedLeave(leaves, userId, dateStr);
  };

  // Danh sách phòng ban: DÙNG 4 PHÒNG CHUẨN như các mục khác. Trước đây lấy
  // nguyên chuỗi department của từng người, nên ai thuộc 2 phòng ("Phòng BIM,
  // Phòng Thiết kế đường 2D") là chuỗi ghép đó thành một mục riêng -> danh sách
  // phình ra cả chục dòng trùng lặp.
  const departments = PRESET_DEPARTMENTS;

  // Lọc danh sách nhân viên: CHỈ LẤY NHÂN VIÊN ĐANG LÀM VIỆC
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      // Tách chuỗi + chuẩn hoá tên (kể cả tên tiếng Nhật) -> người thuộc
      // nhiều phòng được tính ở TỪNG phòng, giống bộ lọc các trang khác.
      if (deptFilter && !splitDepts(u.department).map(normalizeDept).includes(deptFilter)) return false;
      if (searchTerm) {
        const query = searchTerm.toLowerCase();
        const matchName = u.full_name.toLowerCase().includes(query);
        const matchDept = (u.department || "").toLowerCase().includes(query);
        if (!matchName && !matchDept) return false;
      }
      return true;
    });
  }, [users, deptFilter, searchTerm]);

  // Lưu ghi chú ô
  const handleSaveNote = () => {
    if (!selectedCell) return;
    const key = `${selectedCell.user.id}_${selectedCell.dateStr}`;
    setCellNotes((prev) => ({
      ...prev,
      [key]: noteInput.trim(),
    }));
    setSelectedCell(null);
    setNoteInput("");
  };

  // Xóa đơn nghỉ phép (nếu tạo nhầm hoặc test)
  const [deletingLeave, setDeletingLeave] = useState(false);
  const handleDeleteLeave = async (leaveId: number) => {
    if (!window.confirm("Bạn có chắc chắn muốn xóa đơn nghỉ phép này không?")) return;
    setDeletingLeave(true);
    try {
      await api.deleteLeave(leaveId);
      setLeaves((prev) => {
        const next = prev.filter((l) => l.id !== leaveId);
        if (selectedCell) {
          const remaining = getApprovedLeavesForDate(next, selectedCell.user.id, selectedCell.dateStr);
          if (remaining.length > 0) {
            setSelectedCell({
              ...selectedCell,
              leave: remaining[0],
              allLeaves: remaining,
            });
          } else {
            setSelectedCell(null);
          }
        }
        return next;
      });
    } catch (e: any) {
      alert(e?.message || "Không thể xóa đơn nghỉ này.");
    } finally {
      setDeletingLeave(false);
    }
  };

  // Xuất file Excel bảng lịch làm việc
  const exportToExcel = () => {
    try {
      const headerRow = ["STT", "Họ và tên", "Phòng ban"];
      daysList.forEach((d) => {
        const dName = DAY_NAMES_VI[d.dayOfWeek];
        headerRow.push(`${d.dayNum} (${dName})`);
      });

      const dataRows = filteredUsers.map((u, idx) => {
        const row: (string | number)[] = [idx + 1, u.full_name, u.department || "—"];
        daysList.forEach((d) => {
          const l = getApprovedLeave(u.id, d.dateStr);
          if (l) {
            const type = getScheduleType(l.leave_type);
            row.push(l.reason ? `${l.reason.toUpperCase()} (${type.label})` : type.label);
          } else {
            const key = `${u.id}_${d.dateStr}`;
            row.push(cellNotes[key] || "");
          }
        });
        return row;
      });

      const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
      ws["!cols"] = [
        { wch: 6 },
        { wch: 26 },
        { wch: 18 },
        ...daysList.map(() => ({ wch: 10 })),
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Lịch Làm Việc");
      const filename = `Lich_lam_viec_${periodLabel.replace(/[\s\/\(\)]+/g, "_")}.xlsx`;
      XLSX.writeFile(wb, filename);
    } catch (e) {
      console.error(e);
      alert("Không thể xuất file Excel. Vui lòng thử lại!");
    }
  };

  return (
    <AppShell maxWidthClass="w-full max-w-[100%] px-1 sm:px-3 lg:px-4">
      {/* ==================== HEADER ĐIỀU KHIỂN ==================== */}
      <div data-testid="work-schedule-toolbar" className="grid gap-2.5 rounded-xl bg-ink p-3 text-white shadow-card lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:p-3.5">
        {/* Tiêu đề & Chọn chế độ Tuần / Tháng */}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber/20 text-amber">
              <CalendarDaysIcon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-bold tracking-tight sm:text-base lg:text-lg">Lịch làm việc</h1>
              <p className="hidden truncate text-[11px] text-white/70 sm:block">Theo dõi nghỉ phép & đi muộn đã duyệt</p>
            </div>
          </div>

          {/* Nút chuyển đổi Theo Tuần / Theo Tháng */}
          <div className="inline-flex shrink-0 rounded-lg border border-white/20 bg-white/10 p-0.5">
            <button
              onClick={() => setViewMode("MONTH")}
              className={`min-h-8 rounded-md px-2.5 py-1 text-[11px] font-bold transition sm:px-3 sm:text-xs ${
                viewMode === "MONTH"
                  ? "bg-amber text-ink shadow-sm"
                  : "text-white/80 hover:text-white"
              }`}
            >
              <span className="sm:hidden">Tháng</span><span className="hidden sm:inline">Theo tháng</span>
            </button>
            <button
              onClick={() => setViewMode("WEEK")}
              className={`min-h-8 rounded-md px-2.5 py-1 text-[11px] font-bold transition sm:px-3 sm:text-xs ${
                viewMode === "WEEK"
                  ? "bg-amber text-ink shadow-sm"
                  : "text-white/80 hover:text-white"
              }`}
            >
              <span className="sm:hidden">Tuần</span><span className="hidden sm:inline">Theo tuần (7 ngày)</span>
            </button>
          </div>
        </div>

        {/* Nút điều hướng thời gian & Xuất Excel */}
        <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
          {/* Bộ chuyển thời gian */}
          <div className="flex min-w-0 flex-1 items-center gap-0.5 rounded-lg border border-white/20 bg-white/10 px-1 py-1 sm:gap-1 sm:px-2 lg:flex-none">
            <button
              onClick={prevPeriod}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-white/80 transition hover:bg-white/20 hover:text-white"
              title={viewMode === "MONTH" ? "Tháng trước" : "Tuần trước"}
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </button>
            <button
              onClick={goToToday}
              className="shrink-0 px-1 py-0.5 text-[11px] font-semibold text-white hover:underline sm:px-2 sm:text-xs"
            >
              Hôm nay
            </button>
            <button
              onClick={nextPeriod}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-white/80 transition hover:bg-white/20 hover:text-white"
              title={viewMode === "MONTH" ? "Tháng sau" : "Tuần sau"}
            >
              <ChevronRightIcon className="h-4 w-4" />
            </button>
            <span className="min-w-0 flex-1 truncate px-0.5 text-right text-[11px] font-bold text-amber sm:ml-1 sm:text-xs">{periodLabel}</span>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {/* Nút Đăng ký lịch sinh viên */}
            <button
              onClick={() => {
                setModalStudentUserId(me?.id);
                setModalStudentDate(currentDate);
                setStudentModalOpen(true);
              }}
              className="flex min-h-9 items-center gap-1 rounded-lg bg-amber px-2 text-[11px] font-bold text-ink shadow-sm transition hover:bg-amber-deep hover:text-white sm:gap-1.5 sm:px-3 sm:text-xs"
              title="Đăng ký lịch làm việc linh hoạt theo tuần cho sinh viên"
            >
              <AcademicCapIcon className="h-4 w-4 shrink-0" />
              <span className="sm:hidden">Lịch SV</span><span className="hidden sm:inline">Đăng ký lịch sinh viên</span>
            </button>

            {/* Nút Xuất Excel */}
            <button
              onClick={exportToExcel}
              className="flex min-h-9 items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-2 text-[11px] font-semibold text-white transition hover:bg-white/20 sm:gap-1.5 sm:px-3 sm:text-xs"
              title="Xuất bảng Excel"
            >
              <ArrowDownTrayIcon className="h-4 w-4 shrink-0 text-emerald-400" />
              <span className="sm:hidden">Xuất</span><span className="hidden sm:inline">Xuất Excel</span>
            </button>
          </div>
        </div>
      </div>

      {/* ==================== CHÚ THÍCH 5 KIỂU (Y HỆT ẢNH MẪU) ==================== */}
      <details className="mt-3 rounded-xl border border-slate-200 bg-white p-3 shadow-xs lg:hidden">
        <summary className="cursor-pointer text-sm font-bold text-ink">Chú thích trạng thái</summary>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {SCHEDULE_TYPES.map((item) => (
            <div key={item.key} className="flex items-center gap-2 text-xs text-slate-700">
              <span className={`h-4 w-6 rounded border ${item.bgClass} ${item.borderClass}`} />
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      </details>
      <div className="mt-3 hidden flex-wrap items-center justify-between gap-2.5 rounded-xl border border-slate-200 bg-white p-2.5 shadow-xs lg:flex">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted mr-1">
            Chú thích:
          </span>
          {/* 5 kiểu trạng thái nghỉ / đi muộn */}
          {SCHEDULE_TYPES.map((item) => (
            <div
              key={item.key}
              className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50/70 px-2 py-1"
            >
              <span className={`h-3.5 w-5 rounded-xs border ${item.bgClass} ${item.borderClass} shadow-2xs`} />
              <span className="text-[11px] font-semibold text-slate-800">{item.label}</span>
            </div>
          ))}
        </div>

        {/* Thứ 7 & Chủ nhật & Hôm nay */}
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted border-t sm:border-t-0 pt-1 sm:pt-0">
          <div className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-xs border border-pink-300 bg-pink-50" />
            <span>Thứ 7</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-xs border border-rose-300 bg-rose-100" />
            <span>Chủ nhật</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-xs border border-blue-400 bg-blue-100" />
            <span>Hôm nay</span>
          </div>
        </div>
      </div>

      {/* ==================== BỘ LỌC & TÌM KIẾM NHANH ==================== */}
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-xs">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-md border border-line bg-paper px-2 py-1">
            <FunnelIcon className="h-3.5 w-3.5 text-muted" />
            <select
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              className="bg-transparent text-xs font-medium text-ink outline-none"
            >
              <option value="">Tất cả phòng ban</option>
              {departments.map((dept) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5 rounded-md border border-line bg-paper px-2.5 py-1 text-xs">
            <MagnifyingGlassIcon className="h-3.5 w-3.5 text-muted" />
            <input
              type="text"
              placeholder="Tìm theo tên nhân sự…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-36 lg:w-48 bg-transparent outline-none placeholder:text-muted/70 text-xs"
            />
            {searchTerm && (
              <button onClick={() => setSearchTerm("")}>
                <XMarkIcon className="h-3.5 w-3.5 text-muted hover:text-ink" />
              </button>
            )}
          </div>
        </div>

        <div className="text-[11px] text-muted">
          Nhân sự: <strong className="text-ink">{filteredUsers.length}</strong> người
        </div>
      </div>

      <section className="mt-3 space-y-2 lg:hidden" aria-label="Lịch làm việc trên điện thoại">
        {loading ? (
          <p className="rounded-xl border border-line bg-white px-4 py-8 text-center text-sm text-muted">Đang tải lịch làm việc…</p>
        ) : filteredUsers.length === 0 ? (
          <p className="rounded-xl border border-line bg-white px-4 py-8 text-center text-sm text-muted">Không tìm thấy nhân viên nào phù hợp.</p>
        ) : filteredUsers.map((user, index) => {
          const events = daysList.flatMap((day) => {
            const leave = getApprovedLeave(user.id, day.dateStr);
            const note = cellNotes[`${user.id}_${day.dateStr}`];
            return leave || note ? [{ day, leave, note }] : [];
          });
          const open = expandedMobileUser === user.id;
          return (
            <article key={user.id} className="overflow-hidden rounded-xl border border-line bg-white shadow-card">
              <button type="button" onClick={() => setExpandedMobileUser(open ? null : user.id)} className="flex min-h-16 w-full items-center gap-3 px-3 py-2.5 text-left" aria-expanded={open}>
                <span className="font-mono text-xs font-bold text-slate-400">{index + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-ink">{user.full_name}</span>
                  <span className="block truncate text-[11px] text-muted">{user.department || "Chưa phân phòng ban"}</span>
                </span>
                <span className="shrink-0 text-right text-[11px] font-semibold text-steel">{events.length > 0 ? `${events.length} thay đổi` : "Bình thường"}</span>
                <ChevronRightIcon className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? "rotate-90" : ""}`} />
              </button>
              {open && (
                <div className="max-h-[55vh] divide-y divide-line overflow-y-auto border-t border-line px-3">
                  {daysList.map((day) => {
                    const matchingLeaves = getApprovedLeaves(user.id, day.dateStr);
                    const leave = matchingLeaves[0];
                    const note = cellNotes[`${user.id}_${day.dateStr}`];
                    const type = leave ? getScheduleType(leave.leave_type) : null;
                    return (
                      <button key={day.dateStr} type="button" onClick={() => { setSelectedCell({ user, dateStr: day.dateStr, dayNum: day.dayNum, dayOfWeek: day.dayOfWeek, leave, allLeaves: matchingLeaves }); setNoteInput(note || ""); }} className="flex min-h-12 w-full items-center justify-between gap-3 py-2 text-left">
                        <span className="text-xs font-semibold text-slate-600">{DAY_NAMES_VI[day.dayOfWeek]}, {formatDate(day.dateStr)}</span>
                        <span className={`max-w-[48%] truncate rounded-full px-2 py-1 text-[10px] font-bold ${type ? `${type.bgClass} ${type.textClass}` : note ? "bg-amber/15 text-amber-deep" : "bg-slate-100 text-slate-400"}`}>{type?.label || note || "Làm bình thường"}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </article>
          );
        })}
      </section>

      {/* ==================== BẢNG LỊCH LÀM VIỆC ==================== */}
      {/* Bảng tháng có 31 cột: giữ độ rộng tối thiểu để chữ không chồng lên nhau trên điện thoại. */}
      <div className="mt-2.5 hidden rounded-xl border border-slate-300 bg-white shadow-card overflow-hidden lg:block">
        {loading ? (
          <div className="flex min-h-[350px] flex-col items-center justify-center gap-2">
            <div className="h-7 w-7 animate-spin rounded-full border-3 border-steel border-t-amber" />
            <p className="text-xs text-muted">Đang tải lịch làm việc…</p>
          </div>
        ) : (
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[1120px] table-fixed border-collapse text-xs select-none">
              {/* Tiêu đề các cột */}
              <thead>
                <tr className="bg-slate-100/90 text-slate-700">
                  {/* Cột STT: rất gọn */}
                  <th className="border border-slate-300 px-1 py-1.5 text-center text-[10px] font-bold text-slate-800 w-[28px] sm:w-[32px]">
                    #
                  </th>

                  {/* Cột Họ tên: độ rộng tối ưu */}
                  <th className="border border-slate-300 px-2 py-1.5 text-left text-[11px] font-bold text-slate-800 w-[105px] sm:w-[130px] lg:w-[150px]">
                    Họ và tên
                  </th>

                  {/* Các cột Ngày: tự động chia đều chiều rộng màn hình (Full tháng không kéo ngang) */}
                  {daysList.map((d) => {
                    const isSaturday = d.dayOfWeek === 6;
                    const isSunday = d.dayOfWeek === 0;
                    const isToday = d.dateStr === today;
                    const dayVi = DAY_NAMES_VI[d.dayOfWeek];

                    let headerBg = "bg-white text-slate-700";
                    if (isToday) headerBg = "bg-blue-600 text-white font-black";
                    else if (isSunday) headerBg = "bg-rose-100 text-rose-800";
                    else if (isSaturday) headerBg = "bg-pink-50 text-pink-800";

                    return (
                      <th
                        key={d.dateStr}
                        className={`w-[30px] min-w-[30px] border border-slate-300 p-0 text-center font-semibold transition-colors ${headerBg}`}
                        title={`${FULL_DAY_NAMES_VI[d.dayOfWeek]}, ${formatDate(d.dateStr)}`}
                      >
                        <div className="flex flex-col items-center justify-center py-1">
                          <span className={`text-[11px] leading-tight ${isToday ? "font-bold text-white" : ""}`}>
                            {d.dayNum}
                          </span>
                          <span
                            className={`text-[9px] uppercase leading-none mt-0.5 ${
                              isToday
                                ? "text-blue-100 font-bold"
                                : isSunday
                                ? "text-rose-600 font-semibold"
                                : isSaturday
                                ? "text-pink-600 font-semibold"
                                : "text-slate-400"
                            }`}
                          >
                            {dayVi}
                          </span>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>

              {/* Danh sách nhân viên & các ô lịch */}
              <tbody>
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td
                      colSpan={daysList.length + 2}
                      className="py-12 text-center text-xs text-muted"
                    >
                      Không tìm thấy nhân viên nào phù hợp.
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((user, uIdx) => (
                    <tr
                      key={user.id}
                      className="transition-colors hover:bg-slate-50/70 group"
                    >
                      {/* Cột STT */}
                      <td className="border border-slate-300 bg-slate-50/50 px-1 py-1.5 text-center text-[10px] font-semibold text-slate-600">
                        {uIdx + 1}
                      </td>

                      {/* Cột Họ tên: hiển thị gọn gàng */}
                      <td
                        className="border border-slate-300 bg-white px-1.5 py-1.5 text-left"
                        title={`${user.full_name} (${user.department || "Chưa phân phòng ban"})`}
                      >
                        {/* Chỉ hiện HỌ TÊN — tên phòng vẫn xem được khi rê chuột (title). */}
                        <div className="font-bold text-slate-800 text-[11px] truncate leading-tight">
                          <span className="hidden sm:inline">{user.full_name}</span>
                          <span className="sm:hidden">{formatShortName(user.full_name)}</span>
                        </div>
                      </td>

                      {/* Các ô ngày: HIỂN THỊ ĐƠN ĐÃ DUYỆT (5 KIỂU MÀU) HOẶC BẢNG TRẮNG */}
                      {daysList.map((d) => {
                        const isSaturday = d.dayOfWeek === 6;
                        const isSunday = d.dayOfWeek === 0;
                        const isToday = d.dateStr === today;
                        const matchingLeaves = getApprovedLeaves(user.id, d.dateStr);
                        const leave = matchingLeaves[0];

                        // TRƯỜNG HỢP 1: Có đơn nghỉ phép ĐÃ ĐƯỢC DUYỆT -> Tô đúng 1 trong 5 màu (ưu tiên đơn duyệt sau cùng)
                        if (leave) {
                          const schedType = getScheduleType(leave.leave_type);
                          const reasonText = (leave.reason || schedType.label).toUpperCase();

                          return (
                            <td
                              key={d.dateStr}
                              onClick={() => {
                                setSelectedCell({
                                  user,
                                  dateStr: d.dateStr,
                                  dayNum: d.dayNum,
                                  dayOfWeek: d.dayOfWeek,
                                  leave,
                                  allLeaves: matchingLeaves,
                                });
                              }}
                              className={`border border-slate-300 p-0 text-center cursor-pointer transition-all hover:brightness-95 ${schedType.bgClass} ${schedType.textClass}`}
                              title={`${user.full_name} - ${formatDate(d.dateStr)}\n${schedType.label}: ${leave.reason || "Không ghi lý do"}\n(Đơn được duyệt sau cùng${matchingLeaves.length > 1 ? ` — có thêm ${matchingLeaves.length - 1} lịch khác` : ""})`}
                            >
                              <div className="h-7 sm:h-8 w-full flex items-center justify-center p-0.5 overflow-hidden">
                                <span className="text-[9px] font-bold uppercase tracking-tight truncate max-w-[98%] leading-tight drop-shadow-[0_1px_1px_rgba(0,0,0,0.4)]">
                                  {reasonText}
                                </span>
                              </div>
                            </td>
                          );
                        }

                        // TRƯỜNG HỢP 2: Không có đơn nghỉ -> BẢNG TRẮNG SẠCH SẼ
                        const key = `${user.id}_${d.dateStr}`;
                        const note = cellNotes[key];

                        let cellBg = "bg-white";
                        if (isToday) cellBg = "bg-blue-50/40";
                        else if (isSunday) cellBg = "bg-rose-50/40";
                        else if (isSaturday) cellBg = "bg-pink-50/30";

                        return (
                          <td
                            key={d.dateStr}
                            onClick={() => {
                              setSelectedCell({
                                user,
                                dateStr: d.dateStr,
                                dayNum: d.dayNum,
                                dayOfWeek: d.dayOfWeek,
                              });
                              setNoteInput(note || "");
                            }}
                            className={`border border-slate-300 p-0 text-center cursor-pointer transition-all hover:bg-amber/15 ${cellBg}`}
                            title={`Bấm để xem/ghi chú ngày ${formatDate(d.dateStr)} của ${user.full_name}`}
                          >
                            <div className="h-7 sm:h-8 w-full flex items-center justify-center p-0.5">
                              {note ? (
                                <span className="inline-block max-w-[95%] truncate rounded bg-slate-800 px-1 py-0.5 text-[9px] font-medium text-white shadow-xs">
                                  {note}
                                </span>
                              ) : (
                                <span className="text-transparent group-hover:text-slate-300 text-[10px] leading-none">
                                  +
                                </span>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ==================== POPUP XEM CHI TIẾT Ô LỊCH ==================== */}
      {selectedCell && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-xs animate-in fade-in duration-100">
          <div className="w-full max-w-sm rounded-xl border border-line bg-white p-5 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-line pb-2.5">
              <div>
                <h3 className="text-sm font-bold text-ink">
                  {FULL_DAY_NAMES_VI[selectedCell.dayOfWeek]}, {formatDate(selectedCell.dateStr)}
                </h3>
                <p className="text-xs text-muted mt-0.5">
                  Nhân sự: <strong className="text-ink">{selectedCell.user.full_name}</strong>
                </p>
              </div>
              <button
                onClick={() => setSelectedCell(null)}
                className="rounded-lg p-1 text-muted hover:bg-paper hover:text-ink transition"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            {/* Nếu ô này có đơn nghỉ phép ĐÃ ĐƯỢC DUYỆT */}
            {selectedCell.leave ? (
              <div className="mt-4 space-y-3 text-xs">
                {selectedCell.allLeaves && selectedCell.allLeaves.length > 1 && (
                  <div className="flex items-center gap-1.5 rounded-lg border border-amber/30 bg-amber/10 px-2.5 py-1.5 text-[11px] font-semibold text-amber-900">
                    <span className="flex h-2 w-2 shrink-0 rounded-full bg-amber-500 animate-pulse" />
                    <span>Ngày này có {selectedCell.allLeaves.length} lịch — hiển thị lịch được duyệt sau cùng</span>
                  </div>
                )}

                <div className="rounded-lg border border-line bg-paper p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Phân loại:</span>
                    <span className="font-bold text-ink">
                      {getScheduleType(selectedCell.leave.leave_type).label}
                    </span>
                  </div>
                  <div className="flex items-start justify-between">
                    <span className="text-muted">Lý do nghỉ:</span>
                    <span className="font-bold text-ink text-right">
                      {selectedCell.leave.reason || "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Trạng thái:</span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-ok/10 px-2 py-0.5 text-[10px] font-bold text-ok">
                      <CheckCircleIcon className="h-3 w-3" /> Đã được duyệt (Mới nhất)
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Thời gian:</span>
                    <span className="text-ink">
                      {formatDate(selectedCell.leave.from_date)} → {formatDate(selectedCell.leave.to_date)}
                    </span>
                  </div>
                  {selectedCell.leave.source && (
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-muted">Nguồn lịch:</span>
                      <span className="text-slate-600 font-medium">
                        {selectedCell.leave.source === "SCHEDULE" ? "Đăng ký lịch tuần sinh viên" : "Đơn xin nghỉ phép"}
                      </span>
                    </div>
                  )}
                </div>

                {/* Nếu có các đơn khác / lớp dưới */}
                {selectedCell.allLeaves && selectedCell.allLeaves.length > 1 && (
                  <div className="space-y-1.5 rounded-lg border border-slate-200 bg-slate-50/80 p-2.5">
                    <div className="text-[11px] font-bold text-slate-700">
                      Lịch cũ hơn / lớp dưới ({selectedCell.allLeaves.length - 1} lịch):
                    </div>
                    <div className="space-y-1.5 max-h-36 overflow-y-auto">
                      {selectedCell.allLeaves.slice(1).map((other) => {
                        const otherType = getScheduleType(other.leave_type);
                        return (
                          <div
                            key={other.id}
                            className="flex items-center justify-between gap-2 rounded border border-line bg-white p-2 text-[11px]"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="font-semibold text-ink flex items-center gap-1">
                                <span className={`inline-block h-2 w-2 rounded-full ${otherType.bgClass}`} />
                                {otherType.label}
                                <span className="text-muted font-normal truncate">({other.reason || "Không ghi lý do"})</span>
                              </div>
                              <div className="text-[10px] text-muted">
                                {other.source === "SCHEDULE" ? "Lịch tuần" : "Đơn nghỉ phép"} • {formatDate(other.from_date)}
                              </div>
                            </div>
                            {me && (isManagerUp(me.role) || me.role === "ADMIN" || me.id === other.user_id) && (
                              <button
                                onClick={() => handleDeleteLeave(other.id)}
                                disabled={deletingLeave}
                                className="shrink-0 rounded bg-rose-50 px-2 py-1 text-[10px] font-semibold text-rose-700 hover:bg-rose-100 transition border border-rose-200"
                                title="Xóa lịch lớp dưới này"
                              >
                                Xóa
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between pt-2 border-t border-line">
                  {me && (isManagerUp(me.role) || me.role === "ADMIN" || me.id === selectedCell.leave.user_id) ? (
                    <button
                      onClick={() => selectedCell.leave && handleDeleteLeave(selectedCell.leave.id)}
                      disabled={deletingLeave}
                      className="flex items-center gap-1 rounded-lg border border-bad/30 bg-bad/10 px-2.5 py-1.5 text-xs font-semibold text-bad hover:bg-bad/20 transition disabled:opacity-50"
                      title="Xóa đơn nghỉ phép này khỏi hệ thống"
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                      <span>{deletingLeave ? "Đang xóa…" : "Xóa đơn này"}</span>
                    </button>
                  ) : (
                    <div />
                  )}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        const targetUser = selectedCell.user;
                        const targetDate = new Date(selectedCell.dateStr);
                        setSelectedCell(null);
                        setModalStudentUserId(targetUser.id);
                        setModalStudentDate(targetDate);
                        setStudentModalOpen(true);
                      }}
                      className="flex items-center gap-1 rounded-lg border border-amber/40 bg-amber/10 px-2.5 py-1.5 text-xs font-bold text-amber-700 hover:bg-amber/20 transition"
                      title="Đăng ký hoặc sửa lịch tuần cho sinh viên này"
                    >
                      <AcademicCapIcon className="h-3.5 w-3.5" />
                      <span>Đăng ký lịch tuần</span>
                    </button>
                    <button
                      onClick={() => setSelectedCell(null)}
                      className="rounded-lg bg-ink px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 transition"
                    >
                      Đóng
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              /* Nếu là ngày bình thường (bảng trắng) -> cho phép ghi chú lịch trực */
              <div className="mt-4 space-y-3 text-xs">
                <div>
                  <label className="block text-[11px] font-semibold text-muted mb-1">
                    Ghi chú lịch trực / phân công:
                  </label>
                  <input
                    type="text"
                    placeholder="Ví dụ: Trực ca, Đi dự án, Họp KH, Làm online..."
                    value={noteInput}
                    onChange={(e) => setNoteInput(e.target.value)}
                    className="w-full rounded-lg border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel"
                    autoFocus
                  />
                </div>

                <div className="rounded-lg bg-paper p-2.5 text-[11px] text-muted">
                  💡 Ngày làm việc bình thường (bảng trắng). Bạn có thể ghi chú ca trực hoặc công việc riêng cho nhân sự này.
                </div>

                <div className="mt-2 flex items-center justify-between border-t border-line pt-3">
                  <button
                    onClick={() => {
                      const targetUser = selectedCell.user;
                      const targetDate = new Date(selectedCell.dateStr);
                      setSelectedCell(null);
                      setModalStudentUserId(targetUser.id);
                      setModalStudentDate(targetDate);
                      setStudentModalOpen(true);
                    }}
                    className="flex items-center gap-1 text-[11px] font-semibold text-amber-700 hover:underline"
                    title="Đăng ký hoặc sửa lịch tuần cho sinh viên này"
                  >
                    <AcademicCapIcon className="h-3.5 w-3.5" />
                    <span>Đăng ký lịch tuần SV</span>
                  </button>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSelectedCell(null)}
                      className="rounded-lg border border-line bg-paper px-3 py-1.5 text-xs font-semibold text-ink hover:bg-line transition"
                    >
                      Đóng
                    </button>
                    {noteInput && (
                      <button
                        onClick={() => {
                          setNoteInput("");
                          const key = `${selectedCell.user.id}_${selectedCell.dateStr}`;
                          setCellNotes((prev) => {
                            const copy = { ...prev };
                            delete copy[key];
                            return copy;
                          });
                          setSelectedCell(null);
                        }}
                        className="rounded-lg border border-bad/30 bg-bad/5 px-2.5 py-1.5 text-xs font-semibold text-bad hover:bg-bad/10 transition"
                      >
                        Xóa ghi chú
                      </button>
                    )}
                    <button
                      onClick={handleSaveNote}
                      className="flex items-center gap-1 rounded-lg bg-ink px-3.5 py-1.5 text-xs font-bold text-white hover:bg-slate-800 transition"
                    >
                      <CheckCircleIcon className="h-4 w-4 text-emerald-400" />
                      <span>Lưu lại</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== MODAL ĐĂNG KÝ LỊCH TUẦN CHO SINH VIÊN ==================== */}
      <StudentScheduleModal
        isOpen={studentModalOpen}
        onClose={() => setStudentModalOpen(false)}
        users={users}
        currentUser={me}
        initialUserId={modalStudentUserId}
        initialDate={modalStudentDate}
        existingLeaves={leaves}
        onSaved={(_updated) => {
          loadLeaves();
        }}
      />
    </AppShell>
  );
}
