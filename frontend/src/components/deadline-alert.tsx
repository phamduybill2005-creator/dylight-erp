"use client";

// NHẮC HẠN NỘP HÀNG NGÀY: mỗi ngày mở app, liệt kê MỌI dự án còn hạn nộp (không đợi
// sát ngày mới báo). Quá hạn / sắp đến hạn xếp lên đầu và tô đỏ - vàng để thấy trước.
// Hạn nộp = mốc SỚM NHẤT giữa "Hạn nội bộ" và "Ngày hoàn thành".
// Ngoài modal trong app, còn: KÊU THÀNH TIẾNG (WebAudio) + THÔNG BÁO DESKTOP
// (Notification API) để không bỏ lỡ khi đang mở tab khác.
// Chỉ hiện cho Giám đốc/Quản trị, MỘT LẦN trong ngày (lần mở app đầu tiên).

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ExclamationTriangleIcon, SpeakerWaveIcon } from "@heroicons/react/24/outline";
import { api } from "@/lib/api";
import { roleTier } from "@/lib/roles";
import { todayLocal } from "@/lib/format";
import type { Project, User } from "@/lib/types";

const todayKey = todayLocal;
const SHOWN_KEY = "deadlineAlertShown";

/** Hạn nộp của dự án = mốc SỚM NHẤT giữa hạn nội bộ và ngày hoàn thành. */
function dueOf(p: Project): string | null {
  const cands = [p.internal_deadline, p.end_date]
    .filter(Boolean)
    .map((s) => (s as string).slice(0, 10));
  if (!cands.length) return null;
  return cands.sort()[0];
}

function daysLeft(due?: string | null): number | null {
  if (!due) return null;
  const d = new Date(due + "T00:00:00");
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - now.getTime()) / 86_400_000);
}

/** Chuông báo 3 tiếng bằng WebAudio (không cần file âm thanh, chạy cả khi offline). */
function playAlertSound(): void {
  try {
    const Ctx: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const ring = () => {
      const t0 = ctx.currentTime;
      [0, 0.36, 0.72].forEach((offset, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = i === 1 ? 1175 : 880;   // hai cao độ xen kẽ cho dễ chú ý
        gain.gain.setValueAtTime(0.0001, t0 + offset);
        gain.gain.exponentialRampToValueAtTime(0.4, t0 + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.3);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t0 + offset);
        osc.stop(t0 + offset + 0.32);
      });
      window.setTimeout(() => { void ctx.close().catch(() => {}); }, 1600);
    };
    // Trình duyệt chặn phát tiếng khi người dùng CHƯA tương tác -> chờ cú bấm/gõ đầu tiên.
    if (ctx.state === "suspended") {
      const unlock = () => {
        void ctx.resume().then(ring).catch(() => {});
        window.removeEventListener("click", unlock);
        window.removeEventListener("keydown", unlock);
      };
      window.addEventListener("click", unlock, { once: true });
      window.addEventListener("keydown", unlock, { once: true });
      return;
    }
    ring();
  } catch {
    /* noop — không có tiếng thì vẫn còn modal + thông báo desktop */
  }
}

