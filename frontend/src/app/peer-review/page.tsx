"use client";

// Tab "ĐÁNH GIÁ" — phiếu chấm ĐỒNG NGHIỆP theo tháng (mọi người TRỪ Giám đốc; Giám đốc được
// chuyển sang /evaluations = Tổng hợp đánh giá). 2 phiếu theo mẫu của sếp, mỗi phiếu 3 tiêu chí 1–5:
//   - Chất lượng công việc: Sản phẩm đúng, ít lỗi / Nộp bài đúng hẹn / Phối hợp với mọi người.
//   - Hòa đồng, tập thể   : Hòa đồng, thân thiện / Tham gia hoạt động tập thể / Tiếp thu góp ý.
// Mỗi phiếu có Tháng · Phòng ban · Đồng nghiệp riêng; chọn người thì phòng ban tự theo người,
// chọn phòng ban thì danh sách người chỉ còn phòng đó (giống tab Tiến độ).
// 1 phiếu / người / tháng / loại — gửi lại trong tháng là sửa phiếu đó.
// Phiếu không công khai với đồng nghiệp; Giám đốc / Quản trị được xem tên người chấm và điểm chi tiết.

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { StarIcon } from "@heroicons/react/24/solid";
import { CheckCircleIcon } from "@heroicons/react/24/outline";
import AppShell from "@/components/app-shell";
import { api } from "@/lib/api";
import { monthLocal } from "@/lib/format";
import { evaluationCanEdit, evaluationCycle, evaluationMonthFromSearch } from "@/lib/evaluation-schedule";
import { useStickyState } from "@/lib/use-sticky-state";
import { PRESET_DEPARTMENTS } from "@/lib/departments";
import { normalizeDept } from "@/lib/groups";
import { splitDepts } from "@/components/filter-bar";
import type { Colleague, PeerReview, User } from "@/lib/types";

import { FORMS, type FormDef } from "@/lib/peer-review-forms";

/** Bảng tiêu chí đặt cạnh phiếu: mô tả mức 1 điểm và 5 điểm để mọi người chấm cùng một thước. */
function RubricCard({ def }: { def: FormDef }) {
  return (
    <aside className="rounded-xl2 border border-line bg-paper/60 p-4 lg:p-5">
      <p className="text-center text-[11px] font-bold uppercase tracking-wide text-ink">
        Điểm {def.title.toLowerCase()} ({def.code})
      </p>
      <p className="mt-1 text-center text-[11px] italic text-muted">{def.note}</p>
      <table className="mt-3 w-full border-collapse text-[11px]">
        <thead>
          <tr className="text-ink">
            <th className="border border-line bg-white px-2 py-1.5 text-left font-bold">Tiêu chí</th>
            <th className="w-[34%] border border-line bg-white px-2 py-1.5 text-left font-bold">1 điểm</th>
            <th className="w-[36%] border border-line bg-white px-2 py-1.5 text-left font-bold">5 điểm</th>
          </tr>
        </thead>
        <tbody>
          {def.criteria.map((c, i) => (
            <tr key={c.label}>
              <td className="border border-line bg-white px-2 py-1.5 font-semibold text-ink">{i + 1}. {c.label}</td>
              <td className="border border-line bg-white px-2 py-1.5 text-bad/90">{c.low}</td>
              <td className="border border-line bg-white px-2 py-1.5 text-ok">{c.high}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </aside>
  );
}
const SCORE_LABEL: Record<number, string> = { 1: "Kém", 2: "Yếu", 3: "Trung bình", 4: "Tốt", 5: "Xuất sắc" };
const fmtMonth = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;
const deptsOf = (c: Colleague) => splitDepts(c.department).map(normalizeDept);
const avgOf = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Thang 1–5: bấm một số để chọn (bấm lại đúng số đang chọn = bỏ chọn). */
function ScorePicker({ value, onChange, disabled, label }: { value: number; onChange: (n: number) => void; disabled?: boolean; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex items-center gap-1.5">
      {[1, 2, 3, 4, 5].map((n) => {
        const on = n === value;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(on ? 0 : n)}
            title={`${n} — ${SCORE_LABEL[n]}`}
            className={`h-8 w-8 rounded-full border text-xs font-bold transition-all active:scale-95 disabled:opacity-50 ${
              on
                ? "border-amber bg-amber text-ink shadow-sm shadow-amber/40"
                : n < value
                  ? "border-amber/50 bg-amber/15 text-amber-deep"
                  : "border-line bg-white text-muted hover:border-amber hover:text-ink"
            }`}
          >
            {n}
          </button>
        );
      })}
      <span className={`ml-1 w-16 text-[10px] font-semibold ${value ? "text-amber-deep" : "text-muted"}`}>
        {value ? SCORE_LABEL[value] : "Chưa chấm"}
      </span>
    </div>
  );
}

function useEvaluationClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const refresh = () => setNow(new Date());
    const dayMs = 24 * 60 * 60 * 1000;
    // Refresh at the next Vietnam midnight even if this form stays open.
    const timer = window.setTimeout(refresh, dayMs - ((now.getTime() + 7 * 60 * 60 * 1000) % dayMs));
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [now]);
  return [now, setNow] as const;
}

