import Link from "next/link";
import type { Project } from "@/lib/types";

export default function DeadlineProjectLink({ project: p, due, onOpen }: {
  project: Project;
  due: string;
  onOpen: () => void;
}) {
  return (
    <Link href={`/projects/${p.id}`} onClick={onOpen} className="flex items-center justify-between gap-2 rounded-xl2 border border-line p-3 transition-colors hover:bg-paper focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel">
      <div className="min-w-0">
        <p className="text-xs font-bold text-steel">{p.code}</p>
        <p className="text-sm font-semibold text-ink">{p.name}</p>
        <p className="text-[11px] text-muted">
          Hạn nộp: <b className="text-ink">{due}</b>
          {p.internal_deadline && due === p.internal_deadline.slice(0, 10) ? " (hạn nội bộ)" : ""}
          {" · Quản lý: "}{p.manager_name || "—"}
        </p>
      </div>
      <span className="shrink-0 rounded-full bg-amber/20 px-2.5 py-1 text-xs font-bold text-amber-deep">Hôm nay!</span>
    </Link>
  );
}
