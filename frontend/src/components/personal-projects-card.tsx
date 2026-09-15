"use client";

import { useRef } from "react";
import Link from "next/link";
import { ArrowRightIcon, FolderOpenIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { formatDate } from "@/lib/format";
import { personalProjects } from "@/lib/personal-projects";
import { leadDisplayName } from "@/lib/project-lead";
import type { Project, ProjectStatus, User } from "@/lib/types";

const STATUS: Record<ProjectStatus, string> = {
  PLANNING: "Chuẩn bị", IN_PROGRESS: "Đang làm", ON_HOLD: "Tạm dừng",
  COMPLETED: "Hoàn thành", CLOSED: "Đã đóng",
};

export default function PersonalProjectsCard({ user, projects, loaded, error, onRefresh, ironMan = false }: {
  user: User;
  projects: Project[];
  loaded: boolean;
  error: string | null;
  onRefresh: () => void;
  ironMan?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const mine = personalProjects(projects, user);

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => { dialog.current?.showModal(); onRefresh(); }}
        className={`w-full rounded-xl2 p-4 lg:p-6 text-left text-white card-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-500 ${
          ironMan
            ? "bg-black/45 backdrop-blur-md border-2 border-cyan-500/60 shadow-[0_0_25px_rgba(0,240,255,0.25)]"
            : "bg-gradient-to-br from-slate-900 to-ink border border-white/5"
        }`}
      >
        <p className="text-xs text-cyan-200/70 font-mono">Dự án tôi đang tham gia</p>
        <p aria-live="polite" className="mt-2 text-3xl lg:text-4xl font-bold tnum text-cyan-400 drop-shadow-[0_0_10px_rgba(0,240,255,0.7)]">
          {loaded ? mine.length : "—"}
        </p>
        <p className="mt-1 flex items-center gap-2 text-[11px] text-white/70">
          {error ? "Chưa cập nhật được · Bấm để thử lại" : "Xem các dự án của tôi"}
          <ArrowRightIcon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        </p>
      </button>

      <dialog
        ref={dialog}
        aria-labelledby="personal-projects-title"
        className="m-auto w-[calc(100%-2rem)] max-w-2xl max-h-[85vh] rounded-2xl border border-line bg-paper p-0 text-ink shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm"
        onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-line bg-white px-5 py-4">
          <div>
            <h2 id="personal-projects-title" className="flex items-center gap-2 text-base font-bold">
              <FolderOpenIcon aria-hidden="true" className="h-5 w-5 text-steel" /> Dự án tôi đang tham gia
            </h2>
            <p className="mt-1 text-xs text-muted">{loaded ? `${mine.length} dự án` : "Đang tải…"} · {user.full_name}</p>
          </div>
          <button type="button" autoFocus aria-label="Đóng danh sách dự án" onClick={() => dialog.current?.close()} className="rounded-lg p-2 text-muted hover:bg-paper hover:text-ink">
            <XMarkIcon aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-3 p-4">
          {error && (
            <div role="alert" className="rounded-xl border border-amber/40 bg-amber/10 p-3 text-sm">
              <p>{error}{loaded ? " Danh sách bên dưới là lần tải thành công gần nhất." : ""}</p>
              <button type="button" onClick={onRefresh} className="mt-2 font-semibold text-steel underline">Thử lại</button>
            </div>
          )}
          {!loaded && !error && <p role="status" className="py-6 text-center text-sm text-muted">Đang tải dự án của bạn…</p>}
          {loaded && mine.length === 0 && <p className="py-6 text-center text-sm text-muted">Bạn chưa tham gia dự án nào đang thực hiện.</p>}
          {mine.map((project) => {
            const percent = Math.min(100, Math.max(0, Number(project.progress_percent) || 0));
            return (
              <Link key={project.id} href={`/projects/${project.id}`} onClick={() => dialog.current?.close()} className="block rounded-xl border border-line bg-white p-4 transition-colors hover:border-steel focus-visible:outline-steel">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="rounded bg-steel/10 px-2 py-0.5 text-xs font-semibold text-steel">{project.code}</span>
                  <span className="text-xs text-muted">{STATUS[project.status]}</span>
                </div>
                <h3 className="mt-2 break-words text-sm font-semibold">{project.name}</h3>
                <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                  <div><dt className="text-muted">Vai trò của bạn</dt><dd>{project.lead_id === user.id ? "Chủ trì" : "Thành viên"}</dd></div>
                  <div><dt className="text-muted">Chủ trì</dt><dd>{leadDisplayName(project) || "Chưa phân công"}</dd></div>
                  <div><dt className="text-muted">Bắt đầu</dt><dd>{formatDate(project.start_date)}</dd></div>
                  <div><dt className="text-muted">Hạn nội bộ</dt><dd>{formatDate(project.internal_deadline)}</dd></div>
                  {project.location && <div className="sm:col-span-2"><dt className="text-muted">Địa điểm</dt><dd>{project.location}</dd></div>}
                </dl>
                <div className="mt-3 flex items-center justify-between text-xs"><span className="text-muted">Tiến độ</span><span>{Math.round(percent)}%</span></div>
                <div role="progressbar" aria-label={`Tiến độ ${project.code}`} aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100} className="mt-1 h-1.5 overflow-hidden rounded-full bg-line">
                  <div className="h-full rounded-full bg-steel" style={{ width: `${percent}%` }} />
                </div>
                <p className="mt-3 flex items-center gap-1 text-xs font-semibold text-steel">Xem chi tiết dự án <ArrowRightIcon aria-hidden="true" className="h-3.5 w-3.5" /></p>
              </Link>
            );
          })}
        </div>
      </dialog>
    </>
  );
}
