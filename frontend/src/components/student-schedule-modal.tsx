"use client";

import { useEffect, useMemo, useState } from "react";
import {
  XMarkIcon,
  AcademicCapIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CheckCircleIcon,
  CalendarDaysIcon,
} from "@heroicons/react/24/outline";
import { api } from "@/lib/api";
import { isManagerUp } from "@/lib/roles";
import { dateLocal, formatDate } from "@/lib/format";
import type { LeaveRequest, StudentDaySchedule, StudentShift, User } from "@/lib/types";

interface StudentScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  users: User[];
  currentUser: User | null;
  initialUserId?: number;
  initialDate?: Date;
  existingLeaves: LeaveRequest[];
  onSaved: (updatedLeaves: LeaveRequest[]) => void;
}

// 4 ca làm việc theo tuần cho sinh viên
const SHIFT_OPTIONS: {
  key: StudentShift;
  label: string;
  subLabel: string;
  badgeClass: string;
  activeClass: string;
}[] = [
  {
    key: "ALL_DAY",
    label: "Cả ngày",
    subLabel: "Đi làm đủ ca",
    badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
    activeClass: "bg-emerald-600 text-white border-emerald-600 shadow-sm",
  },
  {
    key: "MORNING_ONLY",
    label: "Làm sáng",
    subLabel: "Nghỉ chiều",
    badgeClass: "bg-orange-50 text-orange-700 border-orange-200",
    activeClass: "bg-[#f97316] text-white border-[#ea580c] shadow-sm",
  },
  {
    key: "AFTERNOON_ONLY",
    label: "Làm chiều",
    subLabel: "Nghỉ sáng",
    badgeClass: "bg-amber-50 text-amber-800 border-amber-200",
    activeClass: "bg-[#eab308] text-slate-900 border-[#ca8a04] shadow-sm",
  },
  {
    key: "OFF",
    label: "Nghỉ cả ngày",
    subLabel: "Nghỉ trọn vẹn",
    badgeClass: "bg-rose-50 text-rose-700 border-rose-200",
    activeClass: "bg-[#ef4444] text-white border-[#dc2626] shadow-sm",
  },
];

const REASON_PRESETS = [
  "Đi học",
  "Học trên trường",
  "Bận thi học kỳ",
  "Lịch học cố định",
  "Bận việc gia đình",
];

const DAY_NAMES_FULL = [
  "Chủ nhật",
  "Thứ Hai",
  "Thứ Ba",
  "Thứ Tư",
  "Thứ Năm",
  "Thứ Sáu",
  "Thứ Bảy",
];

// Helper tìm Thứ 2 đầu tuần
function getMonday(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(date.setDate(diff));
}

