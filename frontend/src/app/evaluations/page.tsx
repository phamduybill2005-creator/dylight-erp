"use client";

// Trang Đánh giá 2 chiều (Nhân viên <-> Quản lý trực tiếp).
//  - STAFF   : chấm điểm quản lý trực tiếp + xem điểm mình nhận được.
//  - MANAGER : chấm điểm cấp dưới trực tiếp + xem điểm nhân viên chấm mình.
//  - DIRECTOR: chỉ xem (chọn 1 nhân sự để xem các phiếu đánh giá của họ).

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { StarIcon } from "@heroicons/react/24/solid";
import { ChatBubbleLeftRightIcon, UserCircleIcon } from "@heroicons/react/24/outline";
import AppShell from "@/components/app-shell";
import { api } from "@/lib/api";
import { roleTier } from "@/lib/roles";
import type { Evaluation, User } from "@/lib/types";

const monthStr = () => new Date().toISOString().slice(0, 7);

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

function EvalCard({ e, who }: { e: Evaluation; who: "evaluator" | "evaluatee" }) {
  const name = who === "evaluator" ? e.evaluator_name : e.evaluatee_name;
  return (
    <div className="rounded-xl2 bg-white p-3 shadow-card">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <UserCircleIcon className="h-5 w-5 text-muted" />
          <p className="text-sm font-semibold text-ink">{name || "—"}</p>
        </div>
        <span className="text-[11px] text-muted">{e.period}</span>
      </div>
      <div className="mt-2">
        <Stars value={e.rating} />
      </div>
      {e.comment && <p className="mt-2 text-xs text-ink/80 leading-relaxed">{e.comment}</p>}
    </div>
  );
}

