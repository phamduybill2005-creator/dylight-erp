"use client";

// BẢNG TIẾN ĐỘ NGÀY kiểu Excel — mỗi CỘT là 1 ngày, mỗi HÀNG là 1 phần việc.
// Nhìn ngang thấy: AI làm GÌ, dải màu kéo dài BAO LÂU, và còn mấy ngày nữa là
// đến hạn hoàn thành dự án (hàng "Toàn dự án" trên cùng + ô đếm ngày bên phải).
// Dữ liệu lấy từ hệ thống Giao việc (Assignment) — mốc ngày do backend tự đóng dấu.

import { useEffect, useMemo, useState } from "react";
import { StarIcon, TableCellsIcon, FunnelIcon } from "@heroicons/react/24/outline";
import { api } from "@/lib/api";
import { dateLocal, formatDate, todayLocal } from "@/lib/format";
import type { Assignment, User } from "@/lib/types";

// Quá dài thì trình duyệt vẽ hàng nghìn ô — cắt còn 370 ngày GẦN NHẤT (vẫn phủ hết
// hôm nay + hạn dự án; chỉ mất phần quá khứ rất xa).
const MAX_DAYS = 370;

// ---- Ngày "YYYY-MM-DD" theo giờ VN (mốc backend là giờ VN trần -> lấy thẳng 10 ký tự đầu) ----
const vnDay = (s?: string | null): string | null => {
  const m = s ? /^(\d{4}-\d{2}-\d{2})/.exec(s) : null;
  return m ? m[1] : null;
};
const toDate = (iso: string): Date => {
  const [y, mo, d] = iso.split("-").map(Number);
  return new Date(y, mo - 1, d);
};
const addDays = (iso: string, n: number): string => {
  const t = toDate(iso);
  return dateLocal(new Date(t.getFullYear(), t.getMonth(), t.getDate() + n));
};
const diffDays = (a: string, b: string): number =>
  Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000);

/** Ngày Thứ 7 của tuần chứa iso (YYYY-MM-DD) — theo giờ địa phương. Dùng lọc "theo tuần". */
const weekSat = (iso: string): string => {
  if (!iso) return "";
  const t = toDate(iso);
  return dateLocal(new Date(t.getFullYear(), t.getMonth(), t.getDate() + (6 - t.getDay())));
};
/** Trạng thái phần việc: chưa làm (ASSIGNED) / đang làm (IN_PROGRESS) / hoàn thành (DONE). */
const statusKey = (a: Assignment): "todo" | "doing" | "done" =>
  a.status === "DONE" ? "done" : a.status === "IN_PROGRESS" ? "doing" : "todo";

/** Nhãn "đã làm hay chưa" cho từng phần việc. */
const ASSIGN_STATUS: Record<"todo" | "doing" | "done", { label: string; cls: string }> = {
  done: { label: "Hoàn thành", cls: "bg-ok/15 text-ok" },
  doing: { label: "Đang làm", cls: "bg-amber/15 text-amber-deep" },
  todo: { label: "Chưa làm", cls: "bg-line text-muted" },
};

type Fill = "done" | "doing" | null;

/** Ô của phần việc `a` tại ngày `d` được tô màu gì (dải Excel). */
function cellFill(a: Assignment, d: string, today: string): Fill {
  const start = vnDay(a.started_at) ?? vnDay(a.created_at);
  if (!start) return null;
  if (a.status === "DONE") {
    const end = vnDay(a.done_at) ?? start;
    return d >= start && d <= end ? "done" : null;
  }
  if (a.status === "IN_PROGRESS" && a.started_at) {
    return d >= start && d <= today ? "doing" : null;
  }
  return null; // chưa bắt đầu -> chỉ chấm mốc ngày giao (vẽ riêng)
}

