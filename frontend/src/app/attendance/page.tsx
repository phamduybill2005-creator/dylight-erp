"use client";

// Trang Chấm công.
//  - Nhân viên (STAFF): nút chấm vào/ra, trạng thái hôm nay, lịch sử tháng + tổng giờ.
//  - Quản lý/Giám đốc: bảng chấm công toàn đội theo ngày + tổng hợp giờ làm/đi trễ theo kỳ.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ClockIcon,
  CalendarDaysIcon,
  UsersIcon,
  ArrowUpTrayIcon,
  XMarkIcon,
  ChevronDownIcon,
} from "@heroicons/react/24/outline";
import AppShell from "@/components/app-shell";
import FilterBar, { NO_FILTERS, splitDepts, type Filters } from "@/components/filter-bar";
import { api } from "@/lib/api";
import { roleTier, isSeniorManagerUp } from "@/lib/roles";
import { useNicknames } from "@/lib/nicknames";
import { todayLocal, monthLocal } from "@/lib/format";
import type { Attendance, AttendanceSummary, User } from "@/lib/types";

const todayStr = todayLocal;
const monthStr = monthLocal;
const fmtTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : "—";
const fmtHours = (mins: number) => (mins / 60).toFixed(1) + "h";

// ---------- Nhập chấm công từ file CSV (xuất từ phần mềm máy chấm công) ----------
function detectDelim(line: string): string {
  const c = [
    [",", (line.match(/,/g) || []).length] as [string, number],
    [";", (line.match(/;/g) || []).length] as [string, number],
    ["\t", (line.match(/\t/g) || []).length] as [string, number],
  ];
  c.sort((a, b) => b[1] - a[1]);
  return c[0][1] > 0 ? c[0][0] : ",";
}
function parseCSV(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}
type DateOrder = "dmy" | "mdy";
// Tạo Date theo GIỜ ĐỊA PHƯƠNG (không lệch múi giờ). Hỗ trợ dd/mm/yyyy, mm/dd/yyyy, ISO,
// có/không có AM-PM; TỪ CHỐI (null) ngày-giờ không hợp lệ thay vì để "tràn" sang ngày khác.
function buildDate(yy: number, mon: number, day: number, h: number, mi: number, se: number): Date | null {
  if (yy < 100) yy += 2000;
  if (mon < 1 || mon > 12 || day < 1 || day > 31 || h > 23 || mi > 59 || se > 59) return null;
  const d = new Date(yy, mon - 1, day, h, mi, se);
  // round-trip: loại ngày bị JS tự "cuộn" (vd 31/02 -> 03/03)
  return d.getFullYear() === yy && d.getMonth() === mon - 1 && d.getDate() === day ? d : null;
}
function parseDateTime(dateStr: string, timeStr: string, order: DateOrder = "dmy"): Date | null {
  let s = (dateStr || "").trim();
  if (timeStr && timeStr.trim()) s += " " + timeStr.trim();
  s = s.trim();
  if (!s) return null;
  // tách AM/PM nếu có
  let mer = "";
  const mm = s.match(/\b([AaPp])\.?[Mm]\.?\b/);
  if (mm) { mer = mm[1].toLowerCase(); s = (s.slice(0, mm.index) + s.slice((mm.index || 0) + mm[0].length)).trim(); }
  const applyMer = (h: number) => (mer === "p" && h < 12 ? h + 12 : mer === "a" && h === 12 ? 0 : h);

  // ISO: yyyy-mm-dd [hh:mm[:ss]]
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) return buildDate(+m[1], +m[2], +m[3], applyMer(+(m[4] || 0)), +(m[5] || 0), +(m[6] || 0));

  // dd/mm/yyyy hoặc mm/dd/yyyy (theo `order`)
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const g1 = +m[1], g2 = +m[2];
    const day = order === "mdy" ? g2 : g1;
    const mon = order === "mdy" ? g1 : g2;
    return buildDate(+m[3], mon, day, applyMer(+(m[4] || 0)), +(m[5] || 0), +(m[6] || 0));
  }
  return null;
}
function toLocalISO(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function guessCol(headers: string[], keys: string[]): number {
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase();
    if (keys.some((k) => h.includes(k))) return i;
  }
  return -1;
}

