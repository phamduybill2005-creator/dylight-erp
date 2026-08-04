"use client";

// Tab "Đánh giá" trong 1 dự án — CHẤM CHÉO 360°: mọi thành viên chấm lẫn nhau,
// mỗi người 1 phiếu/đồng đội (ghi đè khi chấm lại), 1–5 sao + nhận xét.
//  - Ai cũng thấy: form chấm đồng đội (prefill điểm mình đã cho) + điểm MÌNH nhận
//    (ẩn danh người chấm).
//  - Chủ trì/Giám đốc thấy thêm: TỔNG HỢP cả nhóm + từng phiếu (có tên người chấm).

import { useCallback, useEffect, useMemo, useState } from "react";
import { StarIcon, UserGroupIcon, ChevronDownIcon } from "@heroicons/react/24/outline";
import { StarIcon as StarSolid } from "@heroicons/react/24/solid";
import { api } from "@/lib/api";
import { roleTitle } from "@/lib/roles";
import { formatDate } from "@/lib/format";
import type { ProjectEvaluationView } from "@/lib/types";

/** Chọn sao 1–5 (có hover). */
function StarPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div className="flex items-center gap-0.5" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => {
        const Filled = n <= shown;
        const Ico = Filled ? StarSolid : StarIcon;
        return (
          <button
            key={n}
            type="button"
            onMouseEnter={() => setHover(n)}
            onClick={() => onChange(n)}
            className={Filled ? "text-amber" : "text-line hover:text-amber"}
            aria-label={`${n} sao`}
          >
            <Ico className="h-6 w-6" />
          </button>
        );
      })}
    </div>
  );
}

/** Hiển thị điểm dạng sao (chỉ đọc) + số. */
function StarView({ value, count }: { value?: number | null; count?: number }) {
  if (value == null) {
    return <span className="text-[11px] text-muted">Chưa có điểm</span>;
  }
  const rounded = Math.round(value);
  return (
    <span className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => {
        const Ico = n <= rounded ? StarSolid : StarIcon;
        return <Ico key={n} className={`h-4 w-4 ${n <= rounded ? "text-amber" : "text-line"}`} />;
      })}
      <span className="ml-1 text-xs font-semibold text-ink tnum">{value.toFixed(1)}</span>
      {count != null && <span className="text-[11px] text-muted">({count})</span>}
    </span>
  );
}

type Draft = { rating: number; comment: string };

