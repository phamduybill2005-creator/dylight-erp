"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeftIcon, ArrowsPointingOutIcon, MinusIcon, PlusIcon } from "@heroicons/react/24/outline";

let openDialogs = 0;
let previousOverflow = "";

/** Native dialogs isolate focus, including sheets opened above the chart. */
export function OrgChartDialog({ label, onClose, fullScreen = false, children }: {
  label: string;
  onClose: () => void;
  fullScreen?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current!;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (openDialogs++ === 0) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    dialog.showModal();
    return () => {
      dialog.close();
      if (--openDialogs === 0) document.body.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <dialog
      ref={ref}
      aria-label={label}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden bg-transparent p-0 text-ink outline-none backdrop:bg-slate-900/40 backdrop:backdrop-blur-sm"
    >
      {fullScreen ? children : (
        <div
          className="flex h-full items-end justify-center sm:items-center sm:p-4"
          onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
        >
          {children}
        </div>
      )}
    </dialog>,
    document.body,
  );
}

export function fitOrgChart(width: number, height: number, viewportWidth: number, viewportHeight: number) {
  if ([width, height, viewportWidth, viewportHeight].some(value => !Number.isFinite(value) || value <= 0)) return 1;
  return Math.min(1, Math.max(1, viewportWidth - 32) / width, Math.max(1, viewportHeight - 32) / height);
}

export default function OrgChartViewer({ children, toolbar, onClose }: {
  children: ReactNode;
  toolbar: ReactNode;
  onClose: () => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const dragged = useRef(false);
  const [size, setSize] = useState({ width: 1, height: 1, viewportWidth: 1, viewportHeight: 1 });
  const [zoom, setZoom] = useState<number | null>(null);
  const fit = fitOrgChart(size.width, size.height, size.viewportWidth, size.viewportHeight);
  const scale = zoom ?? fit;
  const minZoom = Math.min(0.25, fit);

  useEffect(() => {
    const measure = () => {
      if (!viewport.current || !canvas.current) return;
      const next = {
        width: canvas.current.offsetWidth,
        height: canvas.current.offsetHeight,
        viewportWidth: viewport.current.clientWidth,
        viewportHeight: viewport.current.clientHeight,
      };
      setSize(prior => Object.keys(next).every(key => next[key as keyof typeof next] === prior[key as keyof typeof prior]) ? prior : next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(viewport.current!);
    observer.observe(canvas.current!);
    measure();
    return () => observer.disconnect();
  }, []);

  const changeZoom = (next: number | null) => {
    const el = viewport.current;
    const target = next === null ? fit : Math.min(2, Math.max(minZoom, next));
    // Retain the point at the center of the viewport while zooming.
    const x = el ? (el.scrollLeft + el.clientWidth / 2 - Math.max(16, (el.clientWidth - size.width * scale) / 2)) / scale : 0;
    const y = el ? (el.scrollTop + el.clientHeight / 2 - Math.max(16, (el.clientHeight - size.height * scale) / 2)) / scale : 0;
    setZoom(next === null ? null : target);
    requestAnimationFrame(() => {
      if (!el) return;
      el.scrollTo({
        left: next === null ? 0 : x * target + Math.max(16, (el.clientWidth - size.width * target) / 2) - el.clientWidth / 2,
        top: next === null ? 0 : y * target + Math.max(16, (el.clientHeight - size.height * target) / 2) - el.clientHeight / 2,
      });
    });
  };

  return (
    <OrgChartDialog label="Sơ đồ tổ chức công ty" onClose={onClose} fullScreen>
      <div className="flex h-full flex-col bg-slate-50 pt-[env(safe-area-inset-top)]">
        <header className="flex shrink-0 items-center gap-3 border-b border-line bg-white px-3 py-3">
          <button autoFocus type="button" onClick={onClose} aria-label="Đóng sơ đồ" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line text-steel hover:bg-slate-50">
            <ArrowLeftIcon className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-ink">Sơ đồ tổ chức</h2>
            <p className="text-xs text-muted">Kéo để di chuyển · Chạm nhân sự để xem</p>
          </div>
        </header>
        <div className="shrink-0 border-b border-line/60 bg-white px-4 py-2">{toolbar}</div>

        <div
          ref={viewport}
          tabIndex={0}
          aria-label="Vùng xem sơ đồ, kéo hoặc cuộn để di chuyển"
          className="min-h-0 flex-1 cursor-grab touch-pan-x touch-pan-y overflow-auto overscroll-contain bg-[radial-gradient(#cbd5e1_1px,transparent_1px)] [background-size:20px_20px] active:cursor-grabbing"
          onPointerDown={(event) => {
            if (event.pointerType !== "mouse" || event.button !== 0) return;
            dragged.current = false;
            drag.current = { x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop };
          }}
          onPointerMove={(event) => {
            if (!drag.current) return;
            const dx = event.clientX - drag.current.x, dy = event.clientY - drag.current.y;
            if (!dragged.current && Math.hypot(dx, dy) < 5) return;
            dragged.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            event.currentTarget.scrollLeft = drag.current.left - dx;
            event.currentTarget.scrollTop = drag.current.top - dy;
            event.preventDefault();
          }}
          onPointerUp={(event) => {
            drag.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => { drag.current = null; dragged.current = false; }}
          onClickCapture={(event) => {
            if (!dragged.current) return;
            dragged.current = false;
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <div className="flex min-h-full w-max min-w-full items-center justify-center p-4">
            <div className="relative shrink-0" style={{ width: size.width * scale, height: size.height * scale }}>
              <div ref={canvas} className="absolute left-0 top-0 w-max min-w-[600px] origin-top-left p-3" style={{ transform: `scale(${scale})` }}>
                {children}
              </div>
            </div>
          </div>
        </div>

        <footer className="flex shrink-0 items-center justify-center gap-2 border-t border-line bg-white px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="flex items-center rounded-xl border border-line bg-slate-50">
            <button type="button" aria-label="Thu nhỏ sơ đồ" disabled={scale <= minZoom} onClick={() => changeZoom(scale / 1.25)} className="flex h-11 w-11 items-center justify-center rounded-l-xl text-steel hover:bg-slate-100 disabled:opacity-30">
              <MinusIcon className="h-5 w-5" />
            </button>
            <output className="w-12 text-center text-xs font-semibold tabular-nums text-steel" aria-label="Mức phóng sơ đồ">{Math.round(scale * 100)}%</output>
            <button type="button" aria-label="Phóng to sơ đồ" disabled={scale >= 2} onClick={() => changeZoom(scale * 1.25)} className="flex h-11 w-11 items-center justify-center rounded-r-xl text-steel hover:bg-slate-100 disabled:opacity-30">
              <PlusIcon className="h-5 w-5" />
            </button>
          </div>
          <button type="button" onClick={() => changeZoom(null)} className="inline-flex h-11 items-center gap-2 rounded-xl bg-ink px-3 text-xs font-semibold text-white hover:bg-steel">
            <ArrowsPointingOutIcon className="h-4 w-4" />
            Vừa màn hình
          </button>
        </footer>
      </div>
    </OrgChartDialog>
  );
}
