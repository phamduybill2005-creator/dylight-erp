"use client";

// Tab "ĐÁNH GIÁ" — phiếu chấm ĐỒNG NGHIỆP theo tháng (mọi người TRỪ Giám đốc; Giám đốc được
// chuyển sang /evaluations = Tổng hợp đánh giá). 2 phiếu theo mẫu của sếp, mỗi phiếu 3 tiêu chí 1–5:
//   - Chất lượng công việc: Sản phẩm đúng, ít lỗi / Nộp bài đúng hẹn / Phối hợp với mọi người.
//   - Hòa đồng, tập thể   : Hòa đồng, thân thiện / Tham gia hoạt động tập thể / Tiếp thu góp ý.
// Mỗi phiếu có Tháng · Phòng ban · Đồng nghiệp riêng; chọn người thì phòng ban tự theo người,
// chọn phòng ban thì danh sách người chỉ còn phòng đó (giống tab Tiến độ).
// 1 phiếu / người / tháng / loại — gửi lại trong tháng là sửa phiếu đó.
// RIÊNG TƯ: chỉ thấy phiếu MÌNH đã chấm; Giám đốc / Quản trị chỉ xem tổng hợp (không biết ai chấm).

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { StarIcon } from "@heroicons/react/24/solid";
import { CheckCircleIcon } from "@heroicons/react/24/outline";
import AppShell from "@/components/app-shell";
import { api } from "@/lib/api";
import { monthLocal } from "@/lib/format";
import { useStickyState } from "@/lib/use-sticky-state";
import { PRESET_DEPARTMENTS } from "@/lib/departments";
import { normalizeDept } from "@/lib/groups";
import { splitDepts } from "@/components/filter-bar";
import type { Colleague, PeerReview, PeerReviewKind, User } from "@/lib/types";

// Mỗi tiêu chí kèm mô tả mức 1 điểm / 5 điểm (bảng tiêu chí của công ty — Phụ lục 2 và 2a).
type Criterion = { label: string; low: string; high: string };
type FormDef = { kind: PeerReviewKind; code: string; title: string; note: string; criteria: Criterion[] };
// Thứ tự tiêu chí = thứ tự scores[0..2] gửi lên backend — đừng đảo.
const FORMS: FormDef[] = [
  {
    kind: "QUALITY", code: "CL", title: "Chất lượng công việc",
    note: "Quản lý và đồng nghiệp cùng dự án chấm hằng tháng, thang 1–5 (3 = Đạt). Tự chấm không tính.",
    criteria: [
      { label: "Sản phẩm đúng, ít lỗi", low: "Thường sai, phải làm lại", high: "Hầu như không lỗi, tự kiểm kỹ" },
      { label: "Nộp bài đúng hẹn", low: "Thường trễ, cả nhóm phải chờ", high: "Luôn đúng hẹn, trễ thì báo sớm" },
      { label: "Phối hợp với mọi người", low: "Khó liên lạc, không hợp tác", high: "Trao đổi rõ, sẵn sàng hỗ trợ" },
    ],
  },
  {
    kind: "TEAM", code: "HN", title: "Hòa đồng, tập thể",
    note: "Toàn thể đồng nghiệp chấm, thang 1–5 (3 = Đạt). Tự chấm không tính, không công bố ai chấm ai.",
    criteria: [
      { label: "Hòa đồng, thân thiện", low: "Khép kín, gắt gỏng", high: "Dễ gần, gắn kết mọi người" },
      { label: "Tham gia hoạt động tập thể", low: "Hầu như không tham gia", high: "Tham gia đầy đủ, góp sức tổ chức" },
      { label: "Tiếp thu góp ý", low: "Phản ứng gay gắt, để bụng", high: "Bình tĩnh trao đổi, tiếp thu và sửa" },
    ],
  },
];

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

