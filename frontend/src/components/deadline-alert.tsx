"use client";

// NHẮC HẠN NỘP: chỉ liệt kê dự án có hạn nộp ĐÚNG HÔM NAY.
// Hạn nộp = mốc SỚM NHẤT giữa "Hạn nội bộ" và "Ngày hoàn thành".
// Ngoài modal trong app, còn: KÊU THÀNH TIẾNG (WebAudio) + THÔNG BÁO DESKTOP
// (Notification API) để không bỏ lỡ khi đang mở tab khác.
// Chỉ hiện cho Giám đốc/Quản trị, nhắc lại tối đa 15 phút/lần trong ngày đến hạn.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ExclamationTriangleIcon, SpeakerWaveIcon } from "@heroicons/react/24/outline";
import { api } from "@/lib/api";
import { roleTier } from "@/lib/roles";
import { projectsDueToday, type DeadlineAlertEntry } from "@/lib/deadline-alert";
import { todayLocal } from "@/lib/format";
import { desktopPermission, requestDesktopPermission, showDesktopNotification, dispatchDesktopClick, DESKTOP_CLICK_EVENT, type DesktopClick, type DesktopPermission } from "@/lib/desktop-notifications";
import type { User } from "@/lib/types";

// Mốc THỜI ĐIỂM (epoch ms) lần nhắc gần nhất — để giới hạn tối đa 15 phút/lần.
const SHOWN_KEY = "deadlineAlertLastMs";

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
  const [near, setNear] = useState<DeadlineAlertEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [canNotify, setCanNotify] = useState<DesktopPermission>("unsupported");
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const refresh = () => setCanNotify(desktopPermission());
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  /** Bắn thông báo lên DESKTOP (hiện cả khi đang ở tab/app khác). */
  const notifyDesktop = useCallback((list: DeadlineAlertEntry[]) => {
    const first = list[0];
    if (!first) return;
    showDesktopNotification("🔔 NHẮC HẠN NỘP HÔM NAY", {
      body:
        `${list.length} dự án đến hạn nộp hôm nay.\n` +
        `${first.p.name} — hạn ${first.due}`,
      tag: "dosco-deadline",
      requireInteraction: true,
    }, () => dispatchDesktopClick({ kind: "deadline", entries: list }));
  }, []);

  useEffect(() => {
    if (!user || roleTier(user.role) !== "DIRECTOR") return;
    const onDesktopClick = (event: Event) => {
      const detail = (event as CustomEvent<DesktopClick>).detail;
      if (detail?.kind !== "deadline") return;
      const list = projectsDueToday(detail.entries.map((entry) => entry.p), todayLocal());
      if (!list.length) return;
      setNear(list);
      setOpen(true);
    };
    window.addEventListener(DESKTOP_CLICK_EVENT, onDesktopClick);
    return () => window.removeEventListener(DESKTOP_CLICK_EVENT, onDesktopClick);
  }, [user]);

  /** Kêu + báo desktop ngay lập tức (dùng cho lần đầu và mỗi lần nhắc lại). */
  const alertNow = useCallback(
    (list: DeadlineAlertEntry[]) => {
      playAlertSound();
      notifyDesktop(list);
    },
    [notifyDesktop],
  );

  // Giữ trạng thái "đang mở" trong ref để vòng kiểm tra không tự bật lại khi popup còn hiện.
  const openRef = useRef(false);
  useEffect(() => { openRef.current = open; }, [open]);

  // NHẮC TỐI ĐA 15 PHÚT / LẦN — không bật lại sau mỗi lần bấm/chuyển trang.
  // Dùng localStorage timestamp để giới hạn xuyên suốt (kể cả khi component mount lại).
  useEffect(() => {
    if (!user || roleTier(user.role) !== "DIRECTOR") return;
    let alive = true;
    const THROTTLE = 15 * 60 * 1000;   // 15 phút

    const check = () => {
      if (!alive || openRef.current) return;   // đang mở thì để yên
      const last = Number((typeof window !== "undefined" && localStorage.getItem(SHOWN_KEY)) || 0);
      if (Date.now() - last < THROTTLE) return; // chưa đủ 15 phút kể từ lần nhắc trước
      api
        .projects()
        .then((ps) => {
          if (!alive || openRef.current) return;
          const list = projectsDueToday(ps, todayLocal());
          if (!list.length) return;
          setNear(list);
          setOpen(true);
          alertNow(list);                       // KÊU THÀNH TIẾNG + BÁO DESKTOP
          localStorage.setItem(SHOWN_KEY, String(Date.now()));
        })
        .catch(() => {});
    };

    check();                                     // kiểm tra ngay khi mở app
    timerRef.current = window.setInterval(check, 60_000);   // mỗi phút xem đã tới 15' chưa
    return () => {
      alive = false;
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [user, alertNow]);

  function dismiss() {
    // Đóng lại — mốc 15 phút đã đặt lúc hiện, nên sẽ không bật lại trước 15 phút.
    setOpen(false);
  }

  /** Nút kiểm tra: xin quyền (cần cú bấm của người dùng) + kêu thử + bắn thử thông báo. */
  async function testAlert() {
    playAlertSound();
    const permission = await requestDesktopPermission();
    setCanNotify(permission);
    if (permission === "granted") notifyDesktop(near);
  }

  if (!open || near.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg overflow-hidden rounded-xl2 bg-white shadow-2xl">
        <div className="flex items-center gap-3 bg-bad px-5 py-4 text-white">
          <ExclamationTriangleIcon className="h-10 w-10 shrink-0" />
          <div>
            <p className="text-lg font-bold leading-tight lg:text-xl">NHẮC HẠN NỘP HÔM NAY</p>
            <p className="text-xs text-white/90">
              {near.length} dự án đến hạn nộp hôm nay
            </p>
          </div>
        </div>

        <div className="max-h-[50vh] space-y-2 overflow-y-auto p-4">
          {near.map(({ p, due }) => (
            <div key={p.id} className="flex items-center justify-between gap-2 rounded-xl2 border border-line p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{p.name}</p>
                <p className="text-[11px] text-muted">
                  Hạn nộp: <b className="text-ink">{due}</b>
                  {p.internal_deadline && due === p.internal_deadline.slice(0, 10) ? " (hạn nội bộ)" : ""}
                  {" · Quản lý: "}{p.manager_name || "—"}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-amber/20 px-2.5 py-1 text-xs font-bold text-amber-deep">
                Hôm nay!
              </span>
            </div>
          ))}
        </div>

        {canNotify !== "granted" && (
          <p className="border-t border-line bg-amber/10 px-4 py-2 text-[11px] text-amber-deep">
            {canNotify === "denied"
              ? "Thông báo desktop đang bị CHẶN — chọn Cho phép trong cài đặt trang bên trái thanh địa chỉ. Giữ một tab DOSCO mở để nhận báo."
              : canNotify === "unsupported"
              ? "Trình duyệt chưa hỗ trợ thông báo desktop. Hãy mở DOSCO bằng HTTPS trên Chrome/Edge máy tính."
              : "Bấm “Bật thông báo + kêu thử” để cho phép báo desktop khi giữ một tab DOSCO mở."}
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
