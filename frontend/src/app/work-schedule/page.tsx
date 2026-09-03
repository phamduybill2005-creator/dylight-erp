"use client";

// Trang Lịch làm việc (Work Schedule)
// Giao diện ma trận theo dõi lịch trực, đi muộn, nghỉ phép của toàn thể nhân sự.
// Hỗ trợ 2 chế độ: Theo Tuần và Theo Tháng.
// Tô màu và hiển thị lý do nổi bật theo đúng quy chuẩn phàm lệ như bảng tính.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDaysIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MagnifyingGlassIcon,
  ArrowDownTrayIcon,
  PlusIcon,
  XMarkIcon,
  PaperAirplaneIcon,
  FunnelIcon,
} from "@heroicons/react/24/outline";
import * as XLSX from "xlsx";
import AppShell from "@/components/app-shell";
import { api } from "@/lib/api";
import { dateLocal, formatDate, todayLocal } from "@/lib/format";
import type { LeaveRequest, LeaveType, User } from "@/lib/types";

// Danh sách LÝ DO nghỉ phép cố định
const LEAVE_REASONS = [
  "GIỖ TẾT", "HIẾU SỰ", "HỶ SỰ", "ỐM ĐAU", "NGỦ QUÊN", "TẮC ĐƯỜNG",
  "HỎNG XE", "SINH NHẬT", "THIÊN TAI", "BIA RƯỢU", "HỌC HÀNH", "YÊU ĐƯƠNG",
  "GIA ĐÌNH",
];

// Định nghĩa màu sắc theo Phàm lệ từ bảng tính mẫu
export interface LegendItem {
  key: string;
  label: string;
  bgClass: string;
  textClass: string;
  borderClass: string;
  hexColor: string;
}

const LEGEND_ITEMS: LegendItem[] = [
  {
    key: "LATE_MORNING",
    label: "Đi muộn sáng",
    bgClass: "bg-[#16a34a]",
    textClass: "text-white",
    borderClass: "border-[#15803d]",
    hexColor: "#16a34a",
  },
  {
    key: "LATE_AFTERNOON",
    label: "Đi muộn chiều",
    bgClass: "bg-[#84cc16]",
    textClass: "text-slate-900",
    borderClass: "border-[#65a30d]",
    hexColor: "#84cc16",
  },
  {
    key: "MORNING",
    label: "Nghỉ sáng",
    bgClass: "bg-[#eab308]",
    textClass: "text-slate-900",
    borderClass: "border-[#ca8a04]",
    hexColor: "#eab308",
  },
  {
    key: "AFTERNOON",
    label: "Nghỉ chiều",
    bgClass: "bg-[#f97316]",
    textClass: "text-white",
    borderClass: "border-[#ea580c]",
    hexColor: "#f97316",
  },
  {
    key: "FULL",
    label: "Nghỉ cả ngày",
    bgClass: "bg-[#ef4444]",
    textClass: "text-white",
    borderClass: "border-[#dc2626]",
    hexColor: "#ef4444",
  },
  {
    key: "SATURDAY",
    label: "Thứ 7",
    bgClass: "bg-[#fbcfe8]",
    textClass: "text-[#9d174d]",
    borderClass: "border-[#f472b6]",
    hexColor: "#fbcfe8",
  },
  {
    key: "SUNDAY",
    label: "Chủ nhật",
    bgClass: "bg-[#ec4899]",
    textClass: "text-white",
    borderClass: "border-[#db2777]",
    hexColor: "#ec4899",
  },
];

// Helper phân loại đơn nghỉ theo màu
function getLeaveStyle(leaveType?: string | null): LegendItem {
  if (!leaveType) return LEGEND_ITEMS[4]; // mặc định FULL
  if (leaveType === "LATE_MORNING" || leaveType === "LATE") return LEGEND_ITEMS[0];
  if (leaveType === "LATE_AFTERNOON") return LEGEND_ITEMS[1];
  if (leaveType === "MORNING") return LEGEND_ITEMS[2];
  if (leaveType === "AFTERNOON") return LEGEND_ITEMS[3];
  return LEGEND_ITEMS[4]; // FULL
}

// Lấy thứ trong tuần tiếng Việt
const DAY_NAMES_VI = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

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

