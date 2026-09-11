"use client";

// Trang Đánh giá 2 chiều (Nhân viên <-> Quản lý trực tiếp) — chấm THEO TỪNG NGÀY
// & TỪNG DỰ ÁN (dự án tùy chọn), TỔNG HỢP THEO TUẦN.
//  - STAFF   : chấm quản lý trực tiếp THEO THÁNG (mỗi tháng 1 phiếu) + xem điểm mình nhận.
//  - KẾ TOÁN : chấm cấp dưới trực tiếp theo ngày/dự án + xem điểm nhân viên chấm mình.
//  - GIÁM ĐỐC / QUẢN TRỊ / QL CẤP CAO / QL CẤP TRUNG: bảng THÁNG (Office time / Project
//    time / Đi muộn) + bấm sao chấm mọi người (TRỪ Giám đốc — không ai chấm Giám đốc) + xuất Excel.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { StarIcon } from "@heroicons/react/24/solid";
import { ArrowDownTrayIcon, ChatBubbleLeftRightIcon, UserCircleIcon, FolderIcon } from "@heroicons/react/24/outline";
import AppShell from "@/components/app-shell";
import { api } from "@/lib/api";
import { roleTier, ROLE_LABEL, userRankWeight } from "@/lib/roles";
import { dateLocal, monthLocal, todayLocal } from "@/lib/format";
import type { Evaluation, EvaluationOverviewRow, User, Project, Colleague } from "@/lib/types";

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
          onClick={() => onChange?.(n)}
          className={onChange ? "transition-transform active:scale-90" : "cursor-default"}
        >
          <StarIcon className={`h-6 w-6 ${n <= value ? "text-amber" : "text-line"}`} />
        </button>
      ))}
    </div>
  );
}