export default function EvaluationsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const [received, setReceived] = useState<Evaluation[]>([]);
  const [given, setGiven] = useState<Evaluation[]>([]);
  const [users, setUsers] = useState<User[]>([]);

  // form state (chấm điểm 1 đối tượng đang chọn)
  const [target, setTarget] = useState<User | null>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  // director: phiếu của 1 người đang xem
  const [viewing, setViewing] = useState<User | null>(null);
  const [viewEvals, setViewEvals] = useState<Evaluation[]>([]);

  const period = monthStr();
  const tier = user ? roleTier(user.role) : "STAFF";

  useEffect(() => {
    api.me()
      .then((u) => {
        setUser(u);
        const t = roleTier(u.role);
        api.evaluationsReceived().then(setReceived).catch(() => {});
        if (t !== "STAFF") {
          api.evaluationsGiven().then(setGiven).catch(() => {});
          api.users().then(setUsers).catch(() => {});
        } else {
          api.evaluationsGiven().then(setGiven).catch(() => {});
        }
        setLoading(false);
      })
      .catch(() => router.push("/login"));
  }, [router]);

  // Cấp dưới trực tiếp (cho quản lý chấm điểm).
  const subordinates = useMemo(
    () => (user ? users.filter((u) => u.manager_id === user.id) : []),
    [users, user]
  );

  // Mở form chấm điểm 1 người: nạp sẵn phiếu kỳ này nếu đã chấm.
  function openTarget(t: User) {
    setTarget(t);
    setMsg("");
    const prev = given.find((g) => g.evaluatee_id === t.id && g.period === period);
    setRating(prev?.rating ?? 0);
    setComment(prev?.comment ?? "");
  }

  async function submit() {
    if (!target || rating < 1) return;
    setSaving(true);
    setMsg("");
    try {
      await api.createEvaluation({ period, evaluatee_id: target.id, rating, comment: comment || null });
      const g = await api.evaluationsGiven();
      setGiven(g);
      setMsg("Đã lưu đánh giá.");
      setTarget(null);
    } catch (err: any) {
      setMsg(err.message || "Không lưu được đánh giá.");
    } finally {
      setSaving(false);
    }
  }

  async function viewUser(u: User) {
    setViewing(u);
    setViewEvals([]);
    try {
      setViewEvals(await api.evaluationsForUser(u.id));
    } catch {
      /* bỏ qua */
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
  if (tier === "STAFF") {
    const givenToManager = given.find(
      (g) => g.evaluatee_id === user.manager_id && g.period === period
    );
    return (
      <AppShell>
        <header className="flex items-center gap-2 rounded-xl2 bg-ink p-4 text-white shadow-card lg:p-6">
          <StarIcon className="h-5 w-5 text-amber lg:h-6 lg:w-6" />
          <h1 className="text-base font-bold lg:text-xl">Đánh giá quản lý</h1>
        </header>

        <section className="mt-4 rounded-xl2 bg-white p-4 shadow-card lg:p-6">
          {user.manager_id ? (
            <>
              <p className="text-xs text-muted">Kỳ đánh giá {period} · Quản lý trực tiếp</p>
              <p className="mt-1 text-base font-bold text-ink">{user.manager_name || "Quản lý"}</p>

              <p className="mt-4 text-[11px] font-semibold text-muted">Mức độ hài lòng</p>
              <div className="mt-1">
                <Stars value={rating || givenToManager?.rating || 0} onChange={setRating} />
              </div>

              <p className="mt-4 text-[11px] font-semibold text-muted">Nhận xét</p>
              <textarea
                rows={4}
                value={comment || (rating === 0 ? givenToManager?.comment || "" : comment)}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Nhận xét về sự hỗ trợ, phân công, giao tiếp của quản lý…"
                className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel resize-none"
              />

              {givenToManager && (
                <p className="mt-2 text-[11px] text-ok">
                  Bạn đã chấm {givenToManager.rating}★ kỳ này — gửi lại sẽ ghi đè.
                </p>
              )}
              {msg && <p className="mt-2 text-[11px] font-semibold text-steel">{msg}</p>}

              <button
                onClick={async () => {
                  if (rating < 1) {
                    setMsg("Vui lòng chọn số sao.");
                    return;
                  }
                  setSaving(true);
                  setMsg("");
                  try {
                    await api.createEvaluation({
                      period,
                      evaluatee_id: user.manager_id!,
                      rating,
                      comment: comment || null,
                    });
                    setGiven(await api.evaluationsGiven());
                    setMsg("Đã gửi đánh giá quản lý.");
                  } catch (err: any) {
                    setMsg(err.message || "Không gửi được đánh giá.");
                  } finally {
                    setSaving(false);
                  }
                }}
                disabled={saving}
                className="mt-4 w-full rounded-xl2 bg-ink py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving ? "Đang lưu…" : "Gửi đánh giá"}
              </button>
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

  // ==================== GIÁM ĐỐC (chỉ xem) ====================
  if (tier === "DIRECTOR") {
    return (
      <AppShell>
        <header className="flex items-center gap-2 rounded-xl2 bg-ink p-4 text-white shadow-card lg:p-6">
          <StarIcon className="h-5 w-5 text-amber lg:h-6 lg:w-6" />
          <h1 className="text-base font-bold lg:text-xl">Đánh giá nhân sự (xem)</h1>
        </header>

        <section className="mt-4">
          <h2 className="mb-2 text-sm font-semibold text-ink">Chọn nhân sự để xem phiếu</h2>
          <div className="space-y-2 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0 xl:grid-cols-3">
            {users.map((u) => (
              <button
                key={u.id}
                onClick={() => viewUser(u)}
                className={`flex w-full items-center justify-between rounded-xl2 bg-white p-3 text-left shadow-card ${viewing?.id === u.id ? "border-l-4 border-amber" : ""}`}
              >
                <span className="text-sm font-semibold text-ink">{u.full_name}</span>
                <span className="text-[11px] text-muted">{u.email}</span>
              </button>
            ))}
          </div>
        </section>

        {viewing && (
          <section className="mt-5">
            <h2 className="mb-2 text-sm font-semibold text-ink">Phiếu đánh giá: {viewing.full_name}</h2>
            <div className="space-y-2 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0">
              {viewEvals.length === 0 ? (
                <p className="rounded-xl2 bg-white p-4 text-center text-xs text-muted shadow-card lg:col-span-2">
                  Chưa có phiếu đánh giá nào.
                </p>
              ) : (
                viewEvals.map((e) => <EvalCard key={e.id} e={e} who="evaluator" />)
              )}
            </div>
          </section>
        )}
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
        <h2 className="mb-2 text-sm font-semibold text-ink">Nhân viên cấp dưới ({subordinates.length})</h2>
        <div className="space-y-2 lg:grid lg:grid-cols-2 lg:items-start lg:gap-3 lg:space-y-0">
          {subordinates.length === 0 ? (
            <p className="rounded-xl2 bg-white p-4 text-center text-xs text-muted shadow-card lg:col-span-2">
              Bạn chưa có nhân viên cấp dưới trực tiếp.
            </p>
          ) : (
            subordinates.map((u) => {
              const g = given.find((x) => x.evaluatee_id === u.id && x.period === period);
              return (
                <div key={u.id} className="rounded-xl2 bg-white p-3 shadow-card">
                  <button onClick={() => openTarget(u)} className="flex w-full items-center justify-between text-left">
                    <span className="text-sm font-semibold text-ink">{u.full_name}</span>
                    {g ? (
                      <span className="flex items-center gap-1 text-xs font-semibold text-amber">
                        {g.rating} <StarIcon className="h-4 w-4" />
                      </span>
                    ) : (
                      <span className="text-[11px] font-semibold text-steel">Chấm điểm →</span>
                    )}
                  </button>

                  {target?.id === u.id && (
                    <div className="mt-3 border-t border-line pt-3">
                      <p className="text-[11px] font-semibold text-muted">Kỳ {period} · Mức điểm</p>
                      <div className="mt-1">
                        <Stars value={rating} onChange={setRating} />
                      </div>
                      <textarea
                        rows={3}
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        placeholder="Nhận xét về hiệu quả công việc, thái độ, giờ giấc…"
                        className="mt-2 w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel resize-none"
                      />
                      {msg && target?.id === u.id && (
                        <p className="mt-1 text-[11px] font-semibold text-steel">{msg}</p>
                      )}
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={() => setTarget(null)}
                          className="flex-1 rounded-xl2 border border-line py-2 text-xs font-semibold text-muted"
                        >
                          Hủy
                        </button>
                        <button
                          onClick={submit}
                          disabled={saving || rating < 1}
                          className="flex-1 rounded-xl2 bg-ink py-2 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          {saving ? "Đang lưu…" : "Lưu đánh giá"}
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
