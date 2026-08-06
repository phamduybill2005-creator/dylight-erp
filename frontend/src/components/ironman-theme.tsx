"use client";

import { useEffect, useState } from "react";
import { BoltIcon, ShieldCheckIcon, CpuChipIcon, FireIcon } from "@heroicons/react/24/solid";

// ==================== BẢN VẼ ARC REACTOR CORE (STARK INDUSTRIES) ====================
export function ArcReactorWatermark() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 flex items-center justify-center overflow-hidden opacity-20">
      <div className="relative flex items-center justify-center">
        {/* Vòng hào quang Neon Blue Cyan phản chiếu rộng */}
        <div className="absolute h-[600px] w-[600px] lg:h-[750px] lg:w-[750px] rounded-full bg-cyan-500/20 blur-[100px] animate-pulse" />
        
        {/* SVG Arc Reactor quay 360 độ huyền ảo */}
        <svg
          viewBox="0 0 500 500"
          className="h-[500px] w-[500px] lg:h-[650px] lg:w-[650px] max-w-none animate-[spin_60s_linear_infinite] filter drop-shadow-[0_0_50px_rgba(0,240,255,0.6)]"
        >
          {/* Vòng ngoài Titanium Metallic */}
          <circle cx="250" cy="250" r="230" fill="none" stroke="#D4AF37" strokeWidth="4" strokeDasharray="15 10" />
          <circle cx="250" cy="250" r="215" fill="none" stroke="#00F0FF" strokeWidth="8" opacity="0.8" />
          <circle cx="250" cy="250" r="195" fill="none" stroke="#FFD700" strokeWidth="2" strokeDasharray="5 5" />
          
          {/* 10 Cuộn cảm biến năng lượng Arc LED */}
          {Array.from({ length: 10 }).map((_, i) => {
            const angle = (i * 36) * (Math.PI / 180);
            const x1 = 250 + 140 * Math.cos(angle);
            const y1 = 250 + 140 * Math.sin(angle);
            const x2 = 250 + 185 * Math.cos(angle);
            const y2 = 250 + 185 * Math.sin(angle);
            return (
              <g key={i}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#00F0FF" strokeWidth="12" strokeLinecap="round" />
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#FFFFFF" strokeWidth="4" strokeLinecap="round" />
              </g>
            );
          })}

          {/* Vòng trong & Lõi Palladium Cyan phát sáng */}
          <circle cx="250" cy="250" r="120" fill="none" stroke="#00F0FF" strokeWidth="6" />
          <polygon points="250,155 330,295 170,295" fill="none" stroke="#FFD700" strokeWidth="5" />
          <polygon points="250,345 170,205 330,205" fill="none" stroke="#00F0FF" strokeWidth="5" opacity="0.9" />
          <circle cx="250" cy="250" r="65" fill="#00F0FF" opacity="0.25" />
          <circle cx="250" cy="250" r="45" fill="#FFFFFF" opacity="0.9" className="animate-ping" />
          <circle cx="250" cy="250" r="35" fill="#00F0FF" />
        </svg>
      </div>
    </div>
  );
}

