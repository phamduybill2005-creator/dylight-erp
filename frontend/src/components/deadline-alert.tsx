"use client";

// Cảnh báo TO khi có dự án sắp đến hạn (≤5 ngày) hoặc đã quá hạn.
// Chỉ hiện cho Giám đốc, MỘT LẦN trong ngày (lần đăng nhập/mở app đầu tiên).

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { api } from "@/lib/api";
import { roleTier } from "@/lib/roles";
import type { Project, User } from "@/lib/types";

const todayKey = () => new Date().toISOString().slice(0, 10);
const SHOWN_KEY = "deadlineAlertShown";

function daysLeft(end?: string | null): number | null {
  if (!end) return null;
  const d = new Date(end + "T00:00:00");
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - now.getTime()) / 86_400_000);
}

export default function DeadlineAlert({ user }: { user: User | null }) {
  const [near, setNear] = useState<{ p: Project; left: number }[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!user || roleTier(user.role) !== "DIRECTOR") return;
    if (typeof window !== "undefined" && localStorage.getItem(SHOWN_KEY) === todayKey()) return;
    api
      .projects()
      .then((ps) => {
        const list = ps
          .filter((p) => p.status !== "COMPLETED" && p.status !== "CANCELLED" && p.end_date)
          .map((p) => ({ p, left: daysLeft(p.end_date) as number }))
          .filter((x) => x.left !== null && x.left <= 5)
          .sort((a, b) => a.left - b.left);
        if (list.length) {
          setNear(list);
          setOpen(true);
        }
      })
      .catch(() => {});
  }, [user]);

  function dismiss() {
    if (typeof window !== "undefined") localStorage.setItem(SHOWN_KEY, todayKey());
    setOpen(false);
  }

  if (!open || near.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg overflow-hidden rounded-xl2 bg-white shadow-2xl">
        <div className="flex items-center gap-3 bg-bad px-5 py-4 text-white">
          <ExclamationTriangleIcon className="h-10 w-10 shrink-0" />
          <div>
            <p className="text-lg font-bold leading-tight lg:text-xl">SẮP ĐẾN HẠN DỰ ÁN!</p>
            <p className="text-xs text-white/90">{near.length} dự án cần chú ý (còn ≤ 5 ngày hoặc đã quá hạn)</p>
          </div>
        </div>

        <div className="max-h-[50vh] space-y-2 overflow-y-auto p-4">
          {near.map(({ p, left }) => (
            <div key={p.id} className="flex items-center justify-between gap-2 rounded-xl2 border border-line p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{p.name}</p>
                <p className="text-[11px] text-muted">Hạn: {p.end_date} · Quản lý: {p.manager_name || "—"}</p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${
                  left < 0 ? "bg-bad/15 text-bad" : "bg-amber/20 text-amber-deep"
                }`}
              >
                {left < 0 ? `Quá ${-left} ngày` : left === 0 ? "Hôm nay!" : `Còn ${left} ngày`}
              </span>
            </div>
          ))}
        </div>

        <div className="flex gap-2 border-t border-line p-4">
          <Link
            href="/project-progress"
            onClick={dismiss}
            className="flex-1 rounded-xl2 bg-ink py-2.5 text-center text-xs font-semibold text-white hover:bg-steel"
          >
            Xem tiến độ dự án
          </Link>
          <button onClick={dismiss} className="flex-1 rounded-xl2 border border-line py-2.5 text-xs font-semibold text-muted hover:bg-paper">
            Đã hiểu
          </button>
        </div>
      </div>
    </div>
  );
}
