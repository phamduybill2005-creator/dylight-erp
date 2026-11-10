"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";
import { FORMS } from "@/lib/peer-review-forms";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import type { PeerReviewDetails, PeerReviewKind } from "@/lib/types";

type Props = {
  evaluateeId: number;
  evaluateeName: string;
  kind: PeerReviewKind;
  fromMonth: string;
  toMonth: string;
  onClose: () => void;
};
const fmtMonth = (month: string) => `${month.slice(5, 7)}/${month.slice(0, 4)}`;
const fmtScore = (score: number) => score.toLocaleString("vi-VN", { maximumFractionDigits: 2 });

/** Mounted only for the current director/admin summary selection. No details enter the table or export. */
export default function PeerReviewDetailsDialog({ evaluateeId, evaluateeName, kind, fromMonth, toMonth, onClose }: Props) {
  const scope = `${evaluateeId}:${kind}:${fromMonth}:${toMonth}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const request = useRef(0);
  const [result, setResult] = useState<{ scope: string; data?: PeerReviewDetails; error?: string; loading: boolean } | null>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const closeButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const form = FORMS.find((item) => item.kind === kind)!;

  const reload = useCallback(async () => {
    const id = ++request.current;
    const isCurrent = () => currentScope.current === scope && request.current === id;
    setResult((prior) => ({ scope, data: prior?.scope === scope ? prior.data : undefined, loading: true }));
    try {
      const data = await api.peerReviewDetails(evaluateeId, kind, fromMonth, toMonth);
      if (isCurrent()) setResult({ scope, data, loading: false });
    } catch (error) {
      if (isCurrent()) setResult((prior) => ({ scope, data: prior?.scope === scope ? prior.data : undefined,
        error: error instanceof Error ? error.message : "Không tải được chi tiết đánh giá.", loading: false }));
    }
  }, [scope, evaluateeId, kind, fromMonth, toMonth]);

  useEffect(() => {
    setExpanded({});
    void reload();
    return () => { request.current += 1; };
  }, [reload]);
  useAutoRefresh(reload, { topics: ["evaluation"], intervalMs: 20_000 });

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close.current(); }
      if (event.key !== "Tab") return;
      const controls = dialog.current?.querySelectorAll<HTMLElement>("button:not([disabled]), [href], [tabindex='0']");
      if (!controls?.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener("keydown", keydown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  // Hide the previous selection synchronously, before effects start its replacement request.
  const state = result?.scope === scope ? result : null;
  const data = state?.data;
  const loading = !state || state.loading;
  const period = fromMonth === toMonth ? `Tháng ${fmtMonth(fromMonth)}` : `${fmtMonth(fromMonth)} – ${fmtMonth(toMonth)}`;

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/50 p-3 sm:p-6" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="peer-details-title" aria-describedby="peer-details-period"
        className="flex max-h-[85dvh] w-full max-w-xl flex-col overflow-hidden rounded-xl2 bg-white shadow-xl">
        <header className="flex items-start justify-between gap-3 border-b border-line p-4">
          <div>
            <h2 id="peer-details-title" className="text-sm font-bold text-ink">{evaluateeName} · {form.title}</h2>
            <p id="peer-details-period" className="mt-1 text-xs text-muted">{period}{data ? ` · ${data.count} phiếu` : ""}</p>
          </div>
          <button ref={closeButton} type="button" onClick={onClose} aria-label="Đóng chi tiết đánh giá"
            className="shrink-0 rounded-lg px-3 py-2 text-sm font-semibold text-muted hover:bg-paper focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel">Đóng</button>
        </header>
        <div className="min-h-0 overflow-y-auto overscroll-contain p-4">
          {loading && <p role="status" className="mb-3 text-xs text-muted">{data ? "Đang cập nhật…" : "Đang tải chi tiết…"}</p>}
          {state?.error && <div role="alert" className="mb-3 rounded-lg bg-bad/10 p-3 text-xs text-bad">
            <p>{state.error}</p>
            <button type="button" onClick={reload} className="mt-2 rounded border border-bad/30 px-3 py-2 font-semibold">Thử lại</button>
          </div>}
          {data && data.evaluators.length === 0 && <p className="py-6 text-center text-xs text-muted">Chưa có phiếu đánh giá trong kỳ này.</p>}
          <div className="space-y-2">
            {data?.evaluators.map((evaluator) => {
              const open = !!expanded[evaluator.evaluator_id];
              const panelId = `peer-evaluator-${evaluator.evaluator_id}`;
              return <article key={evaluator.evaluator_id} className="overflow-hidden rounded-lg border border-line">
                <button type="button" aria-expanded={open} aria-controls={panelId}
                  onClick={() => setExpanded((prior) => ({ ...prior, [evaluator.evaluator_id]: !prior[evaluator.evaluator_id] }))}
                  className="flex w-full items-center gap-3 p-3 text-left hover:bg-paper focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel">
                  <span className="min-w-0 flex-1 text-sm font-semibold text-ink">{evaluator.evaluator_name}<span className="ml-2 text-[10px] font-normal text-muted">{evaluator.count} phiếu</span></span>
                  <span className="shrink-0 text-sm font-bold text-steel tnum">{fmtScore(evaluator.avg)}/5</span>
                  <span aria-hidden="true" className="text-xs text-muted">{open ? "▴" : "▾"}</span>
                </button>
                <div id={panelId} hidden={!open}>
                  {open && <div className="space-y-3 border-t border-line bg-paper/50 p-3">
                    {evaluator.reviews.map((review) => <section key={review.id} aria-label={`Phiếu tháng ${fmtMonth(review.month)}`}>
                      <h3 className="mb-2 text-xs font-bold text-ink">Tháng {fmtMonth(review.month)} <span className="font-normal text-muted">· TB {fmtScore(review.avg)}/5</span></h3>
                      <dl className="space-y-1.5 text-xs">
                        {form.criteria.map((criterion, index) => <div key={criterion.label} className="flex items-baseline justify-between gap-3">
                          <dt className="text-ink">{criterion.label}</dt><dd className="shrink-0 font-semibold text-steel tnum">{fmtScore(review.scores[index])}/5</dd>
                        </div>)}
                      </dl>
                    </section>)}
                  </div>}
                </div>
              </article>;
            })}
          </div>
        </div>
      </div>
    </div>, document.body,
  );
}
