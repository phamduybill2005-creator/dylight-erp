"use client";

import { useEffect, useState } from "react";
import { BoltIcon, ShieldCheckIcon, FireIcon } from "@heroicons/react/24/solid";

// ==================== BẢN VẼ ARC REACTOR CORE (STARK INDUSTRIES) ====================
export function ArcReactorWatermark() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 flex items-center justify-center overflow-hidden opacity-20">
      <div className="relative flex items-center justify-center">
        {/* Vòng hào quang Neon Blue Cyan phản chiếu rộng */}
        <div className="absolute h-[600px] w-[600px] lg:h-[750px] lg:w-[750px] rounded-full bg-cyan-500/20 blur-[100px] animate-pulse" />
        
        {/* SVG Arc Reactor quay 360 độ */}
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

// ==================== PURE IRON MAN MARK 85 BANNER FOR D.H.SON ====================
export function IronManBanner({ fullName }: { fullName: string }) {
  const [power, setPower] = useState(100);

  useEffect(() => {
    const interval = setInterval(() => {
      setPower(Math.floor(98 + Math.random() * 3));
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <section className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#4A0006] via-[#8B000D] to-[#120409] p-5 lg:p-7 text-white shadow-[0_0_50px_rgba(220,38,38,0.4)] border-2 border-amber-400/60 transition-all duration-500 hover:border-cyan-400/90 hover:shadow-[0_0_70px_rgba(0,240,255,0.5)]">
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

        {/* Cột phải: Mũ Giáp Iron Man Mark 85 Thuần Túy phát sáng Mắt Cyan (SVG Chuẩn) */}
        <div className="relative shrink-0 my-1 flex items-center justify-center">
          <div className="absolute -inset-2 rounded-2xl bg-gradient-to-r from-cyan-400 via-red-600 to-amber-400 blur-xl opacity-90 animate-pulse" />
          
          <div className="relative flex flex-col items-center justify-center rounded-2xl bg-black/85 p-4 border-2 border-amber-400 shadow-2xl h-36 w-36 sm:h-40 sm:w-40 lg:h-48 lg:w-48 transition-transform duration-300 hover:scale-105">
            {/* SVG Mũ Giáp Iron Man Mark 85 Thuần Túy */}
            <svg viewBox="0 0 100 110" className="h-24 w-24 sm:h-28 sm:w-28 lg:h-32 lg:w-32 filter drop-shadow-[0_0_15px_rgba(0,240,255,0.8)]">
              {/* Vỏ Mũ Đỏ Titanium (Red Helmet Shell) */}
              <path d="M 20 40 C 20 15, 80 15, 80 40 L 82 65 C 82 85, 68 100, 50 102 C 32 100, 18 85, 18 65 Z" fill="#8B000D" stroke="#FFD700" strokeWidth="2.5" />
              {/* Mặt Vàng Gold Faceplate */}
              <path d="M 28 32 C 35 24, 65 24, 72 32 L 76 60 C 74 80, 62 92, 50 94 C 38 92, 26 80, 24 60 Z" fill="#D4AF37" stroke="#FFD700" strokeWidth="1.5" />
              {/* Trán Mũ Đỏ Upper Forehead */}
              <path d="M 26 30 C 35 20, 65 20, 74 30 L 70 42 C 60 38, 40 38, 30 42 Z" fill="#B22222" stroke="#FFD700" strokeWidth="1" />
              {/* Mắt Cyan Phát Sáng Glow Eyes */}
              <polygon points="32,48 44,48 41,53 34,53" fill="#00F0FF" className="animate-pulse" filter="drop-shadow(0 0 4px #00F0FF)" />
              <polygon points="56,48 68,48 66,53 59,53" fill="#00F0FF" className="animate-pulse" filter="drop-shadow(0 0 4px #00F0FF)" />
              {/* Miệng Giáp Iron Man Mouth Line */}
              <line x1="38" y1="78" x2="62" y2="78" stroke="#8B000D" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            
            <div className="mt-1 rounded bg-black/90 px-2 py-0.5 text-center text-[9px] font-mono font-bold text-amber-300 border border-amber-500/50 shadow-md">
              ⚡ MARK 85 TITANIUM
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