export default function AttendancePage() {
  const router = useRouter();
  const nick = useNicknames();
  const [user, setUser] = useState<User | null>(api.cachedUser());
  const [loading, setLoading] = useState(true);

  // STAFF
  const [myRecords, setMyRecords] = useState<Attendance[]>([]);

  // MANAGER / DIRECTOR
  const [date, setDate] = useState(todayStr());
  const [dayList, setDayList] = useState<Attendance[]>([]);
  const [summary, setSummary] = useState<AttendanceSummary[]>([]);
  const [summaryPeriod, setSummaryPeriod] = useState(monthStr());  // tháng đang xem tổng hợp
  const [allUsers, setAllUsers] = useState<User[]>([]);            // để map người -> phòng ban khi lọc
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);     // lọc tổng hợp theo phòng ban
  // Chi tiết từng ngày của 1 người (mở khi bấm vào người trong bảng tổng hợp).
  const [expandedUser, setExpandedUser] = useState<number | null>(null);
  const [detailRecs, setDetailRecs] = useState<Attendance[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // Nhập chấm công từ file CSV
  const [showImport, setShowImport] = useState(false);
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [hasHeader, setHasHeader] = useState(true);
  const [empCol, setEmpCol] = useState(-1);
  const [dateCol, setDateCol] = useState(-1);
  const [timeCol, setTimeCol] = useState(-1);
  const [dateOrder, setDateOrder] = useState<DateOrder>("dmy");
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState("");

  function resetImport() {
    setShowImport(false);
    setCsvRows([]);
    setEmpCol(-1);
    setDateCol(-1);
    setTimeCol(-1);
    setHasHeader(true);
    setImportMsg("");
  }

  function onCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setImportMsg("");
    if (f.size > 10 * 1024 * 1024) {
      setImportMsg("File quá lớn (tối đa 10MB). Vui lòng kiểm tra lại file CSV.");
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setImportMsg("Không đọc được file (có thể đang bị khóa hoặc lỗi). Vui lòng thử lại.");
    reader.onload = () => {
      const text = String(reader.result || "").replace(/^﻿/, ""); // bỏ BOM UTF-8
      const firstLine = text.split(/\r?\n/)[0] || "";
      const rows = parseCSV(text, detectDelim(firstLine));
      setCsvRows(rows);
      const head = rows[0] || [];
      setEmpCol(guessCol(head, ["mã", "ma ", "cccd", "nhân", "nhan", "employee", "user", "id"]));
      const dc = guessCol(head, ["ngày", "ngay", "date", "thời gian", "thoi gian", "datetime"]);
      setDateCol(dc);
      let tc = guessCol(head, ["giờ", "gio", "time"]);
      if (tc === dc) tc = -1; // cột "Ngày giờ" gộp -> không map nhầm làm cột giờ riêng
      setTimeCol(tc);
    };
    reader.readAsText(f, "utf-8");
  }

  useEffect(() => {
    api.me()
      .then((u) => {
        setUser(u);
        if (!isSeniorManagerUp(u)) {
          api.attendanceMe(monthStr() + "-01", todayStr())
            .then(setMyRecords)
            .catch(() => {})
            .finally(() => setLoading(false));
        } else {
          api.users().then(setAllUsers).catch(() => {});   // cho bộ lọc phòng ban
          setLoading(false);
        }
      })
      .catch(() => router.push("/login"));
  }, [router]);

  // Tải bảng đội theo ngày (chỉ cho Quản trị hệ thống / Giám đốc / Quản lý cấp cao) + poll ~20s.
  useEffect(() => {
    if (!user || !isSeniorManagerUp(user)) return;
    let alive = true;
    const load = () => api.attendanceList({ work_date: date }).then((d) => alive && setDayList(d)).catch(() => {});
    load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 20_000);
    return () => { alive = false; clearInterval(id); };
  }, [user, date]);

  // Tải tổng hợp theo tháng đang chọn (chỉ cho Quản trị hệ thống / Giám đốc / Quản lý cấp cao) + poll ~20s.
  useEffect(() => {
    if (!user || !isSeniorManagerUp(user)) return;
    let alive = true;
    api.attendanceSummary(summaryPeriod).then((d) => alive && setSummary(d)).catch(() => {});
    setExpandedUser(null);   // đổi tháng thì thu gọn chi tiết đang mở
    const id = setInterval(() => {
      // Chỉ làm mới số liệu tổng hợp; KHÔNG đụng expandedUser/detail để không giật khi đang xem chi tiết.
      if (document.visibilityState === "visible") {
        api.attendanceSummary(summaryPeriod).then((d) => alive && setSummary(d)).catch(() => {});
      }
    }, 20_000);
    return () => { alive = false; clearInterval(id); };
  }, [user, summaryPeriod]);

  // Tài khoản khác (Quản lý cấp trung / Kế toán / Nhân viên): poll lịch sử chấm công cá nhân của mình (~20s).
  useEffect(() => {
    if (!user || isSeniorManagerUp(user)) return;
    let alive = true;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") {
        api.attendanceMe(monthStr() + "-01", todayStr()).then((d) => alive && setMyRecords(d)).catch(() => {});
      }
    }, 20_000);
    return () => { alive = false; clearInterval(id); };
  }, [user]);

  // Bấm vào 1 người trong bảng tổng hợp -> mở/đóng chi tiết từng ngày trong tháng.
  async function toggleDetail(userId: number) {
    if (expandedUser === userId) { setExpandedUser(null); return; }
    setExpandedUser(userId);
    setDetailLoading(true);
    try {
      const recs = await api.attendanceList({
        user_id: userId,
        from_date: `${summaryPeriod}-01`,
        to_date: `${summaryPeriod}-31`,
      });
      setDetailRecs(recs);
    } catch {
      setDetailRecs([]);
    } finally {
      setDetailLoading(false);
    }
  }

  // Quản lý cấp cao / Giám đốc / Admin: toggle xóa hoặc đè trạng thái đi trễ
  async function toggleLate(rec: Attendance) {
    const newOverride = !rec.is_late;
    try {
      const updated = await api.updateAttendance(rec.id, { is_late_override: newOverride });
      setDetailRecs((prev) => prev.map((x) => (x.id === rec.id ? { ...x, is_late: updated.is_late, is_late_override: updated.is_late_override } : x)));
      api.attendanceSummary(summaryPeriod).then(setSummary).catch(() => {});
    } catch { /* bỏ qua */ }
  }

  if (loading || !user) {
    return (
      <AppShell><div className="flex min-h-[70vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-steel border-t-amber" />
      </div></AppShell>
    );
  }

  // ==================== CÁ NHÂN (Quản lý cấp trung, Kế toán, Nhân viên) ====================
  if (!isSeniorManagerUp(user)) {
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
  const colNames: string[] = csvRows.length
    ? hasHeader
      ? csvRows[0].map((s) => s.trim() || "(trống)")
      : csvRows[0].map((_, i) => `Cột ${i + 1}`)
    : [];
  const dataRows = hasHeader ? csvRows.slice(1) : csvRows;
  const punches =
    empCol >= 0 && dateCol >= 0
      ? dataRows.flatMap((r) => {
          const ref = (r[empCol] || "").trim();
          const d = parseDateTime(r[dateCol] || "", timeCol >= 0 ? r[timeCol] || "" : "", dateOrder);
          return ref && d ? [{ employee_ref: ref, timestamp: toLocalISO(d) }] : [];
        })
      : [];
  const droppedCount = empCol >= 0 && dateCol >= 0 ? dataRows.length - punches.length : 0;
  const noTimeWarn = punches.length > 0 && punches.every((p) => p.timestamp.endsWith("T00:00:00"));

  // Lọc bảng tổng hợp theo PHÒNG BAN (map user_id -> department qua danh sách nhân sự).
  const deptOfUser = (uid: number) => allUsers.find((u) => u.id === uid)?.department;
  const shownSummary = summary
    .filter((s) => !filters.dept || splitDepts(deptOfUser(s.user_id)).includes(filters.dept))
    .sort((a, b) => b.total_hours - a.total_hours);
  const maxDays = shownSummary.reduce((m, s) => Math.max(m, s.present_days), 0) || 1;

  async function doImport() {
    if (!punches.length) return;
    setImporting(true);
    setImportMsg("");
    try {
      const res = await api.importAttendance(punches);
      setImportMsg(
        `✓ Đã nhập ${res.days_updated} ngày công (khớp ${res.matched}/${res.rows} dòng).` +
          (res.days_no_checkout ? ` · ${res.days_no_checkout} ngày chỉ có 1 mốc (chưa tính được giờ làm).` : "") +
          (res.unmatched.length ? ` Không khớp: ${res.unmatched.join(", ")}` : "")
      );
      api.attendanceList({ work_date: date }).then(setDayList).catch(() => {});
      api.attendanceSummary(summaryPeriod).then(setSummary).catch(() => {});
    } catch (e: unknown) {
      setImportMsg(e instanceof Error ? e.message : "Nhập thất bại.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <AppShell>
      <header className="flex items-center justify-between rounded-xl2 bg-ink p-4 text-white shadow-card lg:p-6">
        <div className="flex items-center gap-2">
          <UsersIcon className="h-5 w-5 text-amber lg:h-6 lg:w-6" />
          <h1 className="text-base font-bold lg:text-xl">Bảng chấm công</h1>
        </div>
        <button
          onClick={() => { setShowImport(true); setImportMsg(""); }}
          className="flex items-center gap-1.5 rounded-xl2 bg-amber px-3 py-2 text-xs font-semibold text-ink"
        >
          <ArrowUpTrayIcon className="h-4 w-4" /> Nhập từ file
        </button>
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
                  <p className="truncate text-sm font-semibold text-ink">{nick(r.user_id, r.user_name) || `#${r.user_id}`}</p>
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

      {/* Tổng hợp tháng — TỔNG QUAN cho Ban Giám đốc */}
      <section className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink lg:text-base">Tổng hợp chấm công</h2>
          <div className="flex items-center gap-1.5 rounded-xl2 bg-white px-2 py-1 shadow-card">
            <CalendarDaysIcon className="h-4 w-4 text-muted" />
            <input
              type="month"
              value={summaryPeriod}
              onChange={(e) => setSummaryPeriod(e.target.value || monthStr())}
              className="bg-transparent text-xs text-ink outline-none"
            />
          </div>
        </div>

        {/* Lọc theo phòng ban */}
        <FilterBar show={{ dept: true }} value={filters} onChange={setFilters} />

        {/* Chi tiết từng người */}
        <div className="mt-3 space-y-2 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0 xl:grid-cols-4">
          {shownSummary.length === 0 ? (
            <p className="rounded-xl2 bg-white p-4 text-center text-xs text-muted shadow-card lg:col-span-2 xl:col-span-4">
              {summary.length === 0 ? "Chưa có dữ liệu tổng hợp cho tháng này." : "Không có nhân sự khớp phòng ban."}
            </p>
          ) : (
            shownSummary.map((s) => {
              const isOpen = expandedUser === s.user_id;
              return (
              <div key={s.user_id} className={`rounded-xl2 bg-white shadow-card border border-line/45 hover:border-teal-500/20 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 ${isOpen ? "lg:col-span-2 xl:col-span-4" : ""}`}>
                <button onClick={() => toggleDetail(s.user_id)} className="block w-full p-3.5 text-left">
                  <div className="flex items-center justify-between gap-2">
                    <p className="flex min-w-0 items-center gap-1 text-sm font-bold text-ink">
                      <ChevronDownIcon className={`h-4 w-4 shrink-0 text-muted transition-transform ${isOpen ? "" : "-rotate-90"}`} />
                      <span className="truncate">{nick(s.user_id, s.full_name)}</span>
                    </p>
                    {s.late_days > 0 && (
                      <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-rose-50 border border-rose-200/50 px-2 py-0.5 text-[10px] font-semibold text-rose-600">
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-rose-500"></span>
                        </span>
                        trễ {s.late_days}
                      </span>
                    )}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-center text-xs">
                    <div className="rounded-lg bg-emerald-50/40 border border-emerald-500/10 p-1.5">
                      <p className="text-[9px] font-medium text-muted">Ngày công</p>
                      <p className="font-bold text-emerald-600 tnum text-sm mt-0.5">{s.present_days}</p>
                    </div>
                    <div className="rounded-lg bg-indigo-50/40 border border-indigo-500/10 p-1.5">
                      <p className="text-[9px] font-medium text-muted">Tổng giờ</p>
                      <p className="font-bold text-indigo-600 tnum text-sm mt-0.5">{s.total_hours.toFixed(1)}h</p>
                    </div>
                  </div>
                </button>

                {/* Chi tiết từng ngày trong tháng (bấm để mở) */}
                {isOpen && (
                  <div className="border-t border-line px-3 pb-3 pt-2">
                    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
                      Chi tiết từng ngày · tháng {summaryPeriod}
                    </p>
                    {detailLoading ? (
                      <p className="py-3 text-center text-xs text-muted">Đang tải…</p>
                    ) : detailRecs.length === 0 ? (
                      <p className="py-3 text-center text-xs text-muted">Không có ngày công nào trong tháng này.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {[...detailRecs]
                          .sort((a, b) => a.work_date.localeCompare(b.work_date))
                          .map((r) => (
                            <div key={r.id} className="flex items-center justify-between gap-2 rounded-lg bg-paper px-2.5 py-1.5 text-xs">
                              <div className="flex flex-1 items-center gap-2 min-w-0">
                                <span className="shrink-0 font-medium text-ink">
                                  {new Date(r.work_date).toLocaleDateString("vi-VN", { weekday: "short", day: "2-digit", month: "2-digit" })}
                                </span>
                                {isSeniorManagerUp(user) ? (
                                  <button
                                    type="button"
                                    onClick={() => toggleLate(r)}
                                    title={r.is_late ? "Bấm để gỡ nhãn đi trễ" : "Bấm để đánh dấu đi trễ"}
                                    className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold transition-colors cursor-pointer ${
                                      r.is_late ? "bg-rose-100 text-rose-600 hover:bg-rose-200" : "bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                                    }`}
                                  >
                                    {r.is_late ? "trễ ✕" : "+ trễ"}
                                  </button>
                                ) : (
                                  r.is_late && <span className="shrink-0 rounded bg-bad/10 px-1 text-[9px] font-semibold text-bad">trễ</span>
                                )}

                                {/* Thanh ghi chú / lý do ẩn bên cạnh ngày */}
                                <input
                                  type="text"
                                  defaultValue={r.note || ""}
                                  onBlur={async (e) => {
                                    const val = e.target.value;
                                    if (val !== (r.note || "")) {
                                      try {
                                        await api.updateAttendance(r.id, { note: val });
                                        setDetailRecs((prev) => prev.map((x) => (x.id === r.id ? { ...x, note: val } : x)));
                                      } catch { /* bỏ qua */ }
                                    }
                                  }}
                                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                                  placeholder={isSeniorManagerUp(user) ? "Ghi lý do / ghi chú…" : (r.note || "")}
                                  readOnly={!isSeniorManagerUp(user)}
                                  className="min-w-0 flex-1 rounded border border-transparent px-2 py-0.5 text-[11px] text-ink outline-none transition-colors hover:border-line focus:border-steel focus:bg-white placeholder:text-muted/40"
                                />
                              </div>
                              <div className="flex shrink-0 items-center gap-3 tnum">
                                <span className="text-ink">{fmtTime(r.check_in)} - {fmtTime(r.check_out)}</span>
                                <span className="font-bold text-steel">{fmtHours(r.worked_minutes)}</span>
                              </div>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              );
            })
          )}
        </div>

        <p className="mt-2 text-[11px] text-muted">
          Nguồn: máy chấm công khuôn mặt (Yunatt) — tự đồng bộ 20:00 hằng ngày (hoặc bấm “Đồng bộ ngay” ở trang Máy chấm công).
        </p>
      </section>

      {/* Nhập chấm công từ file CSV */}
      {showImport && (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink/50 backdrop-blur-sm">
          <div className="flex h-full w-full max-w-lg flex-col bg-paper shadow-2xl animate-slide-in">
            <header className="flex items-center justify-between border-b border-line bg-white px-4 py-3">
              <div className="flex items-center gap-2">
                <ArrowUpTrayIcon className="h-5 w-5 text-steel" />
                <h2 className="text-sm font-bold text-ink">Nhập chấm công từ file</h2>
              </div>
              <button onClick={resetImport} className="rounded-full p-1.5 text-muted hover:bg-paper hover:text-ink">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </header>

            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              <p className="text-xs text-muted">
                Xuất dữ liệu từ phần mềm máy chấm công ra <b className="text-ink">file CSV</b> (Excel → "Lưu thành" .csv) rồi tải lên.
                Cần cột <b className="text-ink">mã nhân viên</b> (= CCCD / email / mã đã nhập ở Nhân sự) và cột <b className="text-ink">ngày giờ</b> quẹt.
              </p>
              <input type="file" accept=".csv,text/csv" onChange={onCsvFile} className="block w-full text-xs" />

              {csvRows.length > 0 && (
                <>
                  <label className="flex items-center gap-2 text-xs text-ink">
                    <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} /> Dòng đầu là tiêu đề
                  </label>
                  <div>
                    <label className="block text-[11px] font-semibold text-muted">Cột mã nhân viên *</label>
                    <select value={empCol} onChange={(e) => setEmpCol(Number(e.target.value))}
                      className="mt-1 w-full rounded-lg border border-line bg-white px-2 py-1.5 text-xs outline-none focus:border-steel">
                      <option value={-1}>— Chọn cột —</option>
                      {colNames.map((c, i) => <option key={i} value={i}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-muted">Cột ngày (hoặc ngày giờ) *</label>
                    <select value={dateCol} onChange={(e) => setDateCol(Number(e.target.value))}
                      className="mt-1 w-full rounded-lg border border-line bg-white px-2 py-1.5 text-xs outline-none focus:border-steel">
                      <option value={-1}>— Chọn cột —</option>
                      {colNames.map((c, i) => <option key={i} value={i}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-muted">Cột giờ (nếu tách riêng cột)</label>
                    <select value={timeCol} onChange={(e) => setTimeCol(Number(e.target.value))}
                      className="mt-1 w-full rounded-lg border border-line bg-white px-2 py-1.5 text-xs outline-none focus:border-steel">
                      <option value={-1}>— Không có —</option>
                      {colNames.map((c, i) => <option key={i} value={i}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-muted">Định dạng ngày</label>
                    <select value={dateOrder} onChange={(e) => setDateOrder(e.target.value as DateOrder)}
                      className="mt-1 w-full rounded-lg border border-line bg-white px-2 py-1.5 text-xs outline-none focus:border-steel">
                      <option value="dmy">Ngày/Tháng/Năm — dd/mm/yyyy</option>
                      <option value="mdy">Tháng/Ngày/Năm — mm/dd/yyyy</option>
                    </select>
                    <p className="mt-1 text-[10px] text-muted">Kiểu ISO (yyyy-mm-dd) tự nhận, không phụ thuộc lựa chọn này.</p>
                  </div>

                  <div className="rounded-lg bg-white p-2.5 shadow-card">
                    <p className="text-[11px] text-muted">
                      Sẽ nhập <b className="text-ink">{punches.length}</b> dòng hợp lệ / {dataRows.length} dòng.
                      {droppedCount > 0 && (
                        <span className="text-bad"> · {droppedCount} dòng bị bỏ (thiếu mã hoặc ngày/giờ không đọc được)</span>
                      )}
                    </p>
                    {punches.length === 0 && dataRows.length > 0 && (
                      <p className="mt-1 text-[11px] font-semibold text-bad">Có thể bạn chọn sai cột ngày/giờ hoặc sai định dạng ngày.</p>
                    )}
                    {noTimeWarn && (
                      <p className="mt-1 text-[11px] font-semibold text-amber-deep">Các dòng không có giờ — chỉ ghi nhận ngày công, không tính được giờ làm.</p>
                    )}
                    {punches.length > 0 && (
                      <div className="mt-1.5 border-t border-line/60 pt-1.5 text-[10px] text-muted">
                        <p className="font-semibold">Xem trước:</p>
                        {punches.slice(0, 3).map((p, i) => (
                          <p key={i} className="font-mono">{p.employee_ref} · {p.timestamp.replace("T", " ")}</p>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
              {importMsg && <p className="text-[11px] font-medium text-ink">{importMsg}</p>}
            </div>

            <footer className="flex gap-2 border-t border-line bg-white p-4">
              <button onClick={resetImport} className="flex-1 rounded-xl2 border border-line py-2.5 text-xs font-semibold text-muted hover:bg-paper">
                Đóng
              </button>
              <button
                onClick={doImport}
                disabled={importing || punches.length === 0}
                className="flex-1 rounded-xl2 bg-ink py-2.5 text-xs font-semibold text-white hover:bg-steel disabled:opacity-50"
              >
                {importing ? "Đang nhập…" : `Nhập ${punches.length} dòng`}
              </button>
            </footer>
          </div>
        </div>
      )}
    </AppShell>
  );
}