// 5 sao MỜ để chấm nhanh ngay trên bảng: rê chuột xem trước, bấm để lưu; đã chấm
// thì sáng tới số sao đã chọn (bấm sao khác để sửa).
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
          onClick={() => onRate(n)}
          title={`${n} sao — ${RATING_LABELS[n]}`}
          aria-label={`Chấm ${n} sao`}
          className="p-0.5 transition-transform hover:scale-110 active:scale-90 disabled:cursor-wait"
        >
          <StarIcon className={`h-5 w-5 ${n <= shown ? "text-amber" : "text-line"}`} />
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
  const [selMonth, setSelMonth] = useState(monthLocal());   // tháng đang chọn (bảng GĐ / form Nhân viên)
  const [overview, setOverview] = useState<EvaluationOverviewRow[]>([]);   // bảng đánh giá tháng
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [ratingUid, setRatingUid] = useState<number | null>(null);   // người đang lưu sao
  const [rateMsg, setRateMsg] = useState("");
  const [exporting, setExporting] = useState(false);

  const period = weekSaturday();
  const tier = user ? roleTier(user.role) : "STAFF";
  const usesMonthTable = !!user && MONTH_TABLE_ROLES.includes(user.role);

  // Bảng đánh giá: Office time / Project time / Đi muộn + sao mình đã chấm, CỘNG CẢ THÁNG đang
  // chọn — cùng khoảng ngày với file Excel ở Tổng hợp chấm công nên số khớp nhau.
  useEffect(() => {
    if (!user || !MONTH_TABLE_ROLES.includes(user.role)) return;
    let alive = true;
    setOverviewLoading(true);
    setRateMsg("");
    const [from, to] = monthRange(selMonth);
    api.evaluationsOverview(from, to)
      .then((rows) => { if (alive) setOverview(rows); })
      .catch(() => { if (alive) setOverview([]); })
      .finally(() => { if (alive) setOverviewLoading(false); });
    return () => { alive = false; };
  }, [user, selMonth]);

  // Giám đốc bấm sao: lưu phiếu CHUNG (không gắn dự án) vào NGÀY 1 của tháng đang xem.
  // Cùng 1 ngày nên bấm sao khác là SỬA phiếu đó, không sinh thêm phiếu.
  async function rateUser(uid: number, stars: number) {
    const before = overview.find((r) => r.user_id === uid)?.my_rating ?? null;
    const setMine = (v: number | null) =>
      setOverview((rows) => rows.map((r) => (r.user_id === uid ? { ...r, my_rating: v } : r)));
    setMine(stars);
    setRatingUid(uid);
    setRateMsg("");
    try {
      await api.createEvaluation({ evaluatee_id: uid, eval_date: monthRange(selMonth)[0], project_id: null, rating: stars });
    } catch (err) {
      setMine(before);
      setRateMsg(err instanceof Error ? err.message : "Không lưu được đánh giá.");
    } finally {
      setRatingUid(null);
    }
  }

  // Xuất Excel ĐÚNG bảng đang xem (tháng đang chọn, cùng thứ tự dòng).
  async function exportExcel(rows: EvaluationOverviewRow[]) {
    setExporting(true);
    setRateMsg("");
    try {
      const XLSX = await import("xlsx");   // chỉ nạp khi bấm -> không làm nặng trang
      const r1 = (h: number) => Math.round(h * 10) / 10;
      const headers = [
        "STT", "Họ và tên", "Chức vụ", "Phòng ban",
        "Office time (giờ)", "Project time (giờ)", "Đi muộn (ngày)", "Đánh giá (sao)", "Xếp loại",
      ];
      const data = rows.map((r, i) => [
        i + 1,
        r.full_name,
        ROLE_LABEL[r.role] || "Nhân viên",
        r.department || "",
        r1(r.office_hours),
        r1(r.project_hours),
        r.late_days,
        r.my_rating ?? "",
        r.my_rating ? RATING_LABELS[r.my_rating] : "",
      ]);
      const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
      ws["!cols"] = [
        { wch: 6 }, { wch: 22 }, { wch: 18 }, { wch: 30 },
        { wch: 16 }, { wch: 17 }, { wch: 14 }, { wch: 14 }, { wch: 18 },
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, `Đánh giá ${selMonth}`);
      XLSX.writeFile(wb, `Danh_gia_nhan_su_${selMonth}.xlsx`);
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

  // ===== GIÁM ĐỐC / QUẢN TRỊ / QL CẤP CAO / QL CẤP TRUNG: bảng đánh giá THÁNG =====
  if (usesMonthTable) {
    // Bảng tháng: KHÔNG hiện Giám đốc; xếp theo cấp bậc rồi tên — KHÔNG theo sao để hàng
    // không nhảy khi bấm. Xuất Excel dùng chính danh sách này nên cũng bỏ Giám đốc.
    const rows = overview
      .filter((r) => r.role !== "DIRECTOR")
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
              <h2 className="text-sm font-semibold text-ink">Đánh giá nhân sự tháng {fmtMonth(selMonth)} ({rows.length})</h2>
              <p className="mt-0.5 text-[11px] text-muted">
                Cộng cả tháng: <b className="text-steel">Office time</b> = giờ có mặt theo chấm công (đã trừ nghỉ trưa) · <b className="text-steel">Project time</b> = giờ khai ở bảng tiến độ dự án · <b className="text-steel">Đi muộn</b> = số ngày vào trễ (đơn đi muộn đã duyệt không tính). Bấm sao để chấm tháng này, bấm sao khác để sửa.
              </p>
              {rateMsg && <p className="mt-1 text-[11px] font-semibold text-bad">{rateMsg}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => exportExcel(rows)}
                disabled={exporting || overviewLoading || rows.length === 0}
                className="flex items-center gap-1.5 rounded-xl2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer disabled:cursor-default disabled:opacity-60"
                title={`Xuất file Excel tháng ${fmtMonth(selMonth)}`}
              >
                <ArrowDownTrayIcon className={`h-3.5 w-3.5 ${exporting ? "animate-bounce" : ""}`} />
                {exporting ? "Đang xuất..." : "Xuất Excel"}
              </button>
              <input
                type="month"
                value={selMonth}
                disabled={ratingUid !== null}
                onChange={(e) => e.target.value && setSelMonth(e.target.value)}
                className="rounded-lg border border-line bg-white px-2 py-1.5 text-xs outline-none focus:border-steel disabled:opacity-60"
              />
              <button
                onClick={() => setSelMonth(monthLocal())}
                disabled={ratingUid !== null}
                className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs font-semibold text-steel hover:bg-paper disabled:opacity-60"
              >
                Tháng này
              </button>
            </div>
          </div>
          {rows.length === 0 ? (
            <p className="rounded-xl2 bg-white p-4 text-center text-xs text-muted shadow-card">
              {overviewLoading ? "Đang tải…" : "Chưa có nhân sự nào."}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl2 bg-white shadow-card">
              <table className="w-full min-w-[640px] text-xs">
                <thead>
                  <tr className="border-b border-line text-left text-[10px] uppercase tracking-wide text-muted">
                    <th className="px-3 py-2 font-semibold">Người</th>
                    <th className="px-3 py-2 text-center font-semibold">Office time</th>
                    <th className="px-3 py-2 text-center font-semibold">Project time</th>
                    <th className="px-3 py-2 text-center font-semibold">Đi muộn</th>
                    <th className="px-3 py-2 text-center font-semibold">Đánh giá</th>
                  </tr>
                </thead>
                <tbody className={overviewLoading ? "opacity-60" : ""}>
                  {rows.map((r, i) => (
                    <tr key={r.user_id} className="border-b border-line/50 last:border-0 hover:bg-paper/60">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <span className="w-4 shrink-0 text-right text-[10px] font-semibold text-muted">{i + 1}</span>
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-ink">{r.full_name}</p>
                            <p className="truncate text-[10px] text-muted">
                              {ROLE_LABEL[r.role] || "Nhân viên"}{r.department ? ` · ${r.department}` : ""}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center tnum">{hoursCell(r.office_hours)}</td>
                      <td className="px-3 py-2 text-center tnum">{hoursCell(r.project_hours)}</td>
                      <td className="px-3 py-2 text-center tnum">
                        {r.late_days > 0 ? (
                          <span className="rounded-full bg-bad/10 px-2 py-0.5 text-[11px] font-bold text-bad">{r.late_days}</span>
                        ) : (
                          <span className="text-muted">0</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex justify-center">
                          <RateStars
                            value={r.my_rating ?? 0}
                            busy={ratingUid === r.user_id}
                            onRate={(n) => rateUser(r.user_id, n)}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
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
