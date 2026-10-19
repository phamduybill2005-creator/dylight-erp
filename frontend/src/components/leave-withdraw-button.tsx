import { ArrowUturnLeftIcon } from "@heroicons/react/24/outline";
import type { LeaveRequest } from "@/lib/types";

type WithdrawableLeave = Pick<LeaveRequest, "id" | "user_id" | "status" | "source">;

export function canWithdrawLeave(userId: number, leave: WithdrawableLeave): boolean {
  return leave.user_id === userId && leave.status === "PENDING"
    && (leave.source == null || leave.source === "LEAVE");
}

export function LeaveWithdrawButton({ leave, userId, busy, withdrawing, onWithdraw }: {
  leave: WithdrawableLeave;
  userId: number;
  busy: boolean;
  withdrawing: boolean;
  onWithdraw: (id: number) => void;
}) {
  if (!canWithdrawLeave(userId, leave)) return null;
  return (
    <button type="button" disabled={busy} onClick={() => onWithdraw(leave.id)}
      className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-semibold text-steel hover:bg-paper disabled:opacity-50">
      <ArrowUturnLeftIcon className="h-4 w-4" aria-hidden="true" />
      {withdrawing ? "Đang thu hồi…" : "Thu hồi"}
    </button>
  );
}