export default function ProjectEvaluationTab({
  projectId,
  currentUserId,
}: {
  projectId: number;
  currentUserId: number | null;
}) {
  const [view, setView] = useState<ProjectEvaluationView | null>(null);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [savedFor, setSavedFor] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api
      .projectEvaluations(projectId)
      .then((v) => {
        setView(v);
        // Prefill nháp từ phiếu mình đã chấm.
        const givenMap: Record<number, Draft> = {};
        for (const g of v.given) givenMap[g.evaluatee_id] = { rating: g.rating, comment: g.comment ?? "" };
        setDrafts(givenMap);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Không tải được đánh giá."))
      .finally(() => setLoading(false));
  }, [projectId]);
  useEffect(() => {
    load();
  }, [load]);

  const setDraft = (uid: number, patch: Partial<Draft>) =>
    setDrafts((prev) => {
      const base: Draft = prev[uid] ?? { rating: 0, comment: "" };
      return { ...prev, [uid]: { ...base, ...patch } };
    });

  async function save(uid: number) {
    const d = drafts[uid];
    if (!d || d.rating < 1) return;
    setBusy(uid);
    setError(null);
    try {
      await api.createProjectEvaluation({
        project_id: projectId,
        evaluatee_id: uid,
        rating: d.rating,
        comment: d.comment.trim() || null,
      });
      setSavedFor(uid);
      setTimeout(() => setSavedFor((s) => (s === uid ? null : s)), 1800);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lưu đánh giá thất bại.");
    } finally {
      setBusy(null);
    }
  }

  // Đồng đội để chấm = người tham gia trừ chính mình.
  const teammates = useMemo(
    () => (view?.participants ?? []).filter((p) => p.user_id !== currentUserId),
    [view, currentUserId],
  );

  if (loading) {
    return <p className="py-10 text-center text-xs text-muted">Đang tải đánh giá…</p>;
  }
  if (!view) {
    return <p className="py-10 text-center text-xs text-bad">{error ?? "Không tải được đánh giá."}</p>;
  }

  return (
    <div className="space-y-6">
      {error && <p className="rounded-lg bg-bad/10 px-3 py-2 text-xs text-bad">{error}</p>}

      {/* ============ CHẤM ĐỒNG ĐỘI ============ */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase text-muted">
            <UserGroupIcon className="h-4 w-4 text-steel" />
            Chấm điểm đồng đội ({teammates.length})
          </h3>
        </div>

        {teammates.length === 0 ? (
          <p className="rounded-xl2 bg-white p-6 text-center text-xs text-muted shadow-card">
            Dự án chưa có đồng đội nào khác để đánh giá. Thêm thành viên ở <b>Sửa dự án</b>.
          </p>
        ) : (
          <div className="space-y-2.5">
            {teammates.map((p) => {
              const d = drafts[p.user_id] ?? { rating: 0, comment: "" };
              const dirty = view.given.find((g) => g.evaluatee_id === p.user_id);
              return (
                <div key={p.user_id} className="rounded-xl2 border border-line bg-white p-3.5 shadow-card">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-semibold text-ink">{p.full_name}</span>
                      </div>
                      <p className="mt-0.5 text-[10px] text-muted">
                        {roleTitle(p.role)}
                        {p.department ? ` · ${p.department}` : ""}
                        {dirty ? " · bạn đã chấm" : ""}
                      </p>
                    </div>
                    <StarPicker value={d.rating} onChange={(v) => setDraft(p.user_id, { rating: v })} />
                  </div>

                  <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                    <textarea
                      value={d.comment}
                      onChange={(e) => setDraft(p.user_id, { comment: e.target.value })}
                      rows={1}
                      placeholder="Nhận xét (tùy chọn)"
                      className="min-h-[38px] flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
                    />
                    <button
                      type="button"
                      onClick={() => save(p.user_id)}
                      disabled={busy === p.user_id || d.rating < 1}
                      className="shrink-0 rounded-xl2 bg-ink px-3 py-2 text-xs font-semibold text-white hover:bg-steel disabled:opacity-50"
                    >
                      {busy === p.user_id ? "Đang lưu…" : savedFor === p.user_id ? "✓ Đã lưu" : dirty ? "Cập nhật" : "Chấm"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ============ ĐIỂM CỦA TÔI ============ */}
      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase text-muted">Điểm tôi nhận trong dự án này</h3>
        <div className="rounded-xl2 border border-line bg-white p-3.5 shadow-card">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted">Trung bình từ {view.my_count} đồng đội</span>
            <StarView value={view.my_avg} count={view.my_count} />
          </div>
          {view.received.length > 0 && (
            <div className="mt-3 space-y-1.5 border-t border-line/50 pt-2.5">
              {view.received
                .filter((r) => (r.comment ?? "").trim())
                .map((r) => (
                  <div key={r.id} className="rounded-lg bg-paper/60 p-2">
                    <div className="flex items-center justify-between">
                      <StarView value={r.rating} />
                      <span className="text-[10px] text-muted">{formatDate(r.created_at)}</span>
                    </div>
                    <p className="mt-1 text-[11px] text-ink">“{r.comment}”</p>
                  </div>
                ))}
              <p className="pt-1 text-[10px] italic text-muted">Nhận xét được ẩn danh người chấm.</p>
            </div>
          )}
        </div>
      </section>

      {/* ============ TỔNG HỢP CẢ NHÓM (chủ trì/Giám đốc) ============ */}
      {view.can_manage && (
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase text-muted">
            Tổng hợp cả nhóm — điểm thấp lên trước
          </h3>
          {view.summary.length === 0 ? (
            <p className="rounded-xl2 bg-white p-6 text-center text-xs text-muted shadow-card">
              Chưa có ai được chấm điểm trong dự án này.
            </p>
          ) : (
            <div className="space-y-2">
              {view.summary.map((s) => {
                const open = expanded === s.user_id;
                const detail = view.all_evaluations.filter((e) => e.evaluatee_id === s.user_id);
                return (
                  <div key={s.user_id} className="rounded-xl2 border border-line bg-white shadow-card">
                    <button
                      type="button"
                      onClick={() => setExpanded(open ? null : s.user_id)}
                      className="flex w-full items-center justify-between gap-2 p-3.5 text-left"
                    >
                      <span className="truncate text-sm font-semibold text-ink">{s.full_name}</span>
                      <span className="flex items-center gap-2">
                        <StarView value={s.avg_rating} count={s.num_ratings} />
                        <ChevronDownIcon className={`h-4 w-4 text-muted transition ${open ? "rotate-180" : ""}`} />
                      </span>
                    </button>
                    {open && (
                      <div className="space-y-1.5 border-t border-line/50 p-3">
                        {detail.map((e) => (
                          <div key={e.id} className="rounded-lg bg-paper/60 p-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] font-medium text-ink">{e.evaluator_name ?? "—"}</span>
                              <StarView value={e.rating} />
                            </div>
                            {e.comment && <p className="mt-1 text-[11px] text-muted">“{e.comment}”</p>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