/** Một phiếu (Chất lượng công việc / Hòa đồng, tập thể) — tự quản lý Tháng · Phòng ban · Đồng nghiệp của nó. */
function ReviewForm({ def, colleagues }: { def: FormDef; colleagues: Colleague[] }) {
  const [month, setMonth] = useStickyState(`peer-review.${def.kind}.month`, monthLocal());
  const [dept, setDept] = useStickyState(`peer-review.${def.kind}.dept`, "");
  const [personId, setPersonId] = useStickyState(`peer-review.${def.kind}.person`, "");
  const [scores, setScores] = useState<number[]>([0, 0, 0]);
  const [mine, setMine] = useState<PeerReview[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  // Không ai chấm Giám đốc (backend cũng chặn) -> bỏ khỏi danh sách.
  const candidates = useMemo(() => colleagues.filter((c) => c.role !== "DIRECTOR"), [colleagues]);
  // Phòng ban: 4 phòng chuẩn + phòng khác (nếu có) đang gán cho đồng nghiệp.
  const deptOptions = useMemo(() => {
    const extra = new Set<string>();
    for (const c of candidates) for (const d of deptsOf(c)) if (d && !PRESET_DEPARTMENTS.includes(d)) extra.add(d);
    return [...PRESET_DEPARTMENTS, ...[...extra].sort((a, b) => a.localeCompare(b, "vi"))];
  }, [candidates]);
  const people = useMemo(
    () => candidates
      .filter((c) => !dept || deptsOf(c).includes(dept))
      .sort((a, b) => a.full_name.localeCompare(b.full_name, "vi")),
    [candidates, dept],
  );
  const person = candidates.find((c) => String(c.id) === personId) ?? null;
  const rated = mine.filter((r) => r.kind === def.kind);
  const existing = person ? rated.find((r) => r.evaluatee_id === person.id) ?? null : null;

  // Phiếu mình đã chấm trong tháng (để điền sẵn và biết đã chấm ai).
  useEffect(() => {
    let alive = true;
    api.peerReviewsMine(month).then((rows) => { if (alive) setMine(rows); }).catch(() => { if (alive) setMine([]); });
    return () => { alive = false; };
  }, [month]);

  // Đổi phòng ban mà người đang chọn không thuộc phòng đó -> bỏ chọn người.
  useEffect(() => {
    if (personId && candidates.length && !people.some((c) => String(c.id) === personId)) setPersonId("");
  }, [personId, people, candidates.length, setPersonId]);

  // Đổi người / tháng -> xoá thông báo cũ. (Tách riêng để sau khi LƯU thông báo "Đã lưu" còn hiện.)
  useEffect(() => { setMsg(null); }, [personId, month]);
  // Đổi người / tháng / tải xong phiếu -> điền sẵn điểm đã chấm, chưa có thì trống.
  useEffect(() => {
    setScores(existing ? [...existing.scores] : [0, 0, 0]);
  }, [existing?.id, personId, month]); // eslint-disable-line react-hooks/exhaustive-deps

  // Chọn người -> phòng ban tự theo người đó (giữ nguyên nếu người này cũng thuộc phòng đang lọc).
  function pickPerson(id: string) {
    setPersonId(id);
    const c = candidates.find((x) => String(x.id) === id);
    if (!c) return;
    const ds = deptsOf(c);
    if (ds.length && !ds.includes(dept)) setDept(ds[0]);
  }

  async function save() {
    if (!person) { setMsg({ text: "Chọn đồng nghiệp cần đánh giá.", ok: false }); return; }
    if (scores.some((s) => s < 1)) { setMsg({ text: "Chấm đủ 3 tiêu chí rồi mới lưu.", ok: false }); return; }
    setSaving(true);
    setMsg(null);
    try {
      const saved = await api.savePeerReview({ evaluatee_id: person.id, month, kind: def.kind, scores });
      setMine((rows) => [saved, ...rows.filter((r) => r.id !== saved.id)]);
      setMsg({ text: `Đã lưu phiếu tháng ${fmtMonth(month)} cho ${person.full_name}.`, ok: true });
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : "Không lưu được phiếu.", ok: false });
    } finally {
      setSaving(false);
    }
  }

  async function withdraw() {
    if (!existing) return;
    setSaving(true);
    try {
      await api.deletePeerReview(existing.id);
      setMine((rows) => rows.filter((r) => r.id !== existing.id));
      setScores([0, 0, 0]);
      setMsg({ text: "Đã rút lại phiếu.", ok: true });
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : "Không rút lại được phiếu.", ok: false });
    } finally {
      setSaving(false);
    }
  }

  const sel = "w-full rounded-lg border border-line bg-paper px-2 py-1.5 text-xs text-ink outline-none focus:border-steel";
  const complete = scores.every((s) => s >= 1);

  return (
    <section className="rounded-xl2 bg-white p-4 shadow-card lg:p-6">
      <h2 className="text-center text-sm font-bold uppercase tracking-wide text-ink lg:text-base">{def.title}</h2>

      {/* Tháng · Phòng ban · Đồng nghiệp */}
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold text-muted">Tháng</span>
          <input type="month" value={month} max={monthLocal()} onChange={(e) => setMonth(e.target.value || monthLocal())} className={sel} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold text-muted">Phòng ban</span>
          <select value={dept} onChange={(e) => setDept(e.target.value)} className={sel}>
            <option value="">Tất cả phòng ban</option>
            {deptOptions.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold text-muted">Đồng nghiệp</span>
          <select value={personId} onChange={(e) => pickPerson(e.target.value)} className={sel}>
            <option value="">— Chọn đồng nghiệp —</option>
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
              value={scores[i] ?? 0}
              disabled={!person || saving}
              onChange={(n) => setScores((s) => s.map((v, j) => (j === i ? n : v)))}
            />
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className={`min-h-4 text-[11px] font-semibold ${msg ? (msg.ok ? "text-ok" : "text-bad") : "text-muted"}`}>
          {msg
            ? msg.text
            : person
              ? existing
                ? `Đã chấm ${person.full_name} tháng ${fmtMonth(month)} (TB ${avgOf(existing.scores).toFixed(1)}/5) — sửa điểm rồi lưu lại.`
                : `Chưa chấm ${person.full_name} tháng ${fmtMonth(month)}.`
              : "Chọn đồng nghiệp để bắt đầu chấm."}
        </p>
        <div className="flex items-center gap-2">
          {existing && (
            <button type="button" onClick={withdraw} disabled={saving} className="rounded-xl2 border border-line px-3 py-2 text-xs font-semibold text-muted hover:text-bad disabled:opacity-50">
              Rút lại
            </button>
          )}
          <button
            type="button"
            onClick={save}
            disabled={saving || !person || !complete}
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
            <p className="text-[11px] text-white/70">Chấm đồng nghiệp theo tháng · thang 1–5 · chỉ bạn thấy phiếu mình chấm</p>
          </div>
        </div>
      </header>

      {/* Mỗi hàng: phiếu bên TRÁI, bảng tiêu chí 1 điểm / 5 điểm bên PHẢI. Chất lượng công việc trên, Hòa đồng tập thể dưới. */}
      <div className="mt-4 space-y-4">
        {FORMS.map((f) => (
          <div key={f.kind} className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <ReviewForm def={f} colleagues={colleagues} />
            <RubricCard def={f} />
          </div>
        ))}
      </div>
    </AppShell>
  );
}
