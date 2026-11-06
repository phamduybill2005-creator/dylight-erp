"use client";

// Trang Đánh giá 2 chiều (Nhân viên <-> Quản lý trực tiếp) — chấm THEO TỪNG NGÀY
// & TỪNG DỰ ÁN (dự án tùy chọn), TỔNG HỢP THEO TUẦN.
//  - STAFF   : chấm quản lý trực tiếp THEO THÁNG (mỗi tháng 1 phiếu) + xem điểm mình nhận.
//  - KẾ TOÁN : chấm cấp dưới trực tiếp theo ngày/dự án + xem điểm nhân viên chấm mình.
//  - GIÁM ĐỐC / QUẢN TRỊ / QL CẤP CAO / QL CẤP TRUNG: bảng THÁNG (Office time / Project
//    time / Đi muộn) + bấm sao chấm mọi người (TRỪ Giám đốc — không ai chấm Giám đốc) + xuất Excel.
//  Mỗi người (trừ Giám đốc) có mục RIÊNG TƯ "Đánh giá tôi nhận được" theo tháng: ai chấm mình bao nhiêu sao.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { StarIcon } from "@heroicons/react/24/solid";
import { ArrowDownTrayIcon, ChatBubbleLeftRightIcon, ChevronRightIcon, FunnelIcon, LockClosedIcon, UserCircleIcon, FolderIcon } from "@heroicons/react/24/outline";
import AppShell from "@/components/app-shell";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import { api } from "@/lib/api";
import { roleTier, ROLE_LABEL, userRankWeight } from "@/lib/roles";
import { dateLocal, monthLocal, todayLocal } from "@/lib/format";
import { useStickyState } from "@/lib/use-sticky-state";
import { PRESET_DEPARTMENTS } from "@/lib/departments";
import { normalizeDept } from "@/lib/groups";
import { splitDepts } from "@/components/filter-bar";
import type { Evaluation, EvaluationOverviewRow, EvaluationMonthReview, User, Project, Colleague } from "@/lib/types";

const RATING_LABELS: Record<number, string> = {
  1: "Cần xem xét lại",
  2: "Cần cải thiện",
  3: "Đạt",
  4: "Xuất sắc",
  5: "Rất xuất sắc",
};

// Kỳ đánh giá theo TUẦN = ngày Thứ 7 của tuần đó (YYYY-MM-DD).
function weekSaturday(d: Date = new Date()): string {
  const x = new Date(d);
  x.setDate(x.getDate() + (6 - x.getDay())); // CN(0)…T7(6) -> tới Thứ 7 cùng tuần
  return dateLocal(x);
}
// Ngày đầu / ngày cuối của tháng "YYYY-MM".
function monthRange(m: string): [string, string] {
  const [y, mo] = m.split("-").map(Number);
  const last = new Date(y, mo, 0).getDate();
  return [`${m}-01`, `${m}-${String(last).padStart(2, "0")}`];
}
// Vai trò dùng BẢNG ĐÁNH GIÁ THÁNG (chấm được mọi người trừ Giám đốc) — khớp _TABLE_ROLES ở backend.
const MONTH_TABLE_ROLES: string[] = ["DIRECTOR", "ADMIN", "MANAGER", "MANAGER_MID"];
const fmtMonth = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;
const fmtDay = (s?: string | null) =>
  s ? new Date(s + "T00:00:00").toLocaleDateString("vi-VN", { weekday: "short", day: "2-digit", month: "2-digit" }) : "—";
const avgOf = (rs: number[]) => (rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : 0);

function Stars({ value, onChange }: { value: number; onChange?: (n: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={!onChange}
          onClick={() => onChange?.(n === value ? 0 : n)}   // bấm lại đúng sao đang chọn = bỏ sao
          title={onChange && n === value ? "Bấm lại để bỏ sao" : undefined}
          className={onChange ? "transition-transform active:scale-90" : "cursor-default"}
        >
          <StarIcon className={`h-6 w-6 ${n <= value ? "text-amber" : "text-line"}`} />
        </button>
      ))}
    </div>
  );
}

// 5 sao MỜ để chấm nhanh ngay trên bảng: rê chuột xem trước, bấm để lưu; đã chấm
// thì sáng tới số sao đã chọn (bấm sao khác để sửa, bấm lại đúng sao đang chọn để bỏ).
function RateStars({ value, busy, onRate }: { value: number; busy?: boolean; onRate: (n: number) => void }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div className={`inline-flex items-center ${busy ? "opacity-60" : ""}`} onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={busy}
          onMouseEnter={() => setHover(n)}
          onFocus={() => setHover(n)}
          onBlur={() => setHover(0)}
          // Tắt xem trước ngay khi bấm: nếu không, chuột còn nằm trên sao sẽ vẫn tô sáng
          // và trông như bỏ sao chưa ăn.
          onClick={() => { setHover(0); onRate(n); }}
          title={n === value ? "Bấm lại để bỏ sao" : `${n} sao — ${RATING_LABELS[n]}`}
          aria-label={n === value ? "Bỏ sao" : `Chấm ${n} sao`}
          className="p-0.5 transition-transform hover:scale-110 active:scale-90 disabled:cursor-wait"
        >
          <StarIcon className={`h-5 w-5 ${n <= shown ? "text-amber" : "text-line"}`} />
        </button>
      ))}
    </div>
  );
}

// Thẻ 1 phiếu — hiện NGÀY chấm + DỰ ÁN (nếu có) + sao + nhận xét.
function EvalCard({ e, who, showDate = true }: { e: Evaluation; who: "evaluator" | "evaluatee"; showDate?: boolean }) {
  const name = who === "evaluator" ? e.evaluator_name : e.evaluatee_name;
  const isStaff = who === "evaluator"
    ? e.direction === "STAFF_TO_MANAGER"
    : e.direction === "MANAGER_TO_STAFF";
  const roleLabel = isStaff ? "Nhân viên" : "Quản lý";

  return (
    <div className="rounded-xl2 bg-white p-3 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <UserCircleIcon className="h-5 w-5 shrink-0 text-muted" />
          <p className="truncate text-sm font-semibold text-ink">
            {name || "—"}{" "}
            <span className="text-[10px] font-normal text-muted">({roleLabel})</span>
          </p>
        </div>
        {showDate && <span className="shrink-0 text-[11px] text-muted">{fmtDay(e.eval_date)}</span>}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <Stars value={e.rating} />
        <span className="text-[10px] font-bold text-amber-deep bg-amber/10 px-1.5 py-0.5 rounded">
          {RATING_LABELS[e.rating]}
        </span>
        {e.project_name ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-steel/10 px-2 py-0.5 text-[10px] font-semibold text-steel">
            <FolderIcon className="h-3 w-3" />
            {e.project_name}
          </span>
        ) : (
          <span className="rounded-full bg-line px-2 py-0.5 text-[10px] font-semibold text-muted">Chung</span>
        )}
      </div>
      {e.comment && <p className="mt-2 text-xs leading-relaxed text-ink/80">{e.comment}</p>}
    </div>
  );
}