export default function DeadlineAlert({ user }: { user: User | null }) {
  const [near, setNear] = useState<{ p: Project; left: number; due: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [canNotify, setCanNotify] = useState<NotificationPermission | "unsupported">("unsupported");
  const firedRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    setCanNotify(Notification.permission);
  }, []);

  /** Bắn thông báo lên DESKTOP (hiện cả khi đang ở tab/app khác). */
  const notifyDesktop = useCallback((list: { p: Project; left: number; due: string }[]) => {
    try {
      if (typeof window === "undefined" || !("Notification" in window)) return;
      if (Notification.permission !== "granted") return;
      const first = list[0];
      const when =
        first.left < 0 ? `quá hạn ${-first.left} ngày` : first.left === 0 ? "HÔM NAY" : `còn ${first.left} ngày`;
      const overdue = list.filter((x) => x.left < 0).length;
      const n = new Notification("🔔 NHẮC HẠN NỘP HÔM NAY", {
        body:
          `${list.length} dự án còn hạn nộp${overdue ? ` · ${overdue} QUÁ HẠN` : ""}.\n` +
          `Gần nhất: ${first.p.name} — ${when} (hạn ${first.due})`,
        icon: "/logo.png",
        badge: "/logo.png",
        tag: "dosco-deadline",
        requireInteraction: true,
      });
      n.onclick = () => { window.focus(); n.close(); };
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => {
    if (!user || roleTier(user.role) !== "DIRECTOR") return;
    if (firedRef.current) return;
    if (typeof window !== "undefined" && localStorage.getItem(SHOWN_KEY) === todayKey()) return;
    api
      .projects()
      .then((ps) => {
        const list = ps
          .filter((p) => p.status !== "COMPLETED" && p.status !== "CLOSED")
          .map((p) => ({ p, due: dueOf(p) }))
          .filter((x): x is { p: Project; due: string } => !!x.due)
          .map(({ p, due }) => ({ p, due, left: daysLeft(due) as number }))
          // NHẮC HÀNG NGÀY: liệt kê MỌI dự án còn hạn nộp (không chỉ khi sát ngày).
          // Gần hạn / quá hạn xếp lên đầu để nhìn thấy trước.
          .sort((a, b) => a.left - b.left);
        if (!list.length) return;
        firedRef.current = true;
        setNear(list);
        setOpen(true);
        playAlertSound();                                   // KÊU THÀNH TIẾNG
        if (typeof window !== "undefined" && "Notification" in window) {
          if (Notification.permission === "granted") {
            notifyDesktop(list);                            // BÁO TRÊN DESKTOP
          } else if (Notification.permission === "default") {
            Notification.requestPermission()
              .then((perm) => {
                setCanNotify(perm);
                if (perm === "granted") notifyDesktop(list);
              })
              .catch(() => {});
          }
        }
      })
      .catch(() => {});
  }, [user, notifyDesktop]);

  function dismiss() {
    if (typeof window !== "undefined") localStorage.setItem(SHOWN_KEY, todayKey());
    setOpen(false);
  }

  /** Nút kiểm tra: xin quyền (cần cú bấm của người dùng) + kêu thử + bắn thử thông báo. */
  function testAlert() {
    playAlertSound();
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "granted") {
      notifyDesktop(near);
      return;
    }
    Notification.requestPermission()
      .then((perm) => {
        setCanNotify(perm);
        if (perm === "granted") notifyDesktop(near);
      })
      .catch(() => {});
  }

  if (!open || near.length === 0) return null;

  const overdueCount = near.filter((x) => x.left < 0).length;
  const urgentCount = near.filter((x) => x.left >= 0 && x.left <= 5).length;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg overflow-hidden rounded-xl2 bg-white shadow-2xl">
        <div className={`flex items-center gap-3 px-5 py-4 text-white ${overdueCount > 0 || urgentCount > 0 ? "bg-bad" : "bg-steel"}`}>
          <ExclamationTriangleIcon className="h-10 w-10 shrink-0" />
          <div>
            <p className="text-lg font-bold leading-tight lg:text-xl">NHẮC HẠN NỘP HÔM NAY</p>
            <p className="text-xs text-white/90">
              {near.length} dự án còn hạn nộp
              {overdueCount > 0 && <> · <b>{overdueCount} quá hạn</b></>}
              {urgentCount > 0 && <> · <b>{urgentCount} sắp đến hạn (≤5 ngày)</b></>}
            </p>
          </div>
        </div>

        <div className="max-h-[50vh] space-y-2 overflow-y-auto p-4">
          {near.map(({ p, left, due }) => (
            <div key={p.id} className="flex items-center justify-between gap-2 rounded-xl2 border border-line p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{p.name}</p>
                <p className="text-[11px] text-muted">
                  Hạn nộp: <b className="text-ink">{due}</b>
                  {p.internal_deadline && due === p.internal_deadline.slice(0, 10) ? " (hạn nội bộ)" : ""}
                  {" · Quản lý: "}{p.manager_name || "—"}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${
                  left < 0 ? "bg-bad/15 text-bad" : left <= 5 ? "bg-amber/20 text-amber-deep" : "bg-paper text-muted"
                }`}
              >
                {left < 0 ? `Quá ${-left} ngày` : left === 0 ? "Hôm nay!" : `Còn ${left} ngày`}
              </span>
            </div>
          ))}
        </div>

        {canNotify !== "granted" && (
          <p className="border-t border-line bg-amber/10 px-4 py-2 text-[11px] text-amber-deep">
            {canNotify === "denied"
              ? "Thông báo desktop đang bị CHẶN — mở khóa ở biểu tượng ổ khóa trên thanh địa chỉ để nhận báo khi không mở app."
              : "Bấm “Bật thông báo + kêu thử” để cho phép báo trên desktop."}
          </p>
        )}

        <div className="flex flex-wrap gap-2 border-t border-line p-4">
          <button
            onClick={testAlert}
            className="flex items-center justify-center gap-1 rounded-xl2 border border-line px-3 py-2.5 text-xs font-semibold text-steel hover:bg-paper"
          >
            <SpeakerWaveIcon className="h-4 w-4" /> Bật thông báo + kêu thử
          </button>
          <Link
            href="/projects"
            onClick={dismiss}
            className="flex-1 rounded-xl2 bg-ink py-2.5 text-center text-xs font-semibold text-white hover:bg-steel"
          >
            Xem dự án
          </Link>
          <button onClick={dismiss} className="flex-1 rounded-xl2 border border-line py-2.5 text-xs font-semibold text-muted hover:bg-paper">
            Đã hiểu
          </button>
        </div>
      </div>
    </div>
  );
}