/** Một phiếu. `ownDepts` (phiếu Chất lượng công việc) = phòng của NGƯỜI CHẤM: phòng ban khóa theo
 *  phòng mình, chỉ chấm đồng nghiệp cùng phòng; không truyền (phiếu Hòa đồng) thì chọn mọi phòng. */
function ReviewForm({ def, colleagues, ownDepts }: { def: FormDef; colleagues: Colleague[]; ownDepts?: string[] }) {
  const lockedDepts = def.kind === "QUALITY" ? ownDepts ?? [] : null;
  const [now, setNow] = useEvaluationClock();
  const cycle = evaluationCycle(now);
  const requestedMonth = useSearchParams().get("month");
  const [month, setMonth] = useState(cycle.month);
  useEffect(() => {
    setMonth(evaluationMonthFromSearch(requestedMonth === null ? "" : `?month=${encodeURIComponent(requestedMonth)}`));
  }, [cycle.month, requestedMonth]);
  const [dept, setDept] = useStickyState(`peer-review.${def.kind}.dept`, lockedDepts?.[0] ?? "");
  const [personId, setPersonId] = useStickyState(`peer-review.${def.kind}.person`, "");
  const [scores, setScores] = useState<number[]>([0, 0, 0]);
  const [mine, setMine] = useState<{ month: string; status: "loading" | "ready" | "error"; rows: PeerReview[]; error: string }>({ month: "", status: "loading", rows: [], error: "" });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  // A revision also distinguishes leaving and returning to the same ballot while a request is pending.
  const selectionKey = `${month}:${personId}:${requestedMonth}:${cycle.month}`;
  const selection = useRef({ key: selectionKey, revision: 0 });
  const currentMonth = useRef(month);
  currentMonth.current = month;
  if (selection.current.key !== selectionKey) selection.current = { key: selectionKey, revision: selection.current.revision + 1 };
  const revision = selection.current.revision;
  const isCurrentSelection = () => selection.current.revision === revision && selection.current.key === selectionKey;
  const invalidateSelection = () => { selection.current.revision += 1; };
  const ready = mine.month === month && mine.status === "ready";
  const canEdit = evaluationCanEdit(month, now);
  const lockedMessage = `Phiếu tháng ${fmtMonth(month)} đã khóa. Chỉ được gửi, sửa hoặc rút phiếu tháng trước từ ngày 01 đến hết ngày 05 (giờ Việt Nam).`;

  // Không ai chấm Giám đốc (backend cũng chặn) -> bỏ khỏi danh sách.
  const candidates = useMemo(() => colleagues.filter((c) => c.role !== "DIRECTOR"
    && (def.kind === "TEAM" || deptsOf(c).some((d) => ownDepts?.includes(d)))), [colleagues, ownDepts, def.kind]);
  // Phòng ban: 4 phòng chuẩn + phòng khác (nếu có) đang gán cho đồng nghiệp.
  const deptOptions = useMemo(() => {
    if (lockedDepts) return lockedDepts;
    const extra = new Set<string>();
    for (const c of candidates) for (const d of deptsOf(c)) if (d && !PRESET_DEPARTMENTS.includes(d)) extra.add(d);
    return [...PRESET_DEPARTMENTS, ...[...extra].sort((a, b) => a.localeCompare(b, "vi"))];
  }, [candidates, lockedDepts]);
  // Phòng khóa: luôn là một trong các phòng của mình (kể cả khi sessionStorage còn giá trị cũ).
  useEffect(() => {
    if (lockedDepts && !lockedDepts.includes(dept) && dept !== (lockedDepts[0] ?? "")) setDept(lockedDepts[0] ?? "");
  }, [lockedDepts, dept, setDept]);
  const people = useMemo(
    () => candidates
      .filter((c) => !dept || deptsOf(c).includes(dept))
      .sort((a, b) => a.full_name.localeCompare(b.full_name, "vi")),
    [candidates, dept],
  );
  const person = candidates.find((c) => String(c.id) === personId) ?? null;
  const rated = ready ? mine.rows.filter((r) => r.month === month && r.kind === def.kind) : [];
  const existing = person ? rated.find((r) => r.evaluatee_id === person.id) ?? null : null;

  // Phiếu mình đã chấm trong tháng (để điền sẵn và biết đã chấm ai).
  useEffect(() => {
    let alive = true;
    setMine({ month, status: "loading", rows: [], error: "" });
    api.peerReviewsMine(month).then((rows) => {
      if (alive) setMine({ month, status: "ready", rows: rows.filter((r) => r.month === month), error: "" });
    }).catch((err) => {
      if (alive) setMine({ month, status: "error", rows: [], error: err instanceof Error ? err.message : "Không tải được phiếu đánh giá." });
    });
    return () => { alive = false; };
  }, [month, loadAttempt]);

  // Đổi phòng ban mà người đang chọn không thuộc phòng đó -> bỏ chọn người.
  useEffect(() => {
    if (personId && candidates.length && !people.some((c) => String(c.id) === personId)) setPersonId("");
  }, [personId, people, candidates.length, setPersonId]);

  // Đổi người / tháng -> xoá thông báo cũ. (Tách riêng để sau khi LƯU thông báo "Đã lưu" còn hiện.)
  useEffect(() => { setMsg(null); }, [personId, month]);
  // Đổi người / tháng / tải xong phiếu -> điền sẵn điểm đã chấm, chưa có thì trống.
  useEffect(() => {
    setScores(existing ? [...existing.scores] : [0, 0, 0]);
  }, [existing, personId, month]);

  // Chọn người -> phòng ban tự theo người đó (giữ nguyên nếu người này cũng thuộc phòng đang lọc).
  function pickPerson(id: string) {
    if (busy.current || id === personId) return;
    const c = candidates.find((x) => String(x.id) === id);
    if (id && !c) return;
    invalidateSelection();
    setPersonId(id);
    if (!c) return;
    const ds = deptsOf(c);
    if (ds.length && !ds.includes(dept)) setDept(ds.find((d) => def.kind === "TEAM" || ownDepts?.includes(d)) ?? dept);
  }

  async function save() {
    if (busy.current || !isCurrentSelection() || !ready) return;
    if (!evaluationCanEdit(month)) { setNow(new Date()); setMsg({ text: lockedMessage, ok: false }); return; }
    if (!person) { setMsg({ text: "Chọn đồng nghiệp cần đánh giá.", ok: false }); return; }
    if (scores.some((s) => s < 1)) { setMsg({ text: "Chấm đủ 3 tiêu chí rồi mới lưu.", ok: false }); return; }
    busy.current = true;
    setSaving(true);
    setMsg(null);
    try {
      const saved = await api.savePeerReview({ evaluatee_id: person.id, month, kind: def.kind, scores });
      if (isCurrentSelection() && saved.month === month && saved.evaluatee_id === person.id && saved.kind === def.kind) {
        setMine((data) => data.month === month && data.status === "ready" ? { ...data, rows: [saved, ...data.rows.filter((r) => r.id !== saved.id)] } : data);
        setScores([...saved.scores]);
        setMsg({ text: `Đã lưu phiếu tháng ${fmtMonth(month)} cho ${person.full_name}.`, ok: true });
      }
    } catch (err) {
      if (isCurrentSelection()) setMsg({ text: err instanceof Error ? err.message : "Không lưu được phiếu.", ok: false });
    } finally {
      busy.current = false;
      setSaving(false);
      // A read made after navigating back may have preceded this mutation on the server.
      if (!isCurrentSelection() && currentMonth.current === month) setLoadAttempt((n) => n + 1);
    }
  }

  async function withdraw() {
    if (busy.current || !isCurrentSelection() || !ready) return;
    if (!evaluationCanEdit(month)) { setNow(new Date()); setMsg({ text: lockedMessage, ok: false }); return; }
    if (!existing) return;
    busy.current = true;
    setSaving(true);
    try {
      await api.deletePeerReview(existing.id);
      if (isCurrentSelection()) {
        setMine((data) => data.month === month ? { ...data, rows: data.rows.filter((r) => r.id !== existing.id) } : data);
        setScores([0, 0, 0]);
        setMsg({ text: "Đã rút lại phiếu.", ok: true });
      }
    } catch (err) {
      if (isCurrentSelection()) setMsg({ text: err instanceof Error ? err.message : "Không rút lại được phiếu.", ok: false });
    } finally {
      busy.current = false;
      setSaving(false);
      if (!isCurrentSelection() && currentMonth.current === month) setLoadAttempt((n) => n + 1);
    }
  }

  const sel = "w-full rounded-lg border border-line bg-paper px-2 py-1.5 text-xs text-ink outline-none focus:border-steel";
  const complete = scores.every((s) => s >= 1);

  return (
    <section className="rounded-xl2 bg-white p-4 shadow-card lg:p-6">
      <h2 className="text-center text-sm font-bold uppercase tracking-wide text-ink lg:text-base">{def.title}</h2>
      {lockedDepts?.length === 0 && <p role="status" className="mt-3 rounded-lg bg-paper p-3 text-xs text-muted">Bạn chưa được gán phòng ban nên chưa thể chấm Chất lượng công việc.</p>}
      {!canEdit && <p role="status" className="mt-3 rounded-lg bg-paper p-3 text-xs text-muted">{lockedMessage}</p>}
      {mine.month === month && mine.status === "error" ? (
        <div role="alert" className="mt-3 rounded-lg bg-paper p-3 text-xs text-bad">
          Không tải được phiếu đánh giá: {mine.error}{" "}
          <button type="button" onClick={() => { if (!busy.current) setLoadAttempt((n) => n + 1); }} className="font-semibold underline">Thử lại</button>
        </div>
      ) : !ready && <p role="status" className="mt-3 text-xs text-muted">Đang tải phiếu đánh giá…</p>}

      {/* Tháng · Phòng ban · Đồng nghiệp */}
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold text-muted">Tháng</span>
          <input type="month" value={month} max={monthLocal()} disabled={saving} onChange={(e) => {
            const nextMonth = e.target.value || cycle.month;
            if (busy.current || nextMonth === month) return;
            invalidateSelection();
            setMonth(nextMonth);
          }} className={sel} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold text-muted">Phòng ban</span>
          <select
            value={dept}
            onChange={(e) => { if (busy.current || e.target.value === dept) return; invalidateSelection(); setDept(e.target.value); }}
            disabled={saving || (!!lockedDepts && lockedDepts.length <= 1)}
            title={lockedDepts ? "Phiếu này chấm đồng nghiệp cùng phòng với bạn" : undefined}
            className={`${sel} disabled:cursor-default disabled:bg-paper disabled:text-ink`}
          >
            {!lockedDepts && <option value="">Tất cả phòng ban</option>}
            {lockedDepts?.length === 0 && <option value="">Chưa được gán phòng ban</option>}
            {deptOptions.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold text-muted">Đồng nghiệp</span>
          <select value={personId} disabled={saving} onChange={(e) => pickPerson(e.target.value)} className={sel}>
            <option value="">{people.length === 0 && lockedDepts ? "— Chưa có đồng nghiệp cùng phòng —" : "— Chọn đồng nghiệp —"}</option>
            {people.map((c) => {
              const done = rated.some((r) => r.evaluatee_id === c.id);
              return <option key={c.id} value={c.id}>{done ? "✓ " : ""}{c.full_name}{c.department ? ` · ${c.department}` : ""}</option>;
            })}
          </select>
        </label>
      </div>

      {/* 3 tiêu chí, thang 1–5 */}
      <div className="mt-4 divide-y divide-line/60">
        {def.criteria.map(({ label, low, high }, i) => (
          <div key={label} className="flex flex-col gap-1.5 py-2.5 sm:flex-row sm:items-center sm:justify-between" title={`1 điểm: ${low} · 5 điểm: ${high}`}>
            <span className={`text-xs font-semibold ${person ? "text-ink" : "text-muted"}`}>{i + 1}. {label}</span>
            <ScorePicker
              label={label}
              value={ready ? scores[i] ?? 0 : 0}
              disabled={!canEdit || !ready || !person || saving}
              onChange={(n) => { if (!busy.current && ready && canEdit && person && isCurrentSelection()) setScores((s) => s.map((v, j) => (j === i ? n : v))); }}
            />
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className={`min-h-4 text-[11px] font-semibold ${msg ? (msg.ok ? "text-ok" : "text-bad") : "text-muted"}`}>
          {msg
            ? msg.text
            : !ready
              ? ""
              : person
                ? existing
                  ? `Đã chấm ${person.full_name} tháng ${fmtMonth(month)} (TB ${avgOf(existing.scores).toFixed(1)}/5)${canEdit ? " — sửa điểm rồi lưu lại." : "."}`
                  : `Chưa chấm ${person.full_name} tháng ${fmtMonth(month)}.`
                : "Chọn đồng nghiệp để bắt đầu chấm."}
        </p>
        <div className="flex items-center gap-2">
          {existing && (
            <button type="button" onClick={withdraw} disabled={!canEdit || !ready || saving} className="rounded-xl2 border border-line px-3 py-2 text-xs font-semibold text-muted hover:text-bad disabled:opacity-50">
              Rút lại
            </button>
          )}
          <button
            type="button"
            onClick={save}
            disabled={!canEdit || !ready || saving || !person || !complete}
            className="rounded-xl2 bg-ink px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Đang lưu…" : existing ? "Lưu sửa" : `Gửi đánh giá tháng ${fmtMonth(month)}`}
          </button>
        </div>
      </div>

      {/* Đã chấm ai trong tháng — bấm tên để mở lại phiếu đó */}
      {rated.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">Đã chấm tháng {fmtMonth(month)} ({rated.length})</p>
          <div className="flex flex-wrap gap-1.5">
            {rated.map((r) => (
              <button
                key={r.id}
                type="button"
                disabled={saving || !candidates.some((c) => c.id === r.evaluatee_id)}
                onClick={() => pickPerson(String(r.evaluatee_id))}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                  r.evaluatee_id === person?.id ? "border-amber bg-amber/15 text-amber-deep" : "border-line bg-paper text-ink hover:border-amber"
                }`}
              >
                <CheckCircleIcon className="h-3.5 w-3.5 text-ok" />
                {r.evaluatee_name || `#${r.evaluatee_id}`}
                <span className="font-mono text-[10px] text-muted">{avgOf(r.scores).toFixed(1)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export default function PeerReviewPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [colleagues, setColleagues] = useState<Colleague[]>([]);
  const [now] = useEvaluationClock();
  const cycle = evaluationCycle(now);

  useEffect(() => {
    api.me()
      .then((u) => {
        // Giám đốc không chấm đồng nghiệp -> về Tổng hợp đánh giá.
        if (u.role === "DIRECTOR") { router.replace("/evaluations"); return; }
        setUser(u);
        api.colleagues().then(setColleagues).catch(() => {});
      })
      .catch(() => router.push("/login"));
  }, [router]);

  // Phòng của người chấm (có thể nhiều phòng, cách nhau dấu phẩy) — phiếu Chất lượng công việc khóa theo đây.
  const myDepts = useMemo(() => splitDepts(user?.department).map(normalizeDept).filter(Boolean), [user?.department]);

  if (!user) {
    return (
      <AppShell><div className="flex min-h-[70vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-steel border-t-amber" />
      </div></AppShell>
    );
  }

  return (
    <AppShell>
      <header className="flex items-center justify-between gap-2 rounded-xl2 bg-ink p-4 text-white shadow-card lg:p-6">
        <div className="flex items-center gap-2">
          <StarIcon className="h-5 w-5 text-amber lg:h-6 lg:w-6" />
          <div>
            <h1 className="text-base font-bold lg:text-xl">Đánh giá</h1>
            <p className="text-[11px] text-white/90">Đánh giá định kì tháng {cycle.monthLabel}</p>
            <p className="text-[11px] font-semibold text-white/90">Thời hạn: {cycle.startDate} – {cycle.deadline}</p>
            <p className="text-[11px] text-white/70">Chấm đồng nghiệp theo tháng · thang 1–5 · phiếu không công khai với đồng nghiệp; Giám đốc / Quản trị có thể xem chi tiết · Chất lượng công việc chấm người cùng phòng, Hòa đồng chấm mọi phòng</p>
          </div>
        </div>
      </header>

      {/* Mỗi hàng: phiếu bên TRÁI, bảng tiêu chí 1 điểm / 5 điểm bên PHẢI. Chất lượng công việc trên, Hòa đồng tập thể dưới. */}
      <div className="mt-4 space-y-4">
        {FORMS.map((f) => (
          <div key={f.kind} className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <Suspense fallback={<p className="p-4 text-xs text-muted">Đang tải phiếu đánh giá…</p>}>
              <ReviewForm def={f} colleagues={colleagues} ownDepts={f.kind === "QUALITY" ? myDepts : undefined} />
            </Suspense>
            <RubricCard def={f} />
          </div>
        ))}
      </div>
    </AppShell>
  );
}