export default function WorkSchedulePage() {
  const router = useRouter();
  const [me, setMe] = useState<User | null>(api.cachedUser());
  const [users, setUsers] = useState<User[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);

  // Chế độ xem: "WEEK" (Theo tuần) hoặc "MONTH" (Theo tháng)
  const [viewMode, setViewMode] = useState<"WEEK" | "MONTH">("MONTH");

  // Thời gian chọn
  const today = todayLocal();
  const [currentDate, setCurrentDate] = useState<Date>(new Date());

  // Bộ lọc
  const [deptFilter, setDeptFilter] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  // Modal xem chi tiết ô nghỉ
  const [selectedCell, setSelectedCell] = useState<{
    user: User;
    dateStr: string;
    leave?: LeaveRequest;
  } | null>(null);

  // Modal gửi đơn nhanh
  const [showQuickLeave, setShowQuickLeave] = useState(false);
  const [quickFromDate, setQuickFromDate] = useState(today);
  const [quickToDate, setQuickToDate] = useState(today);
  const [quickLeaveType, setQuickLeaveType] = useState<LeaveType>("FULL");
  const [quickReason, setQuickReason] = useState("");
  const [quickSaving, setQuickSaving] = useState(false);

  // Load danh sách người dùng & thông tin người đăng nhập
  useEffect(() => {
    api.me()
      .then((u) => {
        setMe(u);
        return api.users();
      })
      .then((userList) => {
        // Sắp xếp người dùng theo thứ tự ưu tiên: Giám đốc -> Quản lý -> Nhân viên
        const sorted = [...userList].sort((a, b) => {
          const roleOrder: Record<string, number> = {
            DIRECTOR: 1,
            MANAGER: 2,
            ACCOUNTANT: 3,
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
      .catch(() => router.push("/login"));
  }, [router]);

  // Tính danh sách các ngày hiển thị theo viewMode
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
      // Chế độ Tuần: 7 ngày từ Thứ 2 đến Chủ nhật
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

  // Tải danh sách đơn nghỉ phép trong kỳ
  const loadScheduleData = () => {
    setLoading(true);
    api.leaveSchedule({
      from_date: dateRange.from_date,
      to_date: dateRange.to_date,
      month: dateRange.month,
    })
      .then((data) => {
        setLeaves(data);
      })
      .catch((err) => {
        console.error("Lỗi khi tải lịch làm việc:", err);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadScheduleData();
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

  // Tra cứu đơn nghỉ của 1 nhân viên trong 1 ngày cụ thể
  const getLeaveForUserAndDate = (userId: number, dateStr: string): LeaveRequest | undefined => {
    return leaves.find((l) => {
      if (l.user_id !== userId) return false;
      return l.from_date <= dateStr && l.to_date >= dateStr;
    });
  };

  // Danh sách các phòng ban để lọc
  const departments = useMemo(() => {
    const set = new Set<string>();
    users.forEach((u) => {
      if (u.department) set.add(u.department.trim());
    });
    return Array.from(set).sort();
  }, [users]);

  // Lọc danh sách nhân viên
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      if (deptFilter && u.department !== deptFilter) return false;
      if (searchTerm) {
        const query = searchTerm.toLowerCase();
        const matchName = u.full_name.toLowerCase().includes(query);
        const matchDept = (u.department || "").toLowerCase().includes(query);
        if (!matchName && !matchDept) return false;
      }
      return true;
    });
  }, [users, deptFilter, searchTerm]);

  // Thống kê nhanh trong kỳ
  const stats = useMemo(() => {
    let leaveCount = 0;
    let lateCount = 0;
    leaves.forEach((l) => {
      if (l.leave_type && l.leave_type.includes("LATE")) {
        lateCount++;
      } else {
        leaveCount++;
      }
    });
    return { leaveCount, lateCount };
  }, [leaves]);

  // Xuất file Excel bảng Lịch làm việc
  const exportToExcel = () => {
    try {
      const headerRow1 = ["STT", "Họ và tên", "Phòng ban"];
      daysList.forEach((d) => {
        const dName = DAY_NAMES_VI[d.dayOfWeek];
        headerRow1.push(`${d.dayNum} (${dName})`);
      });

      const dataRows = filteredUsers.map((u, idx) => {
        const row: (string | number)[] = [idx + 1, u.full_name, u.department || "—"];
        daysList.forEach((d) => {
          const l = getLeaveForUserAndDate(u.id, d.dateStr);
          if (l) {
            row.push(l.reason ? l.reason.toUpperCase() : "NGHỈ");
          } else {
            row.push("");
          }
        });
        return row;
      });

      const ws = XLSX.utils.aoa_to_sheet([headerRow1, ...dataRows]);
      ws["!cols"] = [
        { wch: 6 },
        { wch: 26 },
        { wch: 18 },
        ...daysList.map(() => ({ wch: 12 })),
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

  // Gửi đơn xin nghỉ / báo đi muộn nhanh
  const handleQuickSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickFromDate || !quickToDate || !quickReason) return;
    setQuickSaving(true);
    try {
      await api.createLeave({
        from_date: quickFromDate,
        to_date: quickToDate,
        leave_type: quickLeaveType,
        reason: quickReason,
      });
      setShowQuickLeave(false);
      setQuickReason("");
      loadScheduleData();
    } catch (err) {
      console.error(err);
      alert("Có lỗi xảy ra khi gửi đơn. Vui lòng thử lại!");
    } finally {
      setQuickSaving(false);
    }
  };

  return (
    <AppShell maxWidthClass="w-full max-w-[98%] lg:max-w-[96%] xl:max-w-[1750px]">
      {/* ==================== HEADER ==================== */}
      <header className="flex flex-col gap-4 rounded-xl2 bg-ink p-4 text-white shadow-card md:flex-row md:items-center md:justify-between lg:p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber/20 text-amber">
            <CalendarDaysIcon className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold tracking-tight lg:text-2xl">Lịch làm việc</h1>
              <span className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-amber">
                Chấm công & Đi muộn
              </span>
            </div>
            <p className="text-xs text-white/70">
              Ma trận theo dõi nghỉ phép, đi muộn của toàn bộ nhân sự công ty
            </p>
          </div>
        </div>

        {/* Nút hành động nhanh */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Nút Xuất Excel */}
          <button
            onClick={exportToExcel}
            className="flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/20"
            title="Xuất bảng lịch làm việc ra file Excel"
          >
            <ArrowDownTrayIcon className="h-4 w-4 text-emerald-400" />
            <span>Xuất Excel</span>
          </button>

          {/* Nút gửi đơn xin nghỉ nhanh */}
          <button
            onClick={() => {
              setQuickFromDate(today);
              setQuickToDate(today);
              setQuickLeaveType("FULL");
              setQuickReason("");
              setShowQuickLeave(true);
            }}
            className="flex items-center gap-1.5 rounded-lg bg-amber px-3.5 py-2 text-xs font-bold text-ink shadow-sm transition hover:bg-amber-deep"
          >
            <PlusIcon className="h-4 w-4" />
            <span>Báo nghỉ / Đi muộn</span>
          </button>
        </div>
      </header>

      {/* ==================== ĐIỀU KHIỂN & BỘ LỌC ==================== */}
      <div className="mt-4 flex flex-col gap-3 rounded-xl2 border border-line bg-white p-3.5 shadow-card md:flex-row md:items-center md:justify-between">
        {/* Toggle Chế độ xem: Tuần / Tháng */}
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-line bg-paper p-0.5">
            <button
              onClick={() => setViewMode("WEEK")}
              className={`rounded-md px-3 py-1.5 text-xs font-bold transition ${
                viewMode === "WEEK"
                  ? "bg-ink text-white shadow-sm"
                  : "text-muted hover:text-ink"
              }`}
            >
              Theo tuần
            </button>
            <button
              onClick={() => setViewMode("MONTH")}
              className={`rounded-md px-3 py-1.5 text-xs font-bold transition ${
                viewMode === "MONTH"
                  ? "bg-ink text-white shadow-sm"
                  : "text-muted hover:text-ink"
              }`}
            >
              Theo tháng
            </button>
          </div>

          {/* Điều hướng thời gian */}
          <div className="flex items-center gap-1">
            <button
              onClick={prevPeriod}
              className="rounded-lg border border-line bg-paper p-1.5 text-ink hover:bg-line transition"
              title={viewMode === "MONTH" ? "Tháng trước" : "Tuần trước"}
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </button>
            <button
              onClick={goToToday}
              className="rounded-lg border border-line bg-paper px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-line transition"
            >
              Hôm nay
            </button>
            <button
              onClick={nextPeriod}
              className="rounded-lg border border-line bg-paper p-1.5 text-ink hover:bg-line transition"
              title={viewMode === "MONTH" ? "Tháng sau" : "Tuần sau"}
            >
              <ChevronRightIcon className="h-4 w-4" />
            </button>
          </div>

          <span className="text-xs lg:text-sm font-bold text-ink ml-1">
            {periodLabel}
          </span>
        </div>

        {/* Lọc theo Phòng ban & Tìm kiếm */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Bộ lọc phòng ban */}
          <div className="flex items-center gap-1.5 rounded-lg border border-line bg-paper px-2 py-1">
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

          {/* Ô tìm kiếm theo tên */}
          <div className="flex items-center gap-1.5 rounded-lg border border-line bg-paper px-2.5 py-1.5 text-xs">
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
      </div>

      {/* ==================== PHÀM LỆ (LEGEND) ==================== */}
      <div className="mt-3 rounded-xl2 border border-line bg-white p-3 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-muted">
              Phàm lệ / Chú thích:
            </span>
          </div>
          <div className="flex items-center gap-4 text-[11px] text-muted">
            <span>
              Tổng nhân sự: <strong className="text-ink">{filteredUsers.length}</strong>
            </span>
            <span>
              Lượt nghỉ: <strong className="text-bad">{stats.leaveCount}</strong>
            </span>
            <span>
              Lượt đi muộn: <strong className="text-amber-700">{stats.lateCount}</strong>
            </span>
          </div>
        </div>

        {/* Các ô màu đại diện y hệt ảnh */}
        <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {LEGEND_ITEMS.map((item) => (
            <div
              key={item.key}
              className="flex items-center gap-2 rounded-lg border border-line/80 bg-paper/60 p-1.5 transition hover:bg-paper"
            >
              <div
                className={`h-6 w-8 shrink-0 rounded border ${item.bgClass} ${item.borderClass} flex items-center justify-center shadow-xs`}
              />
              <span className="text-xs font-semibold text-ink leading-tight">
                {item.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ==================== BẢNG MA TRẬN LỊCH LÀM VIỆC ==================== */}
      <div className="mt-3 overflow-hidden rounded-xl2 border border-line bg-white shadow-card">
        {loading ? (
          <div className="flex min-h-[400px] flex-col items-center justify-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-steel border-t-amber" />
            <p className="text-xs font-medium text-muted">Đang tải dữ liệu lịch làm việc…</p>
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[75vh]">
            <table className="w-full border-collapse text-xs">
              {/* Tiêu đề cột */}
              <thead className="sticky top-0 z-20 bg-[#f8fafc] text-ink shadow-xs">
                <tr>
                  {/* Cột STT (Sticky) */}
                  <th className="sticky left-0 z-30 border border-slate-300 bg-[#e2e8f0] px-2 py-2.5 text-center text-[11px] font-bold text-slate-800 min-w-[44px] w-[44px]">
                    STT
                  </th>

                  {/* Cột Họ tên (Sticky) */}
                  <th className="sticky left-[44px] z-30 border border-slate-300 bg-[#e2e8f0] px-3 py-2.5 text-left text-[11px] font-bold text-slate-800 min-w-[180px] w-[180px] lg:min-w-[210px] lg:w-[210px]">
                    Họ tên
                  </th>

                  {/* Các cột Ngày */}
                  {daysList.map((d) => {
                    const isSaturday = d.dayOfWeek === 6;
                    const isSunday = d.dayOfWeek === 0;
                    const isToday = d.dateStr === today;
                    const dayVi = DAY_NAMES_VI[d.dayOfWeek];

                    let headerBg = "bg-white text-slate-700";
                    if (isSaturday) headerBg = "bg-[#fbcfe8] text-[#831843]"; // Hồng nhạt cho Thứ 7
                    if (isSunday) headerBg = "bg-[#ec4899] text-white"; // Hồng đậm cho Chủ nhật

                    return (
                      <th
                        key={d.dateStr}
                        className={`border border-slate-300 px-1 py-1.5 text-center font-bold min-w-[56px] ${
                          viewMode === "WEEK" ? "w-[14%]" : "w-[3%]"
                        } ${headerBg} ${isToday ? "ring-2 ring-blue-500 ring-inset" : ""}`}
                      >
                        <div className="flex flex-col items-center">
                          <span className="text-[12px] leading-none">{d.dayNum}</span>
                          <span
                            className={`text-[10px] font-semibold mt-0.5 ${
                              isSunday
                                ? "text-pink-100"
                                : isSaturday
                                ? "text-pink-900"
                                : "text-muted"
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

              {/* Thân bảng */}
              <tbody className="divide-y divide-slate-200">
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td
                      colSpan={daysList.length + 2}
                      className="py-12 text-center text-xs text-muted"
                    >
                      Không tìm thấy nhân viên nào phù hợp với bộ lọc.
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((user, uIdx) => (
                    <tr
                      key={user.id}
                      className="transition-colors hover:bg-slate-50/60"
                    >
                      {/* Cột STT */}
                      <td className="sticky left-0 z-10 border border-slate-300 bg-white px-2 py-2 text-center font-bold text-slate-700">
                        {uIdx + 1}
                      </td>

                      {/* Cột Họ tên */}
                      <td className="sticky left-[44px] z-10 border border-slate-300 bg-white px-3 py-2 text-left">
                        <div className="font-bold text-ink uppercase tracking-wide text-[11px] truncate" title={user.full_name}>
                          {user.full_name}
                        </div>
                        {user.department && (
                          <div className="text-[9px] font-medium text-muted truncate">
                            {user.department}
                          </div>
                        )}
                      </td>

                      {/* Các ô Ngày */}
                      {daysList.map((d) => {
                        const leave = getLeaveForUserAndDate(user.id, d.dateStr);
                        const isSaturday = d.dayOfWeek === 6;
                        const isSunday = d.dayOfWeek === 0;
                        const isToday = d.dateStr === today;

                        if (leave) {
                          const style = getLeaveStyle(leave.leave_type);
                          const reasonText = (leave.reason || style.label).toUpperCase();
                          const isPending = leave.status === "PENDING";

                          return (
                            <td
                              key={d.dateStr}
                              onClick={() => setSelectedCell({ user, dateStr: d.dateStr, leave })}
                              className={`border border-slate-300 p-0 text-center cursor-pointer select-none transition-all hover:brightness-95 ${
                                style.bgClass
                              } ${style.textClass} ${
                                isPending ? "opacity-85 border-dashed" : ""
                              } ${isToday ? "ring-2 ring-blue-500 ring-inset" : ""}`}
                              title={`${user.full_name} - ${d.dateStr}\n${style.label}: ${leave.reason || "Không ghi"}\nTrạng thái: ${
                                leave.status === "APPROVED" ? "Đã duyệt" : "Chờ duyệt"
                              }`}
                            >
                              <div className="flex h-full min-h-[36px] w-full flex-col items-center justify-center px-1 py-1 text-center font-bold leading-tight">
                                <span className="text-[10px] uppercase tracking-tighter truncate max-w-[95%]">
                                  {reasonText}
                                </span>
                                {isPending && (
                                  <span className="text-[8px] opacity-80 font-normal">
                                    (chờ)
                                  </span>
                                )}
                              </div>
                            </td>
                          );
                        }

                        // Ô không có lịch nghỉ
                        let cellBg = "bg-white";
                        if (isSaturday) cellBg = "bg-pink-50/40"; // Thứ 7 nhạt
                        if (isSunday) cellBg = "bg-pink-100/30"; // CN nhạt

                        return (
                          <td
                            key={d.dateStr}
                            onClick={() => setSelectedCell({ user, dateStr: d.dateStr })}
                            className={`border border-slate-300 p-0 text-center cursor-pointer transition hover:bg-slate-100/70 ${cellBg} ${
                              isToday ? "ring-2 ring-blue-500 ring-inset" : ""
                            }`}
                            title={`Bấm để xem hoặc đăng ký nghỉ ngày ${formatDate(d.dateStr)}`}
                          >
                            <div className="h-full min-h-[36px] w-full" />
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

      {/* ==================== MODAL XEM CHI TIẾT Ô LỊCH ==================== */}
      {selectedCell && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-xl2 border border-line bg-white p-5 shadow-xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h3 className="text-sm font-bold text-ink">
                Chi tiết ngày {formatDate(selectedCell.dateStr)}
              </h3>
              <button
                onClick={() => setSelectedCell(null)}
                className="rounded-lg p-1 text-muted hover:bg-paper hover:text-ink transition"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted">Nhân viên:</span>
                <span className="font-bold text-ink">{selectedCell.user.full_name}</span>
              </div>
              {selectedCell.user.department && (
                <div className="flex items-center justify-between">
                  <span className="text-muted">Phòng ban:</span>
                  <span className="font-medium text-ink">{selectedCell.user.department}</span>
                </div>
              )}

              {selectedCell.leave ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Phân loại:</span>
                    <span className="font-semibold text-ink">
                      {getLeaveStyle(selectedCell.leave.leave_type).label}
                    </span>
                  </div>
                  <div className="flex items-start justify-between">
                    <span className="text-muted">Lý do:</span>
                    <span className="font-bold text-ink text-right">
                      {selectedCell.leave.reason || "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Trạng thái:</span>
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        selectedCell.leave.status === "APPROVED"
                          ? "bg-ok/10 text-ok"
                          : "bg-amber/15 text-amber-deep"
                      }`}
                    >
                      {selectedCell.leave.status === "APPROVED" ? "Đã duyệt" : "Chờ duyệt"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Thời gian:</span>
                    <span className="text-ink">
                      {formatDate(selectedCell.leave.from_date)} → {formatDate(selectedCell.leave.to_date)}
                    </span>
                  </div>
                </>
              ) : (
                <div className="rounded-lg bg-paper p-3 text-center text-muted">
                  Chưa có lịch nghỉ hoặc đi muộn vào ngày này.
                </div>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setSelectedCell(null)}
                className="rounded-lg border border-line bg-paper px-3 py-1.5 text-xs font-semibold text-ink hover:bg-line transition"
              >
                Đóng
              </button>
              {/* Nút gửi đơn nhanh cho ngày này */}
              <button
                onClick={() => {
                  setQuickFromDate(selectedCell.dateStr);
                  setQuickToDate(selectedCell.dateStr);
                  setQuickLeaveType("FULL");
                  setQuickReason("");
                  setSelectedCell(null);
                  setShowQuickLeave(true);
                }}
                className="rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 transition"
              >
                + Báo nghỉ ngày này
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL GỬI ĐƠN NHANH ==================== */}
      {showQuickLeave && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-xl2 border border-line bg-white p-5 shadow-xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div className="flex items-center gap-2">
                <CalendarDaysIcon className="h-5 w-5 text-amber" />
                <h3 className="text-sm font-bold text-ink">Báo nghỉ phép / Đi muộn</h3>
              </div>
              <button
                onClick={() => setShowQuickLeave(false)}
                className="rounded-lg p-1 text-muted hover:bg-paper hover:text-ink transition"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleQuickSubmit} className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-muted">Từ ngày *</label>
                  <input
                    type="date"
                    required
                    value={quickFromDate}
                    onChange={(e) => {
                      setQuickFromDate(e.target.value);
                      if (!quickToDate || quickToDate < e.target.value) {
                        setQuickToDate(e.target.value);
                      }
                    }}
                    className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-muted">Đến ngày *</label>
                  <input
                    type="date"
                    required
                    value={quickToDate}
                    onChange={(e) => setQuickToDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-xs outline-none focus:border-steel"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-muted">Hình thức *</label>
                <select
                  value={quickLeaveType}
                  onChange={(e) => setQuickLeaveType(e.target.value as LeaveType)}
                  className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-xs font-medium outline-none focus:border-steel"
                >
                  <option value="FULL">Nghỉ cả ngày (Đỏ)</option>
                  <option value="MORNING">Nghỉ sáng (Vàng)</option>
                  <option value="AFTERNOON">Nghỉ chiều (Cam)</option>
                  <option value="LATE_MORNING">Đi muộn sáng (Xanh lá đậm)</option>
                  <option value="LATE_AFTERNOON">Đi muộn chiều (Xanh lá nhạt)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-muted">
                  Lý do * <span className="font-normal text-muted/70">(chọn theo danh mục)</span>
                </label>
                <select
                  required
                  value={quickReason}
                  onChange={(e) => setQuickReason(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-xs font-medium outline-none focus:border-steel"
                >
                  <option value="">— Chọn lý do —</option>
                  {LEAVE_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mt-5 flex justify-end gap-2 border-t border-line pt-3">
                <button
                  type="button"
                  onClick={() => setShowQuickLeave(false)}
                  className="rounded-lg border border-line bg-paper px-3.5 py-2 text-xs font-semibold text-ink hover:bg-line transition"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={quickSaving || !quickFromDate || !quickToDate || !quickReason}
                  className="flex items-center gap-1.5 rounded-lg bg-ink px-4 py-2 text-xs font-bold text-white transition hover:bg-slate-800 disabled:opacity-50"
                >
                  <PaperAirplaneIcon className="h-3.5 w-3.5" />
                  {quickSaving ? "Đang gửi…" : "Gửi đơn"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