export default function StudentScheduleModal({
  isOpen,
  onClose,
  users,
  currentUser,
  initialUserId,
  initialDate,
  existingLeaves,
  onSaved,
}: StudentScheduleModalProps) {
  const isManager = currentUser ? isManagerUp(currentUser.role) || currentUser.role === "ADMIN" : false;

  const [selectedUserId, setSelectedUserId] = useState<number>(
    initialUserId || currentUser?.id || (users[0]?.id ?? 0)
  );
  const [currentWeekDate, setCurrentWeekDate] = useState<Date>(
    initialDate ? new Date(initialDate) : new Date()
  );

  // Danh sách các ngày trong tuần (Thứ 2 -> Thứ 7)
  const weekDays = useMemo(() => {
    const monday = getMonday(currentWeekDate);
    const list: { date: Date; dateStr: string; dayName: string; isToday: boolean }[] = [];
    const todayStr = dateLocal(new Date());

    // Lấy 6 ngày: Thứ 2 đến Thứ 7 (có thể thêm Chủ nhật nếu cần)
    for (let i = 0; i < 6; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const str = dateLocal(d);
      list.push({
        date: d,
        dateStr: str,
        dayName: DAY_NAMES_FULL[d.getDay()],
        isToday: str === todayStr,
      });
    }
    return list;
  }, [currentWeekDate]);

  // Trạng thái ca và lý do cho từng ngày trong tuần
  const [daySchedules, setDaySchedules] = useState<Record<string, { shift: StudentShift; reason: string }>>({});
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");

  // Đồng bộ lịch hiện tại của user trong tuần đang chọn
  useEffect(() => {
    if (!isOpen) return;
    const initialMap: Record<string, { shift: StudentShift; reason: string }> = {};

    weekDays.forEach((w) => {
      // Tìm đơn nghỉ phép trong ngày này
      const leave = existingLeaves.find(
        (l) =>
          l.user_id === selectedUserId &&
          l.status === "APPROVED" &&
          l.from_date <= w.dateStr &&
          l.to_date >= w.dateStr
      );

      if (!leave) {
        initialMap[w.dateStr] = { shift: "ALL_DAY", reason: "" };
      } else {
        const type = (leave.leave_type || "FULL").toUpperCase();
        if (type === "AFTERNOON") {
          initialMap[w.dateStr] = {
            shift: "MORNING_ONLY",
            reason: leave.reason || "Đi học (Nghỉ chiều)",
          };
        } else if (type === "MORNING") {
          initialMap[w.dateStr] = {
            shift: "AFTERNOON_ONLY",
            reason: leave.reason || "Đi học (Nghỉ sáng)",
          };
        } else {
          initialMap[w.dateStr] = {
            shift: "OFF",
            reason: leave.reason || "Đi học (Nghỉ cả ngày)",
          };
        }
      }
    });

    setDaySchedules(initialMap);
    setSuccessMsg("");
  }, [isOpen, selectedUserId, weekDays, existingLeaves]);

  if (!isOpen) return null;

  const handlePrevWeek = () => {
    const d = new Date(currentWeekDate);
    d.setDate(d.getDate() - 7);
    setCurrentWeekDate(d);
  };

  const handleNextWeek = () => {
    const d = new Date(currentWeekDate);
    d.setDate(d.getDate() + 7);
    setCurrentWeekDate(d);
  };

  const handleThisWeek = () => {
    setCurrentWeekDate(new Date());
  };

  const setShiftForDay = (dateStr: string, shift: StudentShift) => {
    setDaySchedules((prev) => {
      const current = prev[dateStr] || { shift: "ALL_DAY", reason: "" };
      let defaultReason = current.reason;
      if (!defaultReason && shift !== "ALL_DAY") {
        defaultReason = "Đi học";
      }
      return {
        ...prev,
        [dateStr]: { shift, reason: defaultReason },
      };
    });
  };

  const setReasonForDay = (dateStr: string, reason: string) => {
    setDaySchedules((prev) => ({
      ...prev,
      [dateStr]: {
        ...(prev[dateStr] || { shift: "ALL_DAY" }),
        reason,
      },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setSuccessMsg("");
    try {
      const daysPayload: StudentDaySchedule[] = weekDays.map((w) => {
        const item = daySchedules[w.dateStr] || { shift: "ALL_DAY", reason: "" };
        return {
          date: w.dateStr,
          shift: item.shift,
          reason: item.reason,
        };
      });

      const updated = await api.saveStudentWeekSchedule({
        user_id: selectedUserId,
        days: daysPayload,
      });

      onSaved(updated);
      setSuccessMsg("Đã lưu lịch làm việc tuần thành công!");
      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (err: any) {
      alert(err?.message || "Không thể lưu lịch. Vui lòng thử lại!");
    } finally {
      setSaving(false);
    }
  };

  const selectedUserObj = users.find((u) => u.id === selectedUserId);
  const monday = weekDays[0]?.dateStr;
  const saturday = weekDays[weekDays.length - 1]?.dateStr;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 sm:p-4 backdrop-blur-xs">
      <div className="relative flex max-h-[92vh] w-full max-w-3xl flex-col rounded-2xl border border-line bg-white shadow-2xl overflow-hidden">
        {/* ==================== HEADER ==================== */}
        <div className="flex items-center justify-between border-b border-line bg-ink px-4 py-3.5 text-white">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber/20 text-amber">
              <AcademicCapIcon className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                Đăng ký lịch làm việc cho sinh viên
                <span className="rounded-full bg-amber/20 px-2 py-0.5 text-[10px] font-semibold text-amber">
                  Theo tuần
                </span>
              </h2>
              <p className="text-[11px] text-white/70">
                Linh hoạt sắp xếp ca sáng/chiều & ghi rõ lý do nghỉ học trên trường
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-white/70 hover:bg-white/10 hover:text-white transition"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {/* ==================== THANH ĐIỀU KHIỂN: CHỌN NGƯỜI & CHỌN TUẦN ==================== */}
        <div className="grid grid-cols-1 gap-3 border-b border-line bg-slate-50 p-3 sm:grid-cols-2">
          {/* Chọn nhân sự / sinh viên */}
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-muted whitespace-nowrap">
              Nhân sự / Sinh viên:
            </label>
            {isManager ? (
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(Number(e.target.value))}
                className="flex-1 rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs font-bold text-ink outline-none focus:border-steel"
              >
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name} {u.department ? `(${u.department})` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <span className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-bold text-ink">
                {selectedUserObj?.full_name || currentUser?.full_name}
              </span>
            )}
          </div>

          {/* Chọn tuần làm việc */}
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={handlePrevWeek}
              className="rounded-lg border border-line bg-white p-1.5 text-xs text-muted hover:bg-paper transition"
              title="Tuần trước"
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={handleThisWeek}
              className="rounded-lg border border-line bg-white px-2.5 py-1 text-xs font-semibold text-ink hover:bg-paper transition"
            >
              Tuần này
            </button>
            <button
              type="button"
              onClick={handleNextWeek}
              className="rounded-lg border border-line bg-white p-1.5 text-xs text-muted hover:bg-paper transition"
              title="Tuần sau"
            >
              <ChevronRightIcon className="h-4 w-4" />
            </button>
            <span className="ml-1 rounded-lg bg-amber/15 px-2.5 py-1 text-xs font-bold text-amber-deep">
              {monday ? formatDate(monday) : ""} → {saturday ? formatDate(saturday) : ""}
            </span>
          </div>
        </div>

        {/* ==================== DANH SÁCH CÁC NGÀY TRONG TUẦN ==================== */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3">
          {weekDays.map((w) => {
            const current = daySchedules[w.dateStr] || { shift: "ALL_DAY", reason: "" };
            const isOffOrHalf = current.shift !== "ALL_DAY";

            return (
              <div
                key={w.dateStr}
                className={`rounded-xl border transition-all p-3 ${
                  w.isToday
                    ? "border-blue-400 bg-blue-50/30 shadow-xs"
                    : isOffOrHalf
                    ? "border-amber-200 bg-amber-50/20"
                    : "border-slate-200 bg-white"
                }`}
              >
                <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                  {/* Tên thứ và ngày */}
                  <div className="flex items-center gap-2 min-w-[130px]">
                    <div
                      className={`flex h-8 w-8 shrink-0 flex-col items-center justify-center rounded-lg border text-center ${
                        w.isToday
                          ? "border-blue-500 bg-blue-600 text-white font-bold"
                          : "border-slate-200 bg-slate-100 text-slate-700"
                      }`}
                    >
                      <span className="text-[11px] font-bold leading-none">
                        {w.date.getDate()}
                      </span>
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-slate-800">{w.dayName}</span>
                        {w.isToday && (
                          <span className="rounded-full bg-blue-100 px-1.5 py-0.2 text-[9px] font-bold text-blue-700">
                            Hôm nay
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-muted">{formatDate(w.dateStr)}</span>
                    </div>
                  </div>

                  {/* Lựa chọn 4 ca làm */}
                  <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                    {SHIFT_OPTIONS.map((opt) => {
                      const isSelected = current.shift === opt.key;
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => setShiftForDay(w.dateStr, opt.key)}
                          className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-bold transition ${
                            isSelected
                              ? opt.activeClass
                              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                          }`}
                        >
                          <span>{opt.label}</span>
                          {opt.subLabel && (
                            <span
                              className={`text-[9px] font-normal opacity-80 ${
                                isSelected ? "text-white" : "text-muted"
                              }`}
                            >
                              ({opt.subLabel})
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Nhập lý do nghỉ nếu là nửa ngày hoặc nghỉ cả ngày */}
                {isOffOrHalf && (
                  <div className="mt-2.5 rounded-lg border border-amber-200/80 bg-white p-2.5 transition-all">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-[11px] font-semibold text-slate-700 flex items-center gap-1">
                        <span className="text-bad">*</span> Lý do nghỉ ({current.shift === "MORNING_ONLY" ? "nghỉ chiều" : current.shift === "AFTERNOON_ONLY" ? "nghỉ sáng" : "nghỉ cả ngày"}):
                      </span>
                      {/* Gợi ý lý do nhanh */}
                      <div className="hidden sm:flex items-center gap-1">
                        <span className="text-[10px] text-muted mr-0.5">Gợi ý nhanh:</span>
                        {REASON_PRESETS.slice(0, 3).map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => setReasonForDay(w.dateStr, preset)}
                            className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-amber-100 hover:text-amber-900 transition"
                          >
                            {preset}
                          </button>
                        ))}
                      </div>
                    </div>

                    <input
                      type="text"
                      value={current.reason}
                      onChange={(e) => setReasonForDay(w.dateStr, e.target.value)}
                      placeholder="Ví dụ: Đi học trên trường, Bận thi học kỳ, Có việc bận..."
                      className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs text-slate-800 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                    />

                    {/* Chips gợi ý trên mobile */}
                    <div className="mt-1.5 flex flex-wrap sm:hidden items-center gap-1">
                      {REASON_PRESETS.map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setReasonForDay(w.dateStr, preset)}
                          className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-600"
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ==================== FOOTER ==================== */}
        <div className="flex items-center justify-between border-t border-line bg-slate-50 px-4 py-3">
          <div className="text-xs">
            {successMsg ? (
              <span className="inline-flex items-center gap-1 font-bold text-ok">
                <CheckCircleIcon className="h-4 w-4" />
                {successMsg}
              </span>
            ) : (
              <span className="text-[11px] text-muted">
                💡 Lịch đăng ký sẽ tự động hiển thị trực tiếp lên bảng Lịch làm việc.
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-lg border border-line bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-paper transition"
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-amber px-4 py-1.5 text-xs font-bold text-ink hover:bg-amber-deep hover:text-white transition shadow-sm disabled:opacity-50"
            >
              {saving ? "Đang lưu lịch…" : "Lưu đăng ký lịch tuần"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