/** "xong · 3 ngày" / "đang · 5 ngày" / "chưa bắt đầu" — cột BAO LÂU bên phải. */
function durationLabel(a: Assignment, today: string): string {
  const start = vnDay(a.started_at) ?? vnDay(a.created_at);
  if (!start) return "—";
  if (a.status === "DONE") {
    const end = vnDay(a.done_at) ?? start;
    const n = Math.max(0, diffDays(start, end));
    return `xong · ${n === 0 ? "< 1" : n} ngày`;
  }
  if (a.status === "IN_PROGRESS" && a.started_at) {
    const n = Math.max(0, diffDays(start, today));
    return `đang · ${n === 0 ? "< 1" : n} ngày`;
  }
  return "chưa bắt đầu";
}

export default function ProjectScheduleGrid({
  projectId,
  startDate,
  endDate,
  members,
  leadId,
}: {
  projectId: number;
  startDate: string | null;
  endDate: string | null;
  members: User[];
  leadId: number | null;
}) {
  const [rows, setRows] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const today = todayLocal();

  // Bộ lọc: theo tháng "YYYY-MM", theo tuần (chọn 1 ngày -> cả tuần), theo trạng thái.
  const [fMonth, setFMonth] = useState("");
  const [fWeek, setFWeek] = useState("");
  const [fStatus, setFStatus] = useState("");
  const fWeekSat = fWeek ? weekSat(fWeek) : "";
  const fOn = !!(fMonth || fWeek || fStatus);

  useEffect(() => {
    setLoading(true);
    api
      .assignments({ projectId })
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [projectId]);

  const projStart = vnDay(startDate);
  const projEnd = vnDay(endDate);

  // ---- Khung ngày: phủ [ngày bắt đầu DA, hạn DA, mọi mốc việc, hôm nay] ----
  const days = useMemo(() => {
    const marks: string[] = [today];
    if (projStart) marks.push(projStart);
    if (projEnd) marks.push(projEnd);
    for (const a of rows) {
      for (const s of [a.created_at, a.started_at, a.done_at]) {
        const d = vnDay(s);
        if (d) marks.push(d);
      }
    }
    let lo = marks.reduce((x, y) => (y < x ? y : x));
    const hi = marks.reduce((x, y) => (y > x ? y : x));
    if (diffDays(lo, hi) + 1 > MAX_DAYS) lo = addDays(hi, -(MAX_DAYS - 1));
    const out: string[] = [];
    for (let d = lo; d <= hi; d = addDays(d, 1)) out.push(d);
    return out;
  }, [rows, projStart, projEnd, today]);

  // Cột HIỂN THỊ sau khi lọc theo THÁNG / TUẦN (rỗng lọc = giữ nguyên toàn bộ).
  const visibleDays = useMemo(
    () => days.filter((d) => (!fMonth || d.startsWith(fMonth)) && (!fWeekSat || weekSat(d) === fWeekSat)),
    [days, fMonth, fWeekSat],
  );

  const truncated = useMemo(() => {
    const first = days[0];
    if (!first) return false;
    const marks = rows.map((a) => vnDay(a.created_at)).filter(Boolean) as string[];
    if (projStart) marks.push(projStart);
    return marks.some((d) => d < first);
  }, [days, rows, projStart]);

  // Nhóm cột theo THÁNG cho hàng tiêu đề trên cùng.
  const months = useMemo(() => {
    const out: { key: string; label: string; span: number }[] = [];
    for (const d of visibleDays) {
      const key = d.slice(0, 7);
      const last = out[out.length - 1];
      if (last && last.key === key) last.span += 1;
      else out.push({ key, label: `Tháng ${Number(d.slice(5, 7))}/${d.slice(0, 4)}`, span: 1 });
    }
    return out;
  }, [visibleDays]);

  // Người tham gia = thành viên dự án ∪ ai được giao việc; chủ trì lên đầu.
  const people = useMemo(() => {
    const map = new Map<number, { id: number; name: string }>();
    for (const u of members) map.set(u.id, { id: u.id, name: u.full_name });
    for (const a of rows) {
      if (!map.has(a.assignee_id)) map.set(a.assignee_id, { id: a.assignee_id, name: a.assignee_name ?? `#${a.assignee_id}` });
    }
    return Array.from(map.values()).sort((x, y) => {
      if (x.id === leadId) return -1;
      if (y.id === leadId) return 1;
      return x.name.localeCompare(y.name, "vi");
    });
  }, [members, rows, leadId]);

  const byAssignee = useMemo(() => {
    const m = new Map<number, Assignment[]>();
    for (const a of rows) {
      if (fStatus && statusKey(a) !== fStatus) continue;   // lọc theo trạng thái
      const list = m.get(a.assignee_id) ?? [];
      list.push(a);
      m.set(a.assignee_id, list);
    }
    for (const list of m.values()) list.sort((a, b) => a.created_at.localeCompare(b.created_at));
    return m;
  }, [rows, fStatus]);

  // ---- Đếm ngày của TOÀN DỰ ÁN: tổng / đã qua / còn lại (hoặc quá hạn) ----
  const totalDays = projStart && projEnd ? diffDays(projStart, projEnd) + 1 : null;
  const remaining = projEnd ? diffDays(today, projEnd) : null;
  const elapsed = projStart ? Math.max(0, Math.min(diffDays(projStart, today) + 1, totalDays ?? Infinity)) : null;

  if (loading) {
    return <p className="rounded-xl2 bg-white p-6 text-center text-xs text-muted shadow-card">Đang tải bảng tiến độ…</p>;
  }

  const stickyLeft = "sticky left-0 z-10 border-r border-line";
  const stickyRight = "sticky right-0 z-10 border-l border-line";

  return (
    <div className="rounded-xl2 bg-white p-3.5 shadow-card border border-line/40">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase text-muted">
          <TableCellsIcon className="h-4 w-4 text-steel" />
          Bảng tiến độ ngày
        </h3>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted">
          <span className="flex items-center gap-1"><i className="h-2.5 w-4 rounded-sm bg-steel/25" /> thời gian dự án</span>
          <span className="flex items-center gap-1"><i className="h-2.5 w-4 rounded-sm bg-amber/70" /> đang làm</span>
          <span className="flex items-center gap-1"><i className="h-2.5 w-4 rounded-sm bg-ok/60" /> đã xong</span>
          <span className="flex items-center gap-1"><i className="block h-1.5 w-1.5 rounded-full bg-steel" /> ngày giao (chưa bắt đầu)</span>
        </div>
      </div>

      {/* Đếm ngày hoàn thành dự án */}
      <p className="mt-1.5 text-[11px] text-muted">
        {projStart ? <>Bắt đầu <b className="text-ink">{formatDate(projStart)}</b></> : "Chưa đặt ngày bắt đầu"}
        {projEnd ? (
          <>
            {" · "}hạn hoàn thành <b className="text-ink">{formatDate(projEnd)}</b>
            {totalDays !== null && <> (tổng <b className="text-ink tnum">{totalDays}</b> ngày{elapsed !== null && <>, đã qua <b className="text-ink tnum">{elapsed}</b></>})</>}
            {remaining !== null && (
              remaining >= 0 ? (
                <> — còn <b className="text-amber-deep tnum">{remaining}</b> ngày nữa là đến hạn</>
              ) : (
                <> — <b className="text-bad">quá hạn {-remaining} ngày</b></>
              )
            )}
          </>
        ) : (
          <> · chưa đặt hạn hoàn thành (vào <b>Sửa dự án</b> để đặt ngày kết thúc)</>
        )}
      </p>

      {/* Lọc: tìm theo tháng / theo tuần / theo trạng thái */}
      <div className="mt-2.5 flex flex-wrap items-end gap-x-3 gap-y-2 rounded-lg border border-line/70 bg-paper/50 px-3 py-2">
        <span className="flex items-center gap-1 self-center text-[11px] font-semibold text-muted">
          <FunnelIcon className="h-3.5 w-3.5" /> Lọc
        </span>
        <label className="flex flex-1 flex-col gap-0.5 min-w-[130px]">
          <span className="text-[9px] font-semibold uppercase tracking-wide text-muted/70">Tháng</span>
          <input
            type="month"
            value={fMonth}
            onChange={(e) => setFMonth(e.target.value)}
            className="h-8 w-full rounded-md border border-line bg-white px-2 text-[11px] text-ink outline-none focus:border-steel"
          />
        </label>
        <label className="flex flex-1 flex-col gap-0.5 min-w-[130px]">
          <span className="text-[9px] font-semibold uppercase tracking-wide text-muted/70">Tuần (chọn 1 ngày)</span>
          <input
            type="date"
            value={fWeek}
            onChange={(e) => setFWeek(e.target.value)}
            className="h-8 w-full rounded-md border border-line bg-white px-2 text-[11px] text-ink outline-none focus:border-steel"
          />
        </label>
        <label className="flex flex-1 flex-col gap-0.5 min-w-[130px]">
          <span className="text-[9px] font-semibold uppercase tracking-wide text-muted/70">Trạng thái</span>
          <select
            value={fStatus}
            onChange={(e) => setFStatus(e.target.value)}
            className="h-8 w-full rounded-md border border-line bg-white px-2 text-[11px] text-ink outline-none focus:border-steel"
          >
            <option value="">Tất cả</option>
            <option value="todo">Chưa làm</option>
            <option value="doing">Đang làm</option>
            <option value="done">Hoàn thành</option>
          </select>
        </label>
        {fOn && (
          <button
            type="button"
            onClick={() => { setFMonth(""); setFWeek(""); setFStatus(""); }}
            className="self-center rounded-md px-2 py-1 text-[11px] font-semibold text-steel hover:bg-white"
          >
            Xóa lọc
          </button>
        )}
      </div>

      {rows.length === 0 && (
        <p className="mt-3 rounded-lg bg-paper p-4 text-center text-[11px] text-muted">
          Chưa có phần việc nào — sang tab <b>Phân công</b> để giao việc, bảng sẽ tự vẽ dải ngày cho từng người.
        </p>
      )}

      {rows.length > 0 && (fMonth || fWeek) && visibleDays.length === 0 && (
        <p className="mt-3 rounded-lg bg-paper p-4 text-center text-[11px] text-muted">
          Không có ngày nào khớp bộ lọc tháng/tuần.
        </p>
      )}

      {visibleDays.length > 0 && (
      <div className="mt-3 overflow-x-auto">
        <table className="min-w-full border-collapse text-[10px]">
          <thead>
            {/* Hàng 1: tháng */}
            <tr>
              <th className={`${stickyLeft} w-40 min-w-40 max-w-40 bg-paper px-2 py-1 text-left font-semibold text-muted`} rowSpan={2}>
                Người / phần việc
              </th>
              {months.map((m) => (
                <th key={m.key} colSpan={m.span} className="border border-line/60 bg-paper px-1 py-0.5 text-left font-semibold text-steel whitespace-nowrap">
                  {m.label}
                </th>
              ))}
              <th className={`${stickyRight} w-24 min-w-24 bg-paper px-2 py-1 font-semibold text-muted`} rowSpan={2}>
                Bao lâu
              </th>
            </tr>
            {/* Hàng 2: từng ngày */}
            <tr>
              {visibleDays.map((d) => {
                const wd = toDate(d).getDay();
                const isToday = d === today;
                return (
                  <th
                    key={d}
                    title={formatDate(d)}
                    className={`min-w-[34px] border border-line/60 px-1 py-0.5 text-center font-medium tnum ${
                      isToday ? "bg-amber text-white" : wd === 0 || wd === 6 ? "bg-paper text-muted/70" : "bg-white text-muted"
                    }`}
                  >
                    {Number(d.slice(8, 10))}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {/* Hàng TOÀN DỰ ÁN: dải từ ngày bắt đầu đến hạn hoàn thành */}
            {(projStart || projEnd) && (
              <tr>
                <td className={`${stickyLeft} bg-white px-2 py-1 font-bold text-ink`}>⏳ Toàn dự án</td>
                {visibleDays.map((d) => {
                  const inSpan = (!projStart || d >= projStart) && (!projEnd || d <= projEnd);
                  return (
                    <td
                      key={d}
                      className={`border border-line/40 p-0 ${inSpan ? "bg-steel/25" : d === today ? "bg-amber/10" : ""}`}
                    />
                  );
                })}
                <td className={`${stickyRight} bg-white px-2 py-1 text-center font-semibold text-steel tnum`}>
                  {totalDays !== null ? `${totalDays} ngày` : "—"}
                </td>
              </tr>
            )}

            {people.map((p) => {
              const list = byAssignee.get(p.id) ?? [];
              const doneN = list.filter((a) => a.status === "DONE").length;
              const isLead = p.id === leadId;
              return (
                <FragmentRows
                  key={p.id}
                  name={p.name}
                  isLead={isLead}
                  list={list}
                  doneN={doneN}
                  days={visibleDays}
                  today={today}
                  stickyLeft={stickyLeft}
                  stickyRight={stickyRight}
                />
              );
            })}
          </tbody>
        </table>
      </div>
      )}

      {truncated && (
        <p className="mt-1.5 text-[10px] italic text-muted">
          Khoảng thời gian quá dài — chỉ hiển thị {MAX_DAYS} ngày gần nhất.
        </p>
      )}
    </div>
  );
}

// Một NGƯỜI = 1 hàng tên (nền xám) + mỗi phần việc 1 hàng dải ngày.
function FragmentRows({
  name,
  isLead,
  list,
  doneN,
  days,
  today,
  stickyLeft,
  stickyRight,
}: {
  name: string;
  isLead: boolean;
  list: Assignment[];
  doneN: number;
  days: string[];
  today: string;
  stickyLeft: string;
  stickyRight: string;
}) {
  return (
    <>
      <tr>
        <td className={`${stickyLeft} bg-paper px-2 py-1`}>
          <span className="flex items-center gap-1 font-semibold text-ink">
            {isLead && <StarIcon className="h-3 w-3 shrink-0 text-amber" />}
            <span className="truncate">{name}</span>
          </span>
        </td>
        <td colSpan={days.length} className="border border-line/40 bg-paper px-2 py-1 text-left text-muted">
          {list.length === 0 ? "chưa có phần việc" : ""}
        </td>
        <td className={`${stickyRight} bg-paper px-2 py-1 text-center text-muted whitespace-nowrap`}>
          {list.length > 0 ? `${list.length} việc · ${doneN} xong` : "—"}
        </td>
      </tr>
      {list.map((a) => {
        const createdDay = vnDay(a.created_at);
        return (
          <tr key={a.id}>
            <td className={`${stickyLeft} bg-white px-2 py-1`}>
              <span className="block max-w-36 truncate pl-3 text-ink" title={a.title}>
                {a.title}
              </span>
              <span className={`ml-3 mt-0.5 inline-block rounded-full px-1.5 py-0 text-[9px] font-semibold ${ASSIGN_STATUS[statusKey(a)].cls}`}>
                {ASSIGN_STATUS[statusKey(a)].label}
              </span>
            </td>
            {days.map((d) => {
              const fill = cellFill(a, d, today);
              const wd = toDate(d).getDay();
              const base =
                fill === "done" ? "bg-ok/60" : fill === "doing" ? "bg-amber/70" : d === today ? "bg-amber/10" : wd === 0 || wd === 6 ? "bg-paper/70" : "";
              const showDot = !fill && a.status !== "DONE" && !a.started_at && d === createdDay;
              return (
                <td key={d} className={`h-6 border border-line/40 p-0 text-center align-middle ${base}`}>
                  {showDot && <span className="mx-auto block h-1.5 w-1.5 rounded-full bg-steel" />}
                </td>
              );
            })}
            <td className={`${stickyRight} bg-white px-2 py-1 text-center whitespace-nowrap ${a.status === "DONE" ? "text-ok" : a.status === "IN_PROGRESS" ? "text-amber-deep" : "text-muted"}`}>
              {durationLabel(a, today)}
            </td>
          </tr>
        );
      })}
    </>
  );
}