// ==================== HERO BANNER IRON MAN MARK 85 FOR D.H.SON ====================
export function IronManBanner({ fullName }: { fullName: string }) {
  const [power, setPower] = useState(100);

  useEffect(() => {
    const interval = setInterval(() => {
      setPower(Math.floor(98 + Math.random() * 3));
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <section className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#3B0004] via-[#7A000A] to-[#0D050B] p-5 lg:p-7 text-white shadow-[0_0_40px_rgba(255,0,0,0.35)] border-2 border-yellow-500/50 transition-all duration-500 hover:border-cyan-400/80 hover:shadow-[0_0_60px_rgba(0,240,255,0.4)]">
      {/* Hiệu ứng Cyber Grid Scanline */}
      <div className="absolute inset-0 opacity-15 bg-[linear-gradient(to_right,#00f0ff_1px,transparent_1px),linear-gradient(to_bottom,#00f0ff_1px,transparent_1px)] bg-[size:20px_20px] pointer-events-none" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_0%,rgba(0,240,255,0.08)_50%,transparent_100%)] animate-[pulse_4s_infinite] pointer-events-none" />

      {/* Arc Reactor thu nhỏ tỏa sáng góc phải */}
      <div className="absolute -right-12 -top-12 h-64 w-64 rounded-full bg-cyan-500/20 blur-3xl pointer-events-none" />
      <div className="absolute left-1/4 -bottom-10 h-48 w-48 rounded-full bg-amber-500/20 blur-3xl pointer-events-none" />

      <div className="relative z-10 flex flex-wrap items-center justify-between gap-6">
        {/* Cột trái: Thông tin J.A.R.V.I.S Protocol & Xin chào D.H.SON */}
        <div className="space-y-3 max-w-2xl">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-black/80 border border-cyan-400 px-3 py-1 text-[11px] font-extrabold uppercase tracking-widest text-cyan-300 shadow-[0_0_15px_rgba(0,240,255,0.5)]">
              <CpuChipIcon className="h-3.5 w-3.5 animate-spin text-cyan-400" />
              STARK INDUSTRIES PROTOCOL — MARK 85 🤖
            </span>
            <span className="rounded-full bg-amber-500/20 border border-amber-400/60 px-2.5 py-0.5 text-[10px] font-bold tracking-wide text-yellow-300">
              J.A.R.V.I.S. ONLINE
            </span>
          </div>

          <h1 className="text-2xl lg:text-4xl font-black tracking-tight text-white drop-shadow-[0_2px_10px_rgba(255,215,0,0.5)]">
            Xin chào, <span className="bg-gradient-to-r from-yellow-300 via-amber-400 to-red-400 bg-clip-text text-transparent">{fullName}</span>! 🦾
          </h1>

          <p className="text-xs lg:text-sm text-cyan-200/90 font-mono tracking-wide italic">
            "I am Iron Man. J.A.R.V.I.S. Executive Core & DOSCO ERP Command Systems Operational." ⚡
          </p>

          {/* Chỉ số HUD giả lập Sci-Fi */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2 text-[11px] font-mono">
            <div className="flex items-center gap-1.5 rounded-lg bg-black/50 border border-cyan-500/40 px-2.5 py-1 text-cyan-300">
              <BoltIcon className="h-4 w-4 text-cyan-400 animate-pulse" />
              <span>ARC POWER: <strong className="text-white">{power}%</strong></span>
            </div>
            <div className="flex items-center gap-1.5 rounded-lg bg-black/50 border border-yellow-500/40 px-2.5 py-1 text-yellow-300">
              <ShieldCheckIcon className="h-4 w-4 text-yellow-400" />
              <span>SECURITY: <strong className="text-white">DIRECTOR</strong></span>
            </div>
            <div className="flex items-center gap-1.5 rounded-lg bg-black/50 border border-red-500/40 px-2.5 py-1 text-red-300 col-span-2 sm:col-span-1">
              <FireIcon className="h-4 w-4 text-red-400" />
              <span>MARK 85: <strong className="text-white">PRIMED</strong></span>
            </div>
          </div>
        </div>

        {/* Cột phải: Khung ảnh CR7 / Iron Man Holographic HD */}
        <div className="relative shrink-0 my-1">
          <div className="absolute -inset-2 rounded-2xl bg-gradient-to-r from-cyan-400 via-red-600 to-yellow-400 blur-lg opacity-85 animate-pulse" />
          <div className="relative rounded-2xl bg-black/70 p-1 border-2 border-yellow-400 shadow-2xl">
            <img
              src="/ronaldo.png?v=4"
              alt="Iron Man Director"
              className="h-32 w-32 sm:h-36 sm:w-36 lg:h-44 lg:w-44 object-cover object-top rounded-xl border border-cyan-400/80 transition-transform duration-300 hover:scale-105"
            />
            <div className="absolute bottom-2 left-2 right-2 rounded bg-black/80 backdrop-blur-md px-2 py-0.5 text-center text-[9px] font-mono font-bold text-cyan-300 border border-cyan-500/40">
              ⚡ STARK COMMANDER
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
