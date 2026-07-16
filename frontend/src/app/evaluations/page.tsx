"use client";

// Trang Đánh giá 2 chiều (Nhân viên <-> Quản lý trực tiếp) — chấm THEO TỪNG NGÀY
// & TỪNG DỰ ÁN (dự án tùy chọn), TỔNG HỢP THEO TUẦN.
//  - STAFF   : chấm quản lý trực tiếp theo ngày + xem điểm mình nhận.
//  - MANAGER : chấm cấp dưới trực tiếp theo ngày/dự án + xem điểm nhân viên chấm mình.
//  - DIRECTOR: chỉ xem — tổng hợp trung bình theo tuần + tất cả phiếu (kèm ngày/dự án).

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { StarIcon } from "@heroicons/react/24/solid";
import { ChatBubbleLeftRightIcon, UserCircleIcon, FolderIcon } from "@heroicons/react/24/outline";
import AppShell from "@/components/app-shell";
import { api } from "@/lib/api";
import { roleTier, ROLE_LABEL } from "@/lib/roles";
import { dateLocal, todayLocal } from "@/lib/format";
import type { Evaluation, EvaluationSummary, User, Project } from "@/lib/types";

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
const fmtSat = (s: string) =>
  new Date(s + "T00:00:00").toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
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
          onClick={() => onChange?.(n)}
          className={onChange ? "transition-transform active:scale-90" : "cursor-default"}
        >
          <StarIcon className={`h-6 w-6 ${n <= value ? "text-amber" : "text-line"}`} />
        </button>
      ))}
    </div>
  );
}