// Giờ khai theo TỪNG DỰ ÁN của 1 người trong tháng (bấm tên ở bảng tháng). Cùng nguồn
// timesheets với cột Project time nên cộng lại bằng đúng số ở cột đó.
type ProjHourRow = { project_id: number; code: string; name: string; hours: number };

function ProjectHoursDetail({ data, label }: { data: ProjHourRow[] | "loading" | "error" | undefined; label: string }) {
  const capLabel = label.charAt(0).toUpperCase() + label.slice(1);
  if (data === undefined || data === "loading") {
    return <p className="ml-6 py-1 text-[11px] text-muted">Đang tải giờ dự án…</p>;
  }
  if (data === "error") {
    return <p className="ml-6 py-1 text-[11px] font-semibold text-bad">Không tải được giờ dự án — bấm lại tên để thử lại.</p>;
  }
  if (data.length === 0) {
    return <p className="ml-6 py-1 text-[11px] text-muted">{capLabel} chưa khai giờ dự án nào.</p>;
  }
  const total = data.reduce((sum, p) => sum + p.hours, 0);
  return (
    <div className="ml-6 max-w-xl">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
        Giờ theo dự án · {label} ({data.length} dự án)
      </p>
      <table className="w-full text-[11px]">
        <tbody>
          {data.map((p) => (
            <tr key={p.project_id} className="border-b border-line/40 last:border-0">
              <td className="w-28 py-1 pr-2 font-mono text-muted">{p.code || "—"}</td>
              <td className="py-1 pr-2 text-ink">{p.name}</td>
              <td className="w-16 py-1 text-right font-semibold text-ink tnum">{p.hours.toFixed(1)}h</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line">
            <td />
            <td className="pt-1 pr-2 text-right text-[10px] font-semibold uppercase text-muted">Tổng</td>
            <td className="pt-1 text-right font-bold text-ink tnum">{total.toFixed(1)}h</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// Mục RIÊNG TƯ: ai đã chấm MÌNH bao nhiêu sao trong tháng đang xem. Chỉ người đăng nhập thấy
// — dữ liệu từ /evaluations/received, backend chỉ trả phiếu có người nhận là chính mình.
function ReceivedSection({ items, month }: { items: Evaluation[]; month: string }) {
  const list = items.filter((e) => (e.eval_date || "").startsWith(month));
  const avg = avgOf(list.map((e) => e.rating));
  return (
    <section className="mt-5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ChatBubbleLeftRightIcon className="h-5 w-5 text-steel" />
          <h2 className="text-sm font-semibold text-ink">
            Đánh giá tôi nhận được — tháng {fmtMonth(month)} ({list.length})
          </h2>
        </div>
        <span className="flex items-center gap-1.5 text-[11px] text-muted">
          {list.length > 0 && (
            <>
              TB <b className="text-amber-deep">{avg.toFixed(1)}★</b> ·
            </>
          )}
          <LockClosedIcon className="h-3.5 w-3.5" />
          Chỉ mình bạn thấy
        </span>
      </div>
      <div className="space-y-2 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0">
        {list.length === 0 ? (
          <p className="rounded-xl2 bg-white p-4 text-center text-xs text-muted shadow-card lg:col-span-2">
            Chưa có ai đánh giá bạn trong tháng này.
          </p>
        ) : (
          list.map((e) => <EvalCard key={e.id} e={e} who="evaluator" showDate={false} />)
        )}
      </div>
    </section>
  );
}

export default function EvaluationsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(api.cachedUser());
  const [loading, setLoading] = useState(true);

  const [received, setReceived] = useState<Evaluation[]>([]);
  const [given, setGiven] = useState<Evaluation[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [colleagues, setColleagues] = useState<Colleague[]>([]);   // để tra tên quản lý (kể cả QL phụ)

  // form state (chấm 1 đối tượng đang chọn) — theo NGÀY + DỰ ÁN.
  const [target, setTarget] = useState<User | null>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [evalDate, setEvalDate] = useState(todayLocal());
  const [evalProjectId, setEvalProjectId] = useState<number | "">("");
  const [mgrKey, setMgrKey] = useState<string>("");   // NHÂN VIÊN: quản lý đang chọn để chấm
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  // director: bảng đánh giá THÁNG
  const [selMonth, setSelMonth] = useStickyState("evaluations.month", monthLocal());   // tháng đang chọn (bảng GĐ / form Nhân viên); nhớ qua F5
  const [overview, setOverview] = useState<EvaluationOverviewRow[]>([]);   // bảng đánh giá tháng
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState("");
  const [overviewKey, setOverviewKey] = useState("");
  const overviewRequest = useRef(0);
  const tableVisit = useRef(0);
  const scoreRevision = useRef(0);
  const savedScores = useRef<Record<string, { revision: number; rowKey: string; field: ScoreField; value: number | null | undefined }>>({});
  const [rateMsg, setRateMsg] = useState("");
  // Lọc theo QUÝ (1–4) của năm đang chọn; "" = xem theo tháng. Quý chỉ XEM cộng dồn; nhập theo tháng.
  const [selQuarter, setSelQuarter] = useStickyState("evaluations.quarter", "");
  // Điểm Giám đốc nhập và số liệu chấm công đã đối soát theo người/tháng.
  const [reviews, setReviews] = useState<Record<string, EvaluationMonthReview>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  // Bấm tên 1 người trong bảng tháng -> mở dòng giờ theo từng dự án (cache theo người + tháng).
  const [openUid, setOpenUid] = useState<number | null>(null);
  const [projHours, setProjHours] = useState<Record<string, ProjHourRow[] | "loading" | "error">>({});
  const [exporting, setExporting] = useState(false);
  // Lọc bảng tháng theo PHÒNG BAN (4 phòng chuẩn như các trang khác); nhớ qua F5.
  const [selDept, setSelDept] = useStickyState("evaluations.dept", "");

  const period = weekSaturday();
  const tier = user ? roleTier(user.role) : "STAFF";
  const usesMonthTable = !!user && MONTH_TABLE_ROLES.includes(user.role);

  // KỲ ĐANG XEM: 1 tháng, hoặc quý (3 tháng) của năm thuộc tháng đang chọn.
  const periodMonths = useMemo(() => {
    const q = Number(selQuarter);
    if (q >= 1 && q <= 4) {
      const y = selMonth.slice(0, 4);
      return [1, 2, 3].map((i) => `${y}-${String((q - 1) * 3 + i).padStart(2, "0")}`);
    }
    return [selMonth];
  }, [selMonth, selQuarter]);
  const isQuarter = periodMonths.length > 1;
  const periodFrom = monthRange(periodMonths[0])[0];
  const periodTo = monthRange(periodMonths[periodMonths.length - 1])[1];
  const periodLabel = isQuarter ? `quý ${selQuarter}/${selMonth.slice(0, 4)}` : `tháng ${fmtMonth(selMonth)}`;

  const tableKey = `${user?.id}:${user?.role}:${periodFrom}:${periodTo}`;
  const currentTableKey = useRef(tableKey);
  currentTableKey.current = tableKey;
  // Cả hai nguồn cùng một kỳ; bỏ qua phản hồi cũ khi đổi kỳ/người hoặc tải lại.
  const reloadOverview = useCallback(async () => {
    if (!usesMonthTable) return;
    const request = ++overviewRequest.current;
    const startedScoreRevision = scoreRevision.current;
    const isCurrent = () => currentTableKey.current === tableKey && overviewRequest.current === request;
    setOverviewLoading(true);
    setOverviewError("");
    try {
      const [rows, revs] = await Promise.all([
        api.evaluationsOverview(periodFrom, periodTo),
        api.evaluationMonthReviews(periodFrom.slice(0, 7), periodTo.slice(0, 7)),
      ]);
      if (!isCurrent()) return;
      setOverview(rows);
      const map: Record<string, EvaluationMonthReview> = {};
      for (const r of revs) map[`${r.user_id}:${r.month}`] = r;
      // Keep score saves acknowledged after this GET started, including newly created rows.
      setReviews((previous) => {
        const merged = { ...map };
        for (const saved of Object.values(savedScores.current)) {
          if (saved.revision <= startedScoreRevision) continue;
          const base = merged[saved.rowKey] ?? previous[saved.rowKey];
          if (base) merged[saved.rowKey] = { ...base, [saved.field]: saved.value };
        }
        return merged;
      });
      setOverviewKey(tableKey);
    } catch (err) {
      if (isCurrent()) setOverviewError(err instanceof Error ? err.message : "Không tải được dữ liệu đánh giá và chấm công.");
    } finally {
      if (isCurrent()) setOverviewLoading(false);
    }
  }, [usesMonthTable, tableKey, periodFrom, periodTo]);

  useEffect(() => {
    setEdits({});
    setSavingKey(null);
    savedScores.current = {};
    void reloadOverview();
    return () => { overviewRequest.current += 1; tableVisit.current += 1; };
  }, [reloadOverview]);

  useAutoRefresh(reloadOverview, { enabled: usesMonthTable, topics: ["attendance", "leave", "schedule", "timesheet"], intervalMs: 20_000 });
  useEffect(() => {
    if (!usesMonthTable) return;
    const refresh = () => { void reloadOverview(); };
    window.addEventListener("attendance-reconciliation-changed", refresh);
    return () => window.removeEventListener("attendance-reconciliation-changed", refresh);
  }, [usesMonthTable, reloadOverview]);

  // Đổi kỳ -> đóng dòng chi tiết đang mở (số của kỳ cũ không còn đúng).
  useEffect(() => { setOpenUid(null); }, [periodFrom, periodTo]);

  async function toggleProjects(uid: number) {
    if (openUid === uid) { setOpenUid(null); return; }
    setOpenUid(uid);
    const key = `${uid}:${periodFrom}:${periodTo}`;
    if (Array.isArray(projHours[key]) || projHours[key] === "loading") return;
    setProjHours((m) => ({ ...m, [key]: "loading" }));
    try {
      const [from, to] = [periodFrom, periodTo];
      const list = await api.timesheets({ from, to, userId: uid });
      const byProject = new Map<number, ProjHourRow>();
      for (const t of list) {
        const row = byProject.get(t.project_id)
          ?? { project_id: t.project_id, code: t.project_code || "", name: t.project_name || `Dự án #${t.project_id}`, hours: 0 };
        row.hours += Number(t.hours || 0);
        byProject.set(t.project_id, row);
      }
      const items = [...byProject.values()].sort((a, b) => b.hours - a.hours);
      setProjHours((m) => ({ ...m, [key]: items }));
    } catch {
      setProjHours((m) => ({ ...m, [key]: "error" }));
    }
  }

  // Chỉ các điểm tổng hợp được nhập; số chấm công luôn lấy từ đối soát.
  type CountField = "late_cp" | "late_kp" | "leave_cp" | "leave_kp";
  type ScoreField = "score_attitude" | "score_quality" | "score_team";
  const REVIEW_MAX: Record<ScoreField, number> = {
    score_attitude: 25, score_quality: 50, score_team: 25,
  };
  // Chỉ Giám đốc nhập, và chỉ khi xem theo THÁNG (quý là cộng dồn chỉ xem).
  const canEditReview = user?.role === "DIRECTOR" && !isQuarter;
  const reviewOf = (uid: number, month: string): EvaluationMonthReview | undefined => reviews[`${uid}:${month}`];
  const fieldValue = (uid: number, month: string, f: CountField | ScoreField): number | null => {
    const r = reviewOf(uid, month);
    const v = r?.[f];
    if (v != null) return Number(v);
    return null;
  };
  type PeriodStats = Record<CountField, number> & Record<ScoreField, number | null> & { result: number | null; scoredMonths: number; pendingSessions: number };
  /** Cộng dồn cả kỳ: số ngày cộng các tháng; % & Kết quả theo quý = trung bình các tháng đã chấm.
   *  Kết quả (%) = Ý thức (tối đa 25%) + Chất lượng CV (tối đa 50%) + Tập thể (tối đa 25%). */
  const statsOf = (uid: number): PeriodStats => {
    const s: PeriodStats = {
      late_cp: 0, late_kp: 0, leave_cp: 0, leave_kp: 0,
      score_attitude: null, score_quality: null, score_team: null, result: null, scoredMonths: 0, pendingSessions: 0,
    };
    let sumA = 0, sumQ = 0, sumT = 0, scored = 0;
    for (const m of periodMonths) {
      s.late_cp += fieldValue(uid, m, "late_cp") ?? 0;
      s.late_kp += fieldValue(uid, m, "late_kp") ?? 0;
      s.leave_cp += fieldValue(uid, m, "leave_cp") ?? 0;
      s.leave_kp += fieldValue(uid, m, "leave_kp") ?? 0;
      s.pendingSessions += reviewOf(uid, m)?.attendance_pending_sessions ?? 0;
      const a = fieldValue(uid, m, "score_attitude");
      const q = fieldValue(uid, m, "score_quality");
      const tt = fieldValue(uid, m, "score_team");
      if (a != null || q != null || tt != null) {
        scored += 1;
        sumA += a ?? 0; sumQ += q ?? 0; sumT += tt ?? 0;
      }
    }
    if (scored > 0) {
      const r1 = (n: number) => Math.round((n / scored) * 10) / 10;
      s.score_attitude = r1(sumA); s.score_quality = r1(sumQ); s.score_team = r1(sumT);
      s.result = r1(sumA + sumQ + sumT);
      s.scoredMonths = scored;
    }
    return s;
  };
  const fmtNum = (n: number) => (Math.round(n * 10) / 10).toLocaleString("vi-VN", { maximumFractionDigits: 1 });

  async function saveReview(uid: number, f: ScoreField) {
    if (!canEditReview || uid === user?.id) return;
    const visit = tableVisit.current;
    const isCurrent = () => currentTableKey.current === tableKey && tableVisit.current === visit;
    const k = `${uid}:${f}`;
    const draft = edits[k];
    if (draft === undefined) return;
    const clear = () => setEdits((s) => { const n = { ...s }; delete n[k]; return n; });
    const txt = draft.replace(/,/g, ".").trim();
    const next = txt === "" ? null : Number(txt);
    if (next !== null && (!Number.isFinite(next) || next < 0 || next > REVIEW_MAX[f])) {
      setRateMsg(`Giá trị không hợp lệ: phần trăm từ 0 đến ${REVIEW_MAX[f]}%.`);
      clear();
      return;
    }
    const curRaw = reviewOf(uid, selMonth)?.[f];
    const cur = curRaw == null ? null : Number(curRaw);
    if (cur === next) { clear(); return; }
    setSavingKey(k);
    setRateMsg("");
    try {
      const res = await api.setEvaluationMonthReview(uid, selMonth, { [f]: next });
      if (!isCurrent()) return;
      const rowKey = `${uid}:${selMonth}`;
      savedScores.current[`${rowKey}:${f}`] = { revision: ++scoreRevision.current, rowKey, field: f, value: res[f] };
      // A score response may predate an attendance refresh; change only the saved score.
      setReviews((m) => {
        const key = `${uid}:${selMonth}`;
        return { ...m, [key]: { ...(m[key] ?? res), [f]: res[f] } };
      });
    } catch (err) {
      if (isCurrent()) setRateMsg(err instanceof Error ? err.message : "Không lưu được ô vừa nhập.");
    } finally {
      if (isCurrent()) { setSavingKey(null); clear(); }
    }
  }

  const reviewInput = (uid: number, f: ScoreField, opts?: { placeholder?: string; title?: string }) => {
    const k = `${uid}:${f}`;
    const stored = reviewOf(uid, selMonth)?.[f];
    const shown = edits[k] ?? (stored == null ? "" : String(Number(stored)));
    return (
      <input
        type="text" inputMode="decimal" value={shown} disabled={savingKey === k}
        onChange={(e) => setEdits((s) => ({ ...s, [k]: e.target.value }))}
        onBlur={() => saveReview(uid, f)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
          if (e.key === "Escape") setEdits((s) => { const n = { ...s }; delete n[k]; return n; });
        }}
        placeholder={opts?.placeholder ?? "—"} title={opts?.title}
        aria-label={f}
        className="w-12 rounded border border-line/70 bg-white px-1 py-0.5 text-center text-[12px] font-semibold text-ink tnum outline-none placeholder:text-slate-400 focus:border-steel disabled:opacity-60"
      />
    );
  };
  /** Muộn: số lần; nghỉ: số ngày (mỗi buổi 0,5 ngày). Sửa tại ngày chấm công. */
  const countCell = (f: CountField, st: PeriodStats) => {
    const v = st[f];
    const kp = f.endsWith("_kp");
    return v > 0
      ? <span className={`font-bold tnum ${kp ? "text-bad" : "text-ink"}`}>{fmtNum(v)}</span>
      : <span className="text-muted">0</span>;
  };
  const pendingHint = (uid: number) => {
    const pending = statsOf(uid).pendingSessions;
    return pending > 0 ? <span className="ml-1 text-[10px] font-medium text-amber-deep" title="Buổi đang chờ dữ liệu, duyệt phép hoặc đối soát; chưa tính là vi phạm">{pending} buổi chờ đối soát</span> : null;
  };
  /** Ô % Tổng hợp (Ý thức / Chất lượng CV / Tập thể). */
  const scoreCell = (uid: number, f: ScoreField, st: PeriodStats, self: boolean) => {
    if (canEditReview && !self) return reviewInput(uid, f, { title: `Nhập phần trăm, tối đa ${REVIEW_MAX[f]}%` });
    const v = st[f];
    return v != null ? <span className="font-semibold text-ink tnum">{fmtNum(v)}%</span> : <span className="text-muted">—</span>;
  };
  const resultCell = (st: PeriodStats) =>
    st.result == null
      ? <span className="text-muted">—</span>
      : (
        <span className="inline-flex items-baseline gap-1">
          <span className="text-sm font-extrabold text-steel tnum">{fmtNum(st.result)}%</span>
          {isQuarter && <span className="text-[10px] text-muted">{st.scoredMonths}/3 th</span>}
        </span>
      );

  // Xuất Excel ĐÚNG bảng đang xem (tháng đang chọn, cùng thứ tự dòng).
  async function exportExcel(rows: EvaluationOverviewRow[]) {
    setExporting(true);
    setRateMsg("");
    try {
      const XLSX = await import("xlsx");   // chỉ nạp khi bấm -> không làm nặng trang
      const r1 = (h: number) => Math.round(h * 10) / 10;
      const headers = [
        "STT", "Họ và tên", "Chức vụ", "Phòng ban",
        "Office time (giờ)", "P time (giờ)", "Muộn CP (lần)", "Muộn KP (lần)", "Nghỉ CP (ngày)", "Nghỉ KP (ngày)",
        "Ý thức (%)", "Chất lượng CV (%)", "Tập thể (%)", "Kết quả (%)", "Chờ đối soát (buổi)",
      ];
      const data = rows.map((r, i) => {
        const st = statsOf(r.user_id);
        return [
          i + 1,
          r.full_name,
          ROLE_LABEL[r.role] || "Nhân viên",
          r.department || "",
          r1(r.office_hours),
          r1(r.project_hours),
          st.late_cp, st.late_kp, st.leave_cp, st.leave_kp,
          st.score_attitude ?? "", st.score_quality ?? "", st.score_team ?? "", st.result ?? "", st.pendingSessions,
        ];
      });
      const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
      ws["!cols"] = [
        { wch: 6 }, { wch: 22 }, { wch: 18 }, { wch: 30 },
        { wch: 16 }, { wch: 13 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
        { wch: 12 }, { wch: 18 }, { wch: 12 }, { wch: 14 }, { wch: 22 },
      ];
      const tag = isQuarter ? `Q${selQuarter}-${selMonth.slice(0, 4)}` : selMonth;
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, `Đánh giá ${tag}`);
      XLSX.writeFile(wb, `Danh_gia_nhan_su_${tag}.xlsx`);
    } catch (err) {
      setRateMsg(err instanceof Error ? `Không xuất được Excel: ${err.message}` : "Không xuất được Excel.");
    } finally {
      setExporting(false);
    }
  }

  useEffect(() => {
    api.me()
      .then((u) => {
        setUser(u);
        const t = roleTier(u.role);
        api.evaluationsReceived().then(setReceived).catch(() => {});
        api.evaluationsGiven().then(setGiven).catch(() => {});
        api.projects().then(setProjects).catch(() => {});
        api.colleagues().then(setColleagues).catch(() => {});
        if (t !== "STAFF") api.users().then(setUsers).catch(() => {});
        setLoading(false);
      })
      .catch(() => router.push("/login"));
  }, [router]);

  // Tự làm mới: ai vừa chấm sao cho mình thì hiện ngay, không phải F5.
  useAutoRefresh(() => {
    api.evaluationsReceived().then(setReceived).catch(() => {});
    api.evaluationsGiven().then(setGiven).catch(() => {});
  }, { enabled: !!user });

  // Cấp dưới trực tiếp (cho quản lý chấm điểm).
  const subordinates = useMemo(
    () => (user ? users.filter((u) => u.manager_id === user.id) : []),
    [users, user]
  );

  // Các phiếu TUẦN NÀY mình đã chấm cho 1 người (mới nhất trước).
  const weekGivenTo = (uid: number) =>
    given.filter((g) => g.evaluatee_id === uid && g.period === period);

  const projectLabel = (p: Project) => `${p.code ? p.code + " · " : ""}${p.name}`;

  function resetForm(keepDateProject = true) {
    setRating(0);
    setComment("");
    if (!keepDateProject) {
      setEvalDate(todayLocal());
      setEvalProjectId("");
    }
  }

  function openTarget(t: User) {
    setTarget((prev) => (prev?.id === t.id ? null : t));
    setMsg("");
    resetForm(false);
  }

  // Gửi 1 phiếu cho evaluatee (dùng chung cho cả 2 chiều). evalDay: ngày ghi phiếu — Quản lý
  // chấm theo ngày đang chọn; Nhân viên chấm theo THÁNG nên truyền ngày 01 của tháng.
  async function submitFor(
    evaluateeId: number,
    projectId: number | null = evalProjectId === "" ? null : Number(evalProjectId),
    evalDay: string = evalDate,
  ) {
    if (rating < 1) { setMsg("Vui lòng chọn số sao."); return; }
    setSaving(true);
    setMsg("");
    try {
      await api.createEvaluation({
        evaluatee_id: evaluateeId,
        eval_date: evalDay,
        project_id: projectId,
        rating,
        comment: comment || null,
      });
      setGiven(await api.evaluationsGiven());
      setMsg("Đã lưu đánh giá.");
      resetForm(true);   // giữ ngày+dự án để chấm tiếp người/việc khác nhanh
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Không lưu được đánh giá.");
    } finally {
      setSaving(false);
    }
  }

  // Khối chọn NGÀY + DỰ ÁN dùng chung cho mọi form chấm.
  function DateProjectPicker() {
    return (
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-[10px] font-semibold text-muted">Ngày</label>
          <input
            type="date"
            value={evalDate}
            max={todayLocal()}
            onChange={(e) => setEvalDate(e.target.value || todayLocal())}
            className="w-full rounded-lg border border-line bg-paper px-2 py-1.5 text-xs outline-none focus:border-steel"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-semibold text-muted">Dự án (tùy chọn)</label>
          <select
            value={evalProjectId}
            onChange={(e) => setEvalProjectId(e.target.value ? Number(e.target.value) : "")}
            className="w-full rounded-lg border border-line bg-paper px-2 py-1.5 text-xs outline-none focus:border-steel"
          >
            <option value="">Chung (không theo dự án)</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{projectLabel(p)}</option>
            ))}
          </select>
        </div>
      </div>
    );
  }

  if (loading || !user) {
    return (
      <AppShell><div className="flex min-h-[70vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-steel border-t-amber" />
      </div></AppShell>
    );
  }

  // ==================== NHÂN VIÊN ====================
  if (tier === "STAFF") {
    // CHỈ chấm: QUẢN LÝ TRỰC TIẾP (chính + phụ) + CHỦ TRÌ các DỰ ÁN MÌNH THAM GIA.
    const cName = (id: number) =>
      colleagues.find((c) => c.id === id)?.full_name
      ?? (id === user.manager_id ? user.manager_name : null)
      ?? `#${id}`;
    const directIds: number[] = [];
    if (user.manager_id) directIds.push(user.manager_id);
    if (user.manager_ids) for (const s of user.manager_ids.split(",")) {
      const n = Number(s.trim());
      if (n && n !== user.id && !directIds.includes(n)) directIds.push(n);
    }
    const mgrOptions: { key: string; mgrId: number; name: string; projectId: number | null; ctx: string }[] = [];
    // Không ai được chấm Giám đốc (backend cũng chặn) -> bỏ khỏi danh sách.
    const isDirector = (id: number) => colleagues.find((c) => c.id === id)?.role === "DIRECTOR";
    for (const id of directIds) if (id !== user.id && !isDirector(id))
      mgrOptions.push({ key: `d${id}`, mgrId: id, name: cName(id) || "Quản lý", projectId: null, ctx: "quản lý trực tiếp" });
    for (const p of projects) {
      if (!p.lead_id || p.lead_id === user.id || isDirector(p.lead_id)) continue;
      if (!(p.members ?? []).some((m) => m.id === user.id)) continue;   // chỉ dự án MÌNH tham gia
      mgrOptions.push({ key: `p${p.id}`, mgrId: p.lead_id, name: p.lead_name || "Chủ trì", projectId: p.id, ctx: `chủ trì · ${projectLabel(p)}` });
    }
    const selMgr = mgrOptions.find((o) => o.key === mgrKey) ?? mgrOptions[0] ?? null;
    const targetMgrId = selMgr?.mgrId ?? null;
    const targetMgrName = selMgr?.name ?? null;
    const targetIsSelf = targetMgrId != null && targetMgrId === user.id;
    const canPickTarget = mgrOptions.length > 0;
    // Phiếu mình đã chấm quản lý này trong THÁNG đang chọn.
    const myMonth = targetMgrId
      ? given.filter((g) => g.evaluatee_id === targetMgrId && (g.eval_date || "").startsWith(selMonth))
      : [];
    return (
      <AppShell>
        <header className="flex items-center gap-2 rounded-xl2 bg-ink p-4 text-white shadow-card lg:p-6">
          <StarIcon className="h-5 w-5 text-amber lg:h-6 lg:w-6" />
          <h1 className="text-base font-bold lg:text-xl">Đánh giá quản lý</h1>
        </header>

        <section className="mt-4 rounded-xl2 bg-white p-4 shadow-card lg:p-6">
          {canPickTarget ? (
            <>
              <p className="text-xs text-muted">
                Chọn <b className="text-ink">quản lý</b> cần chấm — chỉ gồm <b className="text-ink">quản lý trực tiếp</b> + <b className="text-ink">chủ trì các dự án bạn tham gia</b>. Chấm <b className="text-ink">theo tháng</b>: mỗi tháng một phiếu cho mỗi quản lý, gửi lại trong tháng là sửa phiếu đó.
              </p>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-muted">Tháng</label>
                  <input type="month" value={selMonth} max={monthLocal()} onChange={(e) => { setSelMonth(e.target.value || monthLocal()); setMsg(""); }}
                    className="w-full rounded-lg border border-line bg-paper px-2 py-1.5 text-xs outline-none focus:border-steel" />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-muted">Quản lý cần chấm</label>
                  <select value={selMgr?.key ?? ""} onChange={(e) => { setMgrKey(e.target.value); setRating(0); setComment(""); setMsg(""); }}
                    className="w-full rounded-lg border border-line bg-paper px-2 py-1.5 text-xs outline-none focus:border-steel">
                    {mgrOptions.map((o) => (
                      <option key={o.key} value={o.key}>{o.name} — {o.ctx}</option>
                    ))}
                  </select>
                </div>
              </div>

              <p className="mt-3 text-[11px] font-semibold text-muted">Đang chấm:</p>
              <p className="text-base font-bold text-ink">
                {targetMgrName || <span className="text-muted">—</span>}
                {selMgr && <span className="ml-1.5 text-[11px] font-normal text-steel">({selMgr.ctx})</span>}
              </p>
              {targetIsSelf && (
                <p className="mt-0.5 text-[11px] font-semibold text-bad">Đây là chính bạn — không thể tự chấm.</p>
              )}

              <div className="mt-3 flex items-center justify-between">
                <span className="text-[11px] font-semibold text-muted">Mức độ hài lòng</span>
                {rating > 0 && (
                  <span className="text-xs font-bold text-amber-deep bg-amber/10 px-2 py-0.5 rounded">
                    {RATING_LABELS[rating]}
                  </span>
                )}
              </div>
              <div className="mt-1"><Stars value={rating} onChange={setRating} /></div>

              <textarea
                rows={3}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Nhận xét về sự hỗ trợ, phân công, giao tiếp của quản lý…"
                className="mt-2 w-full resize-none rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
              />
              {msg && <p className="mt-2 text-[11px] font-semibold text-steel">{msg}</p>}

              <button
                onClick={() => targetMgrId && submitFor(targetMgrId, selMgr?.projectId ?? null, monthRange(selMonth)[0])}
                disabled={saving || rating < 1 || !targetMgrId || targetIsSelf}
                className="mt-3 w-full rounded-xl2 bg-ink py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving ? "Đang lưu…" : `Gửi đánh giá tháng ${fmtMonth(selMonth)}`}
              </button>

              {myMonth.length > 0 && (
                <div className="mt-4 border-t border-line pt-3">
                  <p className="mb-2 text-[11px] font-semibold text-muted">
                    Tháng {fmtMonth(selMonth)} bạn đã chấm ({myMonth.length}) · TB {avgOf(myMonth.map((g) => g.rating)).toFixed(1)}★
                  </p>
                  <div className="space-y-1.5">
                    {myMonth.map((g) => (
                      <div key={g.id} className="flex items-center justify-between rounded-lg bg-paper px-2.5 py-1.5 text-[11px]">
                        <span className="text-muted">{g.project_name || "Chung"}</span>
                        <span className="flex items-center gap-1.5">
                          <span className="font-semibold text-amber-deep">{RATING_LABELS[g.rating]}</span>
                          <span className="flex items-center gap-0.5 font-semibold text-amber">{g.rating}<StarIcon className="h-3 w-3" /></span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="py-4 text-center text-xs text-muted">
              Bạn chưa có quản lý trực tiếp, cũng chưa tham gia dự án nào có chủ trì để chấm.
            </p>
          )}
        </section>

        <ReceivedSection items={received} month={selMonth} />
      </AppShell>
    );
  }

  // ===== GIÁM ĐỐC / QUẢN TRỊ / QL CẤP CAO / QL CẤP TRUNG: bảng đánh giá THÁNG =====
  if (usesMonthTable) {
    // Bảng tháng gồm chính mình (kể cả Giám đốc); xếp theo cấp bậc rồi tên để hàng
    // không nhảy khi bấm sao. Xuất Excel dùng chính danh sách đang xem.
    // Người thuộc nhiều phòng ("Phòng Bản đồ, Phòng AI") được tính ở TỪNG phòng, giống bộ lọc các trang khác.
    const rows = (overviewKey === tableKey ? overview : [])
      .filter((r) => r.role !== "DIRECTOR" || r.user_id === user.id)
      .filter((r) => !selDept || splitDepts(r.department).map(normalizeDept).includes(selDept))
      .sort((x, y) => userRankWeight(x) - userRankWeight(y) || x.full_name.localeCompare(y.full_name, "vi"));
    const hoursCell = (h: number) =>
      h > 0 ? <span className="font-semibold text-ink">{h.toFixed(1)}h</span> : <span className="text-muted">—</span>;
    return (
      <AppShell>
        <header className="flex items-center gap-2 rounded-xl2 bg-ink p-4 text-white shadow-card lg:p-6">
          <StarIcon className="h-5 w-5 text-amber lg:h-6 lg:w-6" />
          <h1 className="text-base font-bold lg:text-xl">Đánh giá nhân sự</h1>
        </header>

        {/* BẢNG ĐÁNH GIÁ THÁNG: Office time / Project time / Đi muộn + bấm sao để chấm */}
        <section className="mt-4">
          <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-ink">
                Đánh giá nhân sự {periodLabel}{selDept ? ` · ${selDept}` : ""} ({rows.length})
              </h2>
              <p className="mt-0.5 text-[11px] text-muted">
                Cộng cả {isQuarter ? "quý" : "tháng"}: <b className="text-steel">Office time</b> = giờ có mặt theo chấm công (đã trừ nghỉ trưa) · <b className="text-steel">P time</b> = giờ khai ở bảng tiến độ dự án (bấm tên để xem theo từng dự án) · <b className="text-steel">Muộn CP/KP</b> = số lần, <b className="text-steel">Nghỉ CP/KP</b> = số ngày (0,5 ngày/buổi), tự tính từ đối soát chấm công; sửa phép tại ngày chấm công · <b className="text-steel">Tổng hợp</b> nhập theo phần trăm: Ý thức (tối đa 25%) + Chất lượng CV (tối đa 50%) + Tập thể (tối đa 25%) → <b className="text-steel">Kết quả</b> (%).
                {isQuarter ? " Xem theo quý là cộng dồn 3 tháng (% lấy trung bình các tháng đã chấm); muốn nhập thì chọn tháng." : canEditReview ? " Gõ số vào ô rồi Enter hoặc bấm ra ngoài để lưu; xoá trắng để bỏ." : ""}
              </p>
              {rateMsg && <p className="mt-1 text-[11px] font-semibold text-bad">{rateMsg}</p>}
              {overviewError && <p role="alert" className="mt-1 text-[11px] font-semibold text-bad">Không tải được dữ liệu đánh giá: {overviewError}{overviewKey === tableKey ? " · Đang hiển thị dữ liệu lần tải trước." : ""}</p>}
            </div>
            {/* min-w-0 (không shrink-0): trên điện thoại hàng công cụ tự xuống dòng thay vì tràn ngang */}
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 rounded-lg border border-line bg-white px-2 py-1.5">
                <FunnelIcon className="h-3.5 w-3.5 text-muted" />
                <select
                  value={selDept}
                  onChange={(e) => setSelDept(e.target.value)}
                  aria-label="Lọc theo phòng ban"
                  className="bg-transparent text-xs font-medium text-ink outline-none"
                >
                  <option value="">Tất cả phòng ban</option>
                  {PRESET_DEPARTMENTS.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </label>
              <button
                onClick={() => exportExcel(rows)}
                disabled={exporting || overviewLoading || !!overviewError || rows.length === 0}
                className="flex items-center gap-1.5 rounded-xl2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer disabled:cursor-default disabled:opacity-60"
                title={`Xuất file Excel tháng ${fmtMonth(selMonth)}`}
              >
                <ArrowDownTrayIcon className={`h-3.5 w-3.5 ${exporting ? "animate-bounce" : ""}`} />
                {exporting ? "Đang xuất..." : "Xuất Excel"}
              </button>
              <input
                type="month"
                value={selMonth}
                onChange={(e) => e.target.value && setSelMonth(e.target.value)}
                className="rounded-lg border border-line bg-white px-2 py-1.5 text-xs outline-none focus:border-steel"
              />
              <button
                onClick={() => { setSelMonth(monthLocal()); setSelQuarter(""); }}
                className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs font-semibold text-steel hover:bg-paper"
              >
                Tháng này
              </button>
              {/* Quý 1–4 của năm thuộc tháng đang chọn: bấm lại quý đang chọn để quay về xem tháng. */}
              <div className="flex items-center gap-0.5 rounded-lg border border-line bg-white p-0.5" title="Xem cộng dồn theo quý (3 tháng). Nhập % theo từng tháng.">
                {["1", "2", "3", "4"].map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setSelQuarter(selQuarter === q ? "" : q)}
                    className={`rounded px-2 py-1 text-xs font-semibold transition-colors ${selQuarter === q ? "bg-steel text-white" : "text-muted hover:bg-paper"}`}
                  >
                    Quý {q}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {rows.length === 0 ? (
            <p className="rounded-xl2 bg-white p-4 text-center text-xs text-muted shadow-card">
              {overviewError ? "Chưa tải được dữ liệu; vui lòng thử lại." : overviewLoading || overviewKey !== tableKey ? "Đang tải…" : selDept ? `Không có ai thuộc ${selDept}.` : "Chưa có nhân sự nào."}
            </p>
          ) : (
            <>
            <div className="space-y-2 lg:hidden">
              {rows.map((r, i) => (
                <article key={r.user_id} className="overflow-hidden rounded-xl border border-line bg-white shadow-card">
                  <button type="button" onClick={() => toggleProjects(r.user_id)} className="flex min-h-16 w-full items-center gap-2 px-3 py-2.5 text-left" aria-expanded={openUid === r.user_id}>
                    <span className="w-5 shrink-0 text-right font-mono text-xs font-bold text-slate-400">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold text-ink">{r.full_name}{pendingHint(r.user_id)}</span>
                      <span className="block truncate text-[10px] text-muted">{ROLE_LABEL[r.role] || "Nhân viên"}{r.department ? ` · ${r.department}` : ""}</span>
                    </span>
                    <ChevronRightIcon className={`h-4 w-4 shrink-0 text-muted transition-transform ${openUid === r.user_id ? "rotate-90" : ""}`} />
                  </button>
                  {(() => {
                    const st = statsOf(r.user_id);
                    const self = r.user_id === user.id;
                    const box = (label: string, node: ReactNode, extra = "") => (
                      <div className={`px-1.5 py-1.5 ${extra}`}><p className="text-[9px] text-muted">{label}</p><div className="mt-0.5 flex justify-center text-sm">{node}</div></div>
                    );
                    return (
                      <>
                        <div className="grid grid-cols-3 border-y border-line bg-paper/60 text-center">
                          {box("Office", <span className="font-bold text-ink tnum">{r.office_hours.toFixed(1)}h</span>)}
                          {box("P time", <span className="font-bold text-steel tnum">{r.project_hours.toFixed(1)}h</span>, "border-x border-line")}
                          {box("Kết quả", resultCell(st))}
                        </div>
                        <div className="grid grid-cols-4 border-b border-line text-center text-xs">
                          {box("Muộn CP (lần)", countCell("late_cp", st))}
                          {box("Muộn KP (lần)", countCell("late_kp", st), "border-l border-line")}
                          {box("Nghỉ CP (ngày)", countCell("leave_cp", st), "border-l border-line")}
                          {box("Nghỉ KP (ngày)", countCell("leave_kp", st), "border-l border-line")}
                        </div>
                        <div className="grid grid-cols-3 text-center text-xs">
                          {box("Ý thức 25%", scoreCell(r.user_id, "score_attitude", st, self))}
                          {box("Chất lượng CV 50%", scoreCell(r.user_id, "score_quality", st, self), "border-x border-line")}
                          {box("Tập thể 25%", scoreCell(r.user_id, "score_team", st, self))}
                        </div>
                      </>
                    );
                  })()}
                  {openUid === r.user_id && <div className="border-t border-line bg-paper/60 px-3 py-2"><ProjectHoursDetail data={projHours[`${r.user_id}:${periodFrom}:${periodTo}`]} label={periodLabel} /></div>}
                </article>
              ))}
            </div>
            <div className="hidden overflow-x-auto rounded-xl2 bg-white shadow-card lg:block">
              <table className="w-full min-w-[1040px] text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-muted">
                    <th rowSpan={2} className="border-b border-line px-3 py-2 align-bottom font-semibold">Người</th>
                    <th rowSpan={2} className="border-b border-line px-2 py-2 text-center align-bottom font-semibold">Office time</th>
                    <th rowSpan={2} className="border-b border-line px-2 py-2 text-center align-bottom font-semibold" title="Project time — giờ khai ở bảng tiến độ dự án">P time</th>
                    <th rowSpan={2} className="border-b border-l border-line px-2 py-2 text-center align-bottom font-semibold" title="Số lần đi muộn CÓ PHÉP từ đối soát chấm công">Muộn CP (lần)</th>
                    <th rowSpan={2} className="border-b border-line px-2 py-2 text-center align-bottom font-semibold" title="Số lần đi muộn KHÔNG PHÉP từ đối soát chấm công">Muộn KP (lần)</th>
                    <th rowSpan={2} className="border-b border-line px-2 py-2 text-center align-bottom font-semibold" title="Số ngày nghỉ CÓ PHÉP từ đối soát; mỗi buổi 0,5 ngày">Nghỉ CP (ngày)</th>
                    <th rowSpan={2} className="border-b border-line px-2 py-2 text-center align-bottom font-semibold" title="Số ngày nghỉ KHÔNG PHÉP từ đối soát; mỗi buổi 0,5 ngày">Nghỉ KP (ngày)</th>
                    <th colSpan={3} className="border-b border-l border-line bg-paper/60 px-2 py-1.5 text-center font-semibold">Tổng hợp</th>
                    <th rowSpan={2} className="border-b border-l border-line px-2 py-2 text-center align-bottom font-semibold" title="Kết quả (%) = Ý thức + Chất lượng CV + Tập thể">Kết quả</th>
                  </tr>
                  <tr className="border-b border-line text-center text-[10px] uppercase tracking-wide text-muted">
                    <th className="border-l border-line px-2 py-1.5 font-semibold">Ý thức<span className="block text-[9px] font-normal normal-case">25%</span></th>
                    <th className="px-2 py-1.5 font-semibold">Chất lượng CV<span className="block text-[9px] font-normal normal-case">50%</span></th>
                    <th className="px-2 py-1.5 font-semibold">Tập thể<span className="block text-[9px] font-normal normal-case">25%</span></th>
                  </tr>
                </thead>
                <tbody className={overviewLoading ? "opacity-60" : ""}>
                  {rows.map((r, i) => (
                    <Fragment key={r.user_id}>
                    <tr className="border-b border-line/50 last:border-0 hover:bg-paper/60">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <span className="w-4 shrink-0 text-right text-[10px] font-semibold text-muted">{i + 1}</span>
                          <div className="min-w-0">
                            <button
                              type="button"
                              onClick={() => toggleProjects(r.user_id)}
                              aria-expanded={openUid === r.user_id}
                              title="Xem giờ theo từng dự án"
                              className="group flex max-w-full items-center gap-1 text-left"
                            >
                              <span className="truncate font-semibold text-ink group-hover:text-steel group-hover:underline">{r.full_name}</span>
                              {pendingHint(r.user_id)}
                              <ChevronRightIcon className={`h-3 w-3 shrink-0 text-muted transition-transform ${openUid === r.user_id ? "rotate-90" : ""}`} />
                            </button>
                            <p className="truncate text-[10px] text-muted">
                              {ROLE_LABEL[r.role] || "Nhân viên"}{r.department ? ` · ${r.department}` : ""}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center tnum">{hoursCell(r.office_hours)}</td>
                      <td className="px-3 py-2 text-center tnum">{hoursCell(r.project_hours)}</td>
                      {(() => {
                        const st = statsOf(r.user_id);
                        const self = r.user_id === user.id;
                        return (
                          <>
                            <td className="border-l border-line px-2 py-2 text-center tnum">{countCell("late_cp", st)}</td>
                            <td className="px-2 py-2 text-center tnum">{countCell("late_kp", st)}</td>
                            <td className="px-2 py-2 text-center tnum">{countCell("leave_cp", st)}</td>
                            <td className="px-2 py-2 text-center tnum">{countCell("leave_kp", st)}</td>
                            <td className="border-l border-line px-2 py-2 text-center tnum">{scoreCell(r.user_id, "score_attitude", st, self)}</td>
                            <td className="px-2 py-2 text-center tnum">{scoreCell(r.user_id, "score_quality", st, self)}</td>
                            <td className="px-2 py-2 text-center tnum">{scoreCell(r.user_id, "score_team", st, self)}</td>
                            <td className="border-l border-line px-2 py-2 text-center tnum">{resultCell(st)}</td>
                          </>
                        );
                      })()}
                    </tr>
                    {openUid === r.user_id && (
                      <tr className="border-b border-line/50 bg-paper/60">
                        <td colSpan={11} className="px-3 py-2">
                          <ProjectHoursDetail data={projHours[`${r.user_id}:${periodFrom}:${periodTo}`]} label={periodLabel} />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
        </section>

        {/* Mục RIÊNG TƯ: ai đã chấm mình bao nhiêu sao (Giám đốc không nhận đánh giá -> ẩn) */}
        {user.role !== "DIRECTOR" && <ReceivedSection items={received} month={selMonth} />}
      </AppShell>
    );
  }

  // ============ KẾ TOÁN: chấm cấp dưới trực tiếp theo ngày ============
  return (
    <AppShell>
      <header className="flex items-center gap-2 rounded-xl2 bg-ink p-4 text-white shadow-card lg:p-6">
        <StarIcon className="h-5 w-5 text-amber lg:h-6 lg:w-6" />
        <h1 className="text-base font-bold lg:text-xl">Đánh giá nhân viên</h1>
      </header>

      <section className="mt-4">
        <h2 className="mb-2 text-sm font-semibold text-ink">
          Nhân viên cấp dưới ({subordinates.length}) · chấm theo ngày/dự án, gộp tuần
        </h2>
        <div className="space-y-2 lg:grid lg:grid-cols-2 lg:items-start lg:gap-3 lg:space-y-0">
          {subordinates.length === 0 ? (
            <p className="rounded-xl2 bg-white p-4 text-center text-xs text-muted shadow-card lg:col-span-2">
              Bạn chưa có nhân viên cấp dưới trực tiếp.
            </p>
          ) : (
            subordinates.map((u) => {
              const wk = weekGivenTo(u.id);
              const wkAvg = avgOf(wk.map((g) => g.rating));
              return (
                <div key={u.id} className="rounded-xl2 bg-white p-3 shadow-card">
                  <button onClick={() => openTarget(u)} className="flex w-full items-center justify-between text-left">
                    <span className="text-sm font-semibold text-ink">{u.full_name}</span>
                    {wk.length > 0 ? (
                      <span className="flex items-center gap-1 text-xs font-semibold text-amber">
                        {wkAvg.toFixed(1)} <StarIcon className="h-4 w-4" /> <span className="text-[10px] text-muted">({wk.length})</span>
                      </span>
                    ) : (
                      <span className="text-[11px] font-semibold text-steel">Chấm điểm →</span>
                    )}
                  </button>

                  {/* Danh sách phiếu tuần này cho nhân viên */}
                  {wk.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {wk.map((g) => (
                        <div key={g.id} className="flex items-center justify-between rounded-lg bg-paper px-2.5 py-1.5 text-[11px]">
                          <span className="min-w-0 truncate text-muted">{fmtDay(g.eval_date)} · {g.project_name || "Chung"}</span>
                          <span className="flex shrink-0 items-center gap-1.5">
                            <span className="font-semibold text-amber-deep">{RATING_LABELS[g.rating]}</span>
                            <span className="flex shrink-0 items-center gap-0.5 font-semibold text-amber">{g.rating}<StarIcon className="h-3 w-3" /></span>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {target?.id === u.id && (
                    <div className="mt-3 border-t border-line pt-3">
                      {DateProjectPicker()}
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-muted">Mức điểm</span>
                        {rating > 0 && (
                          <span className="text-xs font-bold text-amber-deep bg-amber/10 px-2 py-0.5 rounded">
                            {RATING_LABELS[rating]}
                          </span>
                        )}
                      </div>
                      <div className="mt-1"><Stars value={rating} onChange={setRating} /></div>
                      <textarea
                        rows={3}
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        placeholder="Nhận xét về hiệu quả công việc, thái độ, giờ giấc…"
                        className="mt-2 w-full resize-none rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
                      />
                      {msg && target?.id === u.id && (
                        <p className="mt-1 text-[11px] font-semibold text-steel">{msg}</p>
                      )}
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={() => setTarget(null)}
                          className="flex-1 rounded-xl2 border border-line py-2 text-xs font-semibold text-muted"
                        >
                          Đóng
                        </button>
                        <button
                          onClick={() => submitFor(u.id)}
                          disabled={saving || rating < 1}
                          className="flex-1 rounded-xl2 bg-ink py-2 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          {saving ? "Đang lưu…" : "Lưu phiếu ngày"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </section>

      <section className="mt-5">
        <div className="mb-2 flex items-center gap-2">
          <ChatBubbleLeftRightIcon className="h-5 w-5 text-steel" />
          <h2 className="text-sm font-semibold text-ink">Nhân viên đánh giá tôi</h2>
        </div>
        <div className="space-y-2 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0">
          {received.length === 0 ? (
            <p className="rounded-xl2 bg-white p-4 text-center text-xs text-muted shadow-card lg:col-span-2">
              Chưa có đánh giá nào về bạn.
            </p>
          ) : (
            received.map((e) => <EvalCard key={e.id} e={e} who="evaluator" />)
          )}
        </div>
      </section>
    </AppShell>
  );
}
