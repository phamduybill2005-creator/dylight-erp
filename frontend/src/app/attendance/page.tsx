"use client";

// Trang Chấm công.
//  - Nhân viên (STAFF): nút chấm vào/ra, trạng thái hôm nay, lịch sử tháng + tổng giờ.
//  - Quản lý/Giám đốc: bảng chấm công toàn đội theo ngày + tổng hợp giờ làm/đi trễ theo kỳ.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ClockIcon,
  ArrowRightCircleIcon,
  ArrowLeftEndOnRectangleIcon,
  CalendarDaysIcon,
  UsersIcon,
} from "@heroicons/react/24/outline";
import AppShell from "@/components/app-shell";
import { api } from "@/lib/api";
import { roleTier } from "@/lib/roles";
import type { Attendance, AttendanceSummary, User } from "@/lib/types";

const todayStr = () => new Date().toISOString().split("T")[0];
const monthStr = () => new Date().toISOString().slice(0, 7);
const fmtTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : "—";
const fmtHours = (mins: number) => (mins / 60).toFixed(1) + "h";

export default function AttendancePage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // STAFF
  const [myRecords, setMyRecords] = useState<Attendance[]>([]);
  const [busy, setBusy] = useState(false);

  // MANAGER / DIRECTOR
  const [date, setDate] = useState(todayStr());
  const [dayList, setDayList] = useState<Attendance[]>([]);
  const [summary, setSummary] = useState<AttendanceSummary[]>([]);

  useEffect(() => {
    api.me()
      .then((u) => {
        setUser(u);
        if (roleTier(u.role) === "STAFF") {
          api.attendanceMe(monthStr() + "-01", todayStr())
            .then(setMyRecords)
            .catch(() => {})
            .finally(() => setLoading(false));
        } else {
          setLoading(false);
        }
      })
      .catch(() => router.push("/login"));
  }, [router]);

  // Tải bảng đội theo ngày (cho quản lý/giám đốc)
  useEffect(() => {
    if (!user || roleTier(user.role) === "STAFF") return;
    api.attendanceList({ work_date: date }).then(setDayList).catch(() => {});
  }, [user, date]);

  // Tải tổng hợp kỳ hiện tại (cho quản lý/giám đốc)
  useEffect(() => {
    if (!user || roleTier(user.role) === "STAFF") return;
    api.attendanceSummary(monthStr()).then(setSummary).catch(() => {});
  }, [user]);

  async function punch(kind: "in" | "out") {
    setBusy(true);
    try {
      await (kind === "in" ? api.checkIn() : api.checkOut());
      const recs = await api.attendanceMe(monthStr() + "-01", todayStr());
      setMyRecords(recs);
    } catch {
      /* bỏ qua */
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-steel border-t-amber" />
      </div>
    );
  }

  // ==================== NHÂN VIÊN ====================
  if (roleTier(user.role) === "STAFF") {
    const today = myRecords.find((r) => r.work_date === todayStr());
    const totalMins = myRecords.reduce((a, r) => a + r.worked_minutes, 0);
    const lateDays = myRecords.filter((r) => r.is_late).length;

    return (
      <AppShell>
        <header className="flex items-center gap-2 rounded-xl2 bg-ink p-4 text-white shadow-card lg:p-6">
          <ClockIcon className="h-5 w-5 text-amber lg:h-6 lg:w-6" />
          <h1 className="text-base font-bold lg:text-xl">Chấm công của tôi</h1>
        </header>

        {/* Trạng thái hôm nay */}
        <section className="mt-4 rounded-xl2 bg-white p-4 shadow-card lg:p-6">
          <p className="text-xs text-muted">Hôm nay · {new Date().toLocaleDateString("vi-VN")}</p>
          <div className="mt-3 flex items-center justify-between text-center">
            <div className="flex-1">
              <p className="text-[10px] text-muted">Giờ vào</p>
              <p className="mt-0.5 text-2xl font-bold text-ink tnum">{fmtTime(today?.check_in)}</p>
            </div>
            <div className="h-10 w-px bg-line" />
            <div className="flex-1">
              <p className="text-[10px] text-muted">Giờ ra</p>
              <p className="mt-0.5 text-2xl font-bold text-ink tnum">{fmtTime(today?.check_out)}</p>
            </div>
          </div>
          {today?.is_late && (
            <p className="mt-2 text-center text-[11px] font-semibold text-bad">Hôm nay bạn đi trễ.</p>
          )}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              onClick={() => punch("in")}
              disabled={busy || !!today?.check_in}
              className="flex items-center justify-center gap-1.5 rounded-xl2 bg-ok/90 py-3 text-sm font-semibold text-white disabled:opacity-40"
            >
              <ArrowRightCircleIcon className="h-5 w-5" /> Chấm vào
            </button>
            <button
              onClick={() => punch("out")}
              disabled={busy}
              className="flex items-center justify-center gap-1.5 rounded-xl2 bg-ink py-3 text-sm font-semibold text-white disabled:opacity-40"
            >
              <ArrowLeftEndOnRectangleIcon className="h-5 w-5" /> Chấm ra
            </button>
          </div>
        </section>

        {/* Tổng kết tháng */}
        <section className="mt-4 grid grid-cols-3 gap-3 lg:gap-4">
          <div className="rounded-xl2 bg-white p-3 text-center shadow-card">
            <p className="text-[10px] text-muted">Ngày công</p>
            <p className="mt-1 text-xl font-bold text-ink tnum">{myRecords.filter((r) => r.check_in).length}</p>
          </div>
          <div className="rounded-xl2 bg-white p-3 text-center shadow-card">
            <p className="text-[10px] text-muted">Tổng giờ</p>
            <p className="mt-1 text-xl font-bold text-steel tnum">{fmtHours(totalMins)}</p>
          </div>
          <div className="rounded-xl2 bg-white p-3 text-center shadow-card">
            <p className="text-[10px] text-muted">Đi trễ</p>
            <p className={`mt-1 text-xl font-bold tnum ${lateDays ? "text-bad" : "text-ink"}`}>{lateDays}</p>
          </div>
        </section>

        {/* Lịch sử tháng */}
        <section className="mt-4">
          <h2 className="mb-2 text-sm font-semibold text-ink lg:text-base">Lịch sử tháng này</h2>
          <div className="space-y-2 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0">
            {myRecords.length === 0 ? (
              <p className="rounded-xl2 bg-white p-4 text-center text-xs text-muted shadow-card lg:col-span-2">
                Chưa có dữ liệu chấm công.
              </p>
            ) : (
              myRecords.map((r) => (
                <div key={r.id} className="flex items-center justify-between rounded-xl2 bg-white p-3 shadow-card">
                  <div>
                    <p className="text-sm font-semibold text-ink">
                      {new Date(r.work_date).toLocaleDateString("vi-VN", { weekday: "short", day: "2-digit", month: "2-digit" })}
                    </p>
                    {r.is_late && <span className="text-[10px] font-semibold text-bad">Đi trễ</span>}
                  </div>
                  <div className="flex items-center gap-4 text-right">
                    <div>
                      <p className="text-[9px] text-muted">Vào / Ra</p>
                      <p className="text-xs font-medium text-ink tnum">{fmtTime(r.check_in)} - {fmtTime(r.check_out)}</p>
                    </div>
                    <div>
                      <p className="text-[9px] text-muted">Giờ làm</p>
                      <p className="text-xs font-bold text-steel tnum">{fmtHours(r.worked_minutes)}</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </AppShell>
    );
  }

  // ==================== QUẢN LÝ / GIÁM ĐỐC ====================
  return (
    <AppShell>
      <header className="flex items-center justify-between rounded-xl2 bg-ink p-4 text-white shadow-card lg:p-6">
        <div className="flex items-center gap-2">
          <UsersIcon className="h-5 w-5 text-amber lg:h-6 lg:w-6" />
          <h1 className="text-base font-bold lg:text-xl">Chấm công toàn đội</h1>
        </div>
      </header>

      {/* Bảng theo ngày */}
      <section className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink lg:text-base">Theo ngày</h2>
          <div className="flex items-center gap-1.5 rounded-xl2 bg-white px-2 py-1 shadow-card">
            <CalendarDaysIcon className="h-4 w-4 text-muted" />
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="bg-transparent text-xs text-ink outline-none"
            />
          </div>
        </div>
        <div className="space-y-2 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0">
          {dayList.length === 0 ? (
            <p className="rounded-xl2 bg-white p-4 text-center text-xs text-muted shadow-card lg:col-span-2">
              Không có ai chấm công trong ngày này.
            </p>
          ) : (
            dayList.map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-xl2 bg-white p-3 shadow-card">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{r.user_name || `#${r.user_id}`}</p>
                  {r.is_late && <span className="text-[10px] font-semibold text-bad">Đi trễ</span>}
                </div>
                <div className="flex items-center gap-4 text-right">
                  <div>
                    <p className="text-[9px] text-muted">Vào / Ra</p>
                    <p className="text-xs font-medium text-ink tnum">{fmtTime(r.check_in)} - {fmtTime(r.check_out)}</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-muted">Giờ làm</p>
                    <p className="text-xs font-bold text-steel tnum">{fmtHours(r.worked_minutes)}</p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Tổng hợp kỳ này */}
      <section className="mt-5">
        <h2 className="mb-2 text-sm font-semibold text-ink lg:text-base">Tổng hợp tháng {monthStr()}</h2>
        <div className="space-y-2 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0 xl:grid-cols-3">
          {summary.length === 0 ? (
            <p className="rounded-xl2 bg-white p-4 text-center text-xs text-muted shadow-card lg:col-span-2 xl:col-span-3">
              Chưa có dữ liệu tổng hợp.
            </p>
          ) : (
            summary.map((s) => (
              <div key={s.user_id} className="rounded-xl2 bg-white p-3 shadow-card">
                <p className="text-sm font-semibold text-ink">{s.full_name}</p>
                <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                  <div>
                    <p className="text-[9px] text-muted">Ngày công</p>
                    <p className="font-bold text-ink tnum">{s.present_days}</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-muted">Tổng giờ</p>
                    <p className="font-bold text-steel tnum">{s.total_hours.toFixed(1)}h</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-muted">Đi trễ</p>
                    <p className={`font-bold tnum ${s.late_days ? "text-bad" : "text-ink"}`}>{s.late_days}</p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </AppShell>
  );
}
