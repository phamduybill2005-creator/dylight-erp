"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { StarIcon } from "@heroicons/react/24/outline";
import { roleTier } from "@/lib/roles";
import { todayLocal } from "@/lib/format";
import type { User } from "@/lib/types";

const todayKey = todayLocal;
const SHOWN_KEY = "evaluationAlertShown";

export default function EvaluationAlert({ user }: { user: User | null }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!user || roleTier(user.role) !== "STAFF") return;
    
    // Kiểm tra xem hôm nay có phải thứ 7 không (getDay() === 6)
    const today = new Date();
    const isSaturday = today.getDay() === 6;
    if (!isSaturday) return;

    // Chỉ hiện một lần trong ngày
    if (typeof window !== "undefined" && localStorage.getItem(SHOWN_KEY) === todayKey()) return;

    setOpen(true);
  }, [user]);

  function dismiss() {
    if (typeof window !== "undefined") localStorage.setItem(SHOWN_KEY, todayKey());
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-xl2 bg-white shadow-2xl border border-amber/20">
        <div className="flex items-center gap-3 bg-gradient-to-r from-amber-500 to-amber-600 px-5 py-4 text-white">
          <StarIcon className="h-9 w-9 shrink-0 text-yellow-200" />
          <div>
            <p className="text-base font-bold leading-tight">ĐÁNH GIÁ QUẢN LÝ ĐỊNH KỲ</p>
            <p className="text-[11px] text-white/90">Hôm nay là Thứ 7. Vui lòng thực hiện đánh giá quản lý theo dự án và người quản lý trực tiếp.</p>
          </div>
        </div>

        <div className="p-5 text-center text-xs text-ink space-y-3">
          <p className="font-semibold text-muted">
            Ý kiến đánh giá của bạn giúp nâng cao hiệu quả quản trị dự án và cải thiện môi trường làm việc tốt hơn.
          </p>
          <p className="text-[10px] text-muted italic">
            * Đánh giá được bảo mật thông tin người gửi.
          </p>
        </div>

        <div className="flex gap-2 border-t border-line p-4">
          <Link
            href="/evaluations"
            onClick={dismiss}
            className="flex-1 rounded-xl2 bg-amber py-2.5 text-center text-xs font-bold text-ink hover:bg-amber-deep hover:text-white transition-all shadow-md"
          >
            Đến trang đánh giá
          </Link>
          <button onClick={dismiss} className="flex-1 rounded-xl2 border border-line py-2.5 text-xs font-semibold text-muted hover:bg-paper">
            Để sau
          </button>
        </div>
      </div>
    </div>
  );
}
