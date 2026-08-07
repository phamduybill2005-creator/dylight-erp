"use client";

import { useEffect, useState } from "react";
import { BoltIcon, ShieldCheckIcon, FireIcon } from "@heroicons/react/24/solid";

// ==================== BẢN VẼ IRON MAN LIVE WALLPAPER VIDEO FOR D.H.SON ====================
export function ArcReactorWatermark() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 flex items-center justify-center overflow-hidden opacity-65">
      <div className="relative flex items-center justify-center">
        {/* Vòng hào quang Neon Cyan & Gold phản chiếu rộng */}
        <div className="absolute h-[650px] w-[650px] lg:h-[850px] lg:w-[850px] rounded-full bg-gradient-to-r from-cyan-500/30 via-red-600/30 to-amber-500/30 blur-[130px] animate-pulse" />

        {/* Video chuyển động Live Wallpaper Iron Man chuẩn từ link Pinterest */}
        <div className="relative flex items-center justify-center rounded-3xl p-2 bg-black/40 border-2 border-cyan-400/60 shadow-[0_0_100px_rgba(0,240,255,0.6)] backdrop-blur-md">
          <video
            src="/ironman_video.mp4"
            autoPlay
            loop
            muted
            playsInline
            className="h-[520px] w-auto lg:h-[680px] object-contain rounded-2xl filter drop-shadow-[0_0_60px_rgba(0,240,255,0.8)]"
          />
        </div>
      </div>
    </div>
  );
}

// ==================== PURE STARK INDUSTRIES HERO BANNER WITH IRONMAN.MP4 VIDEO ====================
export function IronManBanner({ fullName }: { fullName: string }) {
  const [power, setPower] = useState(100);

  useEffect(() => {
    const interval = setInterval(() => {
      setPower(Math.floor(98 + Math.random() * 3));
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <section className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-red-950/45 via-red-900/35 to-black/45 backdrop-blur-md p-5 lg:p-7 text-white shadow-[0_0_50px_rgba(220,38,38,0.4)] border-2 border-amber-400/70 transition-all duration-500 hover:border-cyan-400/90 hover:shadow-[0_0_70px_rgba(0,240,255,0.5)]">
      {/* Hiệu ứng Cyber Grid Scanline */}
      <div className="absolute inset-0 opacity-15 bg-[linear-gradient(to_right,#00f0ff_1px,transparent_1px),linear-gradient(to_bottom,#00f0ff_1px,transparent_1px)] bg-[size:20px_20px] pointer-events-none" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_0%,rgba(0,240,255,0.08)_50%,transparent_100%)] animate-[pulse_4s_infinite] pointer-events-none" />

      {/* Tỏa sáng Arc Reactor góc phải */}
      <div className="absolute -right-12 -top-12 h-64 w-64 rounded-full bg-cyan-500/25 blur-3xl pointer-events-none" />
      <div className="absolute left-1/4 -bottom-10 h-48 w-48 rounded-full bg-amber-500/25 blur-3xl pointer-events-none" />

      <div className="relative z-10 flex flex-wrap items-center justify-between gap-6">
        {/* Cột trái: Thông tin Thuần Iron Man & Xin chào D.H.SON */}
        <div className="space-y-3 max-w-2xl">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-black/80 border border-amber-400 px-3.5 py-1 text-[11px] font-extrabold uppercase tracking-widest text-amber-300 shadow-[0_0_15px_rgba(255,215,0,0.5)]">
              ⚡ STARK INDUSTRIES — MARK 85 🦾
            </span>
            <span className="rounded-full bg-cyan-500/20 border border-cyan-400/60 px-3 py-0.5 text-[10px] font-bold tracking-wide text-cyan-300">
              IRON MAN SYSTEM ONLINE
            </span>
          </div>

          <h1 className="text-2xl lg:text-4xl font-black tracking-tight text-white drop-shadow-[0_2px_10px_rgba(255,215,0,0.6)]">
            Xin chào, <span className="bg-gradient-to-r from-yellow-300 via-amber-400 to-red-400 bg-clip-text text-transparent">{fullName}</span>! 🦾
          </h1>

          <p className="text-xs lg:text-sm text-cyan-200/95 font-mono tracking-wide italic">
            "I am Iron Man. Mark 85 Titanium Nanotech Suit Loaded & Ready for DOSCO Operations." ⚡
          </p>

          {/* Chỉ số HUD thuần Iron Man */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2 text-[11px] font-mono">
            <div className="flex items-center gap-1.5 rounded-lg bg-black/60 border border-cyan-500/50 px-2.5 py-1 text-cyan-300 shadow-md">
              <BoltIcon className="h-4 w-4 text-cyan-400 animate-pulse" />
              <span>ARC CORE: <strong className="text-white">{power}%</strong></span>
            </div>
            <div className="flex items-center gap-1.5 rounded-lg bg-black/60 border border-amber-500/50 px-2.5 py-1 text-yellow-300 shadow-md">
              <ShieldCheckIcon className="h-4 w-4 text-yellow-400" />
              <span>RANK: <strong className="text-white">DIRECTOR</strong></span>
            </div>
            <div className="flex items-center gap-1.5 rounded-lg bg-black/60 border border-red-500/50 px-2.5 py-1 text-red-300 col-span-2 sm:col-span-1 shadow-md">
              <FireIcon className="h-4 w-4 text-red-400" />
              <span>MARK 85: <strong className="text-white">PRIMED</strong></span>
            </div>
          </div>
        </div>

        {/* Cột phải: Video chuyển động ironman.mp4 lồng vào khung giáp Iron Man */}
        <div className="relative shrink-0 my-1 flex items-center justify-center">
          <div className="absolute -inset-2 rounded-2xl bg-gradient-to-r from-cyan-400 via-red-600 to-amber-400 blur-xl opacity-90 animate-pulse" />
          
          <div className="relative flex flex-col items-center justify-center overflow-hidden rounded-2xl bg-black/90 p-1.5 border-2 border-amber-400 shadow-2xl h-40 w-40 sm:h-44 sm:w-44 lg:h-52 lg:w-52 transition-transform duration-300 hover:scale-105">
            <video
              src="/ironman.mp4"
              autoPlay
              loop
              muted
              playsInline
              className="h-full w-full object-cover rounded-xl filter drop-shadow-[0_0_20px_rgba(0,240,255,0.8)]"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