// Thẻ 1 phiếu — hiện NGÀY chấm + DỰ ÁN (nếu có) + sao + nhận xét.
function EvalCard({ e, who }: { e: Evaluation; who: "evaluator" | "evaluatee" }) {
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
        <span className="shrink-0 text-[11px] text-muted">{fmtDay(e.eval_date)}</span>
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

export default function EvaluationsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(api.cachedUser());
  const [loading, setLoading] = useState(true);

  const [received, setReceived] = useState<Evaluation[]>([]);
  const [given, setGiven] = useState<Evaluation[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);

  // form state (chấm 1 đối tượng đang chọn) — theo NGÀY + DỰ ÁN.
  const [target, setTarget] = useState<User | null>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [evalDate, setEvalDate] = useState(todayLocal());
  const [evalProjectId, setEvalProjectId] = useState<number | "">("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  // director: tổng hợp + tất cả phiếu theo tuần
  const [selPeriod, setSelPeriod] = useState(weekSaturday());
  const [summary, setSummary] = useState<EvaluationSummary[]>([]);
  const [allEvals, setAllEvals] = useState<Evaluation[]>([]);

  const period = weekSaturday();
  const tier = user ? roleTier(user.role) : "STAFF";

  useEffect(() => {
    if (!user || roleTier(user.role) !== "DIRECTOR") return;
    api.evaluationsSummary(selPeriod).then(setSummary).catch(() => {});
    api.allEvaluations(selPeriod).then(setAllEvals).catch(() => {});
  }, [user, selPeriod]);

  useEffect(() => {
    api.me()
      .then((u) => {
        setUser(u);
        const t = roleTier(u.role);
        api.evaluationsReceived().then(setReceived).catch(() => {});
        api.evaluationsGiven().then(setGiven).catch(() => {});
        api.projects().then(setProjects).catch(() => {});
        if (t !== "STAFF") api.users().then(setUsers).catch(() => {});
        setLoading(false);
      })
      .catch(() => router.push("/login"));
  }, [router]);

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

  // Gửi 1 phiếu cho evaluatee (dùng chung cho cả 2 chiều).
  async function submitFor(evaluateeId: number) {
    if (rating < 1) { setMsg("Vui lòng chọn số sao."); return; }
    setSaving(true);
    setMsg("");
    try {
      await api.createEvaluation({
        evaluatee_id: evaluateeId,
        eval_date: evalDate,
        project_id: evalProjectId === "" ? null : Number(evalProjectId),
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
    const myWeek = user.manager_id ? weekGivenTo(user.manager_id) : [];
    return (
      <AppShell>
        <header className="flex items-center gap-2 rounded-xl2 bg-ink p-4 text-white shadow-card lg:p-6">
          <StarIcon className="h-5 w-5 text-amber lg:h-6 lg:w-6" />
          <h1 className="text-base font-bold lg:text-xl">Đánh giá quản lý</h1>
        </header>

        <section className="mt-4 rounded-xl2 bg-white p-4 shadow-card lg:p-6">
          {user.manager_id ? (
            <>
              <p className="text-xs text-muted">
                Chấm quản lý trực tiếp theo ngày — tổng hợp tuần đến <b className="text-ink">Thứ 7 {fmtSat(period)}</b>
              </p>
              <p className="mt-1 text-base font-bold text-ink">{user.manager_name || "Quản lý"}</p>

              <div className="mt-3">{DateProjectPicker()}</div>

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
                onClick={() => submitFor(user.manager_id!)}
                disabled={saving || rating < 1}
                className="mt-3 w-full rounded-xl2 bg-ink py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving ? "Đang lưu…" : "Gửi đánh giá ngày"}
              </button>

              {myWeek.length > 0 && (
                <div className="mt-4 border-t border-line pt-3">
                  <p className="mb-2 text-[11px] font-semibold text-muted">
                    Tuần này bạn đã chấm ({myWeek.length}) · TB {avgOf(myWeek.map((g) => g.rating)).toFixed(1)}★
                  </p>
                  <div className="space-y-1.5">
                    {myWeek.map((g) => (
                      <div key={g.id} className="flex items-center justify-between rounded-lg bg-paper px-2.5 py-1.5 text-[11px]">
                        <span className="text-muted">{fmtDay(g.eval_date)} · {g.project_name || "Chung"}</span>
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
              Bạn chưa được phân công quản lý trực tiếp để đánh giá.
            </p>
          )}
        </section>

        <section className="mt-5">
          <div className="mb-2 flex items-center gap-2">
            <ChatBubbleLeftRightIcon className="h-5 w-5 text-steel" />
            <h2 className="text-sm font-semibold text-ink">Đánh giá tôi nhận được</h2>
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

  // ============ GIÁM ĐỐC (xem số liệu tổng hợp theo tuần) ============
  if (tier === "DIRECTOR") {
    const avgAll = summary.length
      ? (summary.reduce((a, s) => a + s.avg_rating, 0) / summary.length).toFixed(2)
      : "—";
    return (
      <AppShell>
        <header className="flex items-center gap-2 rounded-xl2 bg-ink p-4 text-white shadow-card lg:p-6">
          <StarIcon className="h-5 w-5 text-amber lg:h-6 lg:w-6" />
          <h1 className="text-base font-bold lg:text-xl">Đánh giá nhân sự — tổng hợp tuần</h1>
        </header>

        <section className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl2 border border-line bg-white p-3 shadow-card">
          <div className="text-xs text-muted">
            Tuần đến hết <b className="text-ink">Thứ 7 {fmtSat(selPeriod)}</b>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={selPeriod}
              onChange={(e) => e.target.value && setSelPeriod(weekSaturday(new Date(e.target.value + "T00:00:00")))}
              className="rounded-lg border border-line bg-paper px-2 py-1.5 text-xs outline-none focus:border-steel"
            />
            <button
              onClick={() => setSelPeriod(weekSaturday())}
              className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-steel hover:bg-paper"
            >
              Tuần này
            </button>
          </div>
        </section>

        <section className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Điểm trung bình mỗi người ({summary.length})</h2>
            <span className="text-[11px] text-muted">TB chung: <b className="text-amber-deep">{avgAll}★</b></span>
          </div>
          <div className="space-y-2 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0 xl:grid-cols-3">
            {summary.length === 0 ? (
              <p className="rounded-xl2 bg-white p-4 text-center text-xs text-muted shadow-card lg:col-span-2 xl:col-span-3">
                Chưa có đánh giá nào trong tuần này.
              </p>
            ) : (
              summary.map((s) => (
                <div key={s.user_id} className="flex items-center justify-between rounded-xl2 bg-white p-3 shadow-card">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">
                      {s.full_name}{" "}
                      <span className="text-xs font-normal text-muted">
                        ({ROLE_LABEL[s.role] || "Nhân viên"})
                      </span>
                    </p>
                    <p className="text-[10px] text-muted">{s.num_ratings} phiếu trong tuần</p>
                  </div>
                  <span
                    className={`flex shrink-0 items-center gap-1 text-sm font-bold ${
                      s.avg_rating >= 4 ? "text-ok" : s.avg_rating >= 2.5 ? "text-amber-deep" : "text-bad"
                    }`}
                  >
                    {s.avg_rating.toFixed(1)} <StarIcon className="h-4 w-4" />
                  </span>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="mt-5">
          <div className="mb-2 flex items-center gap-2">
            <ChatBubbleLeftRightIcon className="h-5 w-5 text-steel" />
            <h2 className="text-sm font-semibold text-ink">Tất cả phiếu trong tuần ({allEvals.length})</h2>
          </div>
          <div className="space-y-2 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0">
            {allEvals.length === 0 ? (
              <p className="rounded-xl2 bg-white p-4 text-center text-xs text-muted shadow-card lg:col-span-2">
                Chưa có phiếu nào.
              </p>
            ) : (
              allEvals.map((e) => (
                <div key={e.id} className="rounded-xl2 bg-white p-3 shadow-card">
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-xs text-ink">
                      {e.direction === "STAFF_TO_MANAGER" ? (
                        <span>
                          <b>{e.evaluator_name}</b> <span className="text-[10px] text-muted">(NV)</span> <span className="text-muted">→</span> <b>{e.evaluatee_name}</b> <span className="text-[10px] text-muted">(QL)</span>
                        </span>
                      ) : (
                        <span>
                          <b>{e.evaluator_name}</b> <span className="text-[10px] text-muted">(QL)</span> <span className="text-muted">→</span> <b>{e.evaluatee_name}</b> <span className="text-[10px] text-muted">(NV)</span>
                        </span>
                      )}
                    </p>
                    <span className="flex shrink-0 items-center gap-1 text-xs font-bold text-amber-deep bg-amber/10 px-1.5 py-0.5 rounded">
                      {e.rating}★ {RATING_LABELS[e.rating]}
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] text-muted">
                    {fmtDay(e.eval_date)} · {e.project_name || "Chung"}
                  </p>
                  {e.comment && <p className="mt-1 text-[11px] text-muted">{e.comment}</p>}
                </div>
              ))
            )}
          </div>
        </section>
      </AppShell>
    );
  }

  // ==================== QUẢN LÝ ====================
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
