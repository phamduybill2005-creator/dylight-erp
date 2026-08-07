"use client";

import { useEffect, useState } from "react";
import { BoltIcon, ShieldCheckIcon, FireIcon } from "@heroicons/react/24/solid";

// ==================== BẢN VẼ IRON MAN LIVE WALLPAPER VIDEO FOR D.H.SON ====================
export function ArcReactorWatermark() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 flex items-center justify-center overflow-hidden opacity-35">
      <div className="relative flex items-center justify-center">
        {/* Vòng hào quang Neon Cyan & Gold phản chiếu rộng */}
        <div className="absolute h-[650px] w-[650px] lg:h-[850px] lg:w-[850px] rounded-full bg-gradient-to-r from-cyan-500/30 via-red-600/30 to-amber-500/30 blur-[130px] animate-pulse" />

        {/* Video chuyển động Live Wallpaper Iron Man chuẩn từ link Pinterest */}
        <div className="relative flex items-center justify-center rounded-3xl p-2 bg-black/60 border-2 border-cyan-400/60 shadow-[0_0_100px_rgba(0,240,255,0.6)] backdrop-blur-md">
          <video
            src="/ironman_video.mp4"
            autoPlay
            loop
            muted
            playsInline
            className="h-[480px] w-auto lg:h-[620px] object-contain rounded-2xl filter drop-shadow-[0_0_60px_rgba(0,240,255,0.8)]"
          />
        </div>
      </div>
    </div>
  );
}

// ==================== INTERACTIVE IRON MAN CHIBI BANNER WITH LASER ACTIONS ====================
export function IronManBanner({ fullName }: { fullName: string }) {
  const [power, setPower] = useState(100);
  const [laserAction, setLaserAction] = useState<"idle" | "repulsor" | "unibeam" | "shield">("idle");
  const [statusMsg, setStatusMsg] = useState("MARK 85 CHIBI SYSTEM ONLINE");

  useEffect(() => {
    const interval = setInterval(() => {
      setPower(Math.floor(98 + Math.random() * 3));
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const fireRepulsor = () => {
    setLaserAction("repulsor");
    setStatusMsg("💥 LASER REPULSOR FIRED! 100% POWER");
    setTimeout(() => {
      setLaserAction("idle");
      setStatusMsg("MARK 85 CHIBI SYSTEM READY");
    }, 1500);
  };

  const fireUnibeam = () => {
    setLaserAction("unibeam");
    setStatusMsg("⚡ MAXIMUM UNIBEAM LASER CANNON BLAST!");
    setTimeout(() => {
      setLaserAction("idle");
      setStatusMsg("MARK 85 CHIBI SYSTEM READY");
    }, 2000);
  };

  const activateShield = () => {
    setLaserAction("shield");
    setStatusMsg("🛡️ NANOTECH VIBRANIUM SHIELD ACTIVATED!");
    setTimeout(() => {
      setLaserAction("idle");
      setStatusMsg("MARK 85 CHIBI SYSTEM READY");
    }, 2000);
  };

  return (
    <section className={`relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#380004] via-[#7A000B] to-[#120409] p-5 lg:p-7 text-white shadow-[0_0_50px_rgba(220,38,38,0.4)] border-2 border-amber-400/60 transition-all duration-300 ${
      laserAction === "unibeam" ? "animate-[bounce_0.2s_ease-in-out_infinite] border-cyan-400 shadow-[0_0_80px_#00f0ff]" : ""
    }`}>
      {/* Hiệu ứng Cyber Grid Scanline */}
      <div className="absolute inset-0 opacity-15 bg-[linear-gradient(to_right,#00f0ff_1px,transparent_1px),linear-gradient(to_bottom,#00f0ff_1px,transparent_1px)] bg-[size:20px_20px] pointer-events-none" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_0%,rgba(0,240,255,0.08)_50%,transparent_100%)] animate-[pulse_4s_infinite] pointer-events-none" />

      {/* Hiệu ứng LASER REPULSOR BẮN SANG TRÁI / PHẢI */}
      {laserAction === "repulsor" && (
        <div className="pointer-events-none absolute right-40 top-1/2 -translate-y-1/2 z-30 flex items-center">
          {/* Vòng năng lượng nổ ở bàn tay */}
          <div className="h-12 w-12 rounded-full bg-white blur-sm shadow-[0_0_30px_#00f0ff] animate-ping" />
          {/* Tia Laser Repulsor xanh Neon cuồn cuộn */}
          <div className="h-6 w-[800px] bg-gradient-to-l from-white via-cyan-300 to-transparent rounded-full shadow-[0_0_50px_#00f0ff] filter drop-shadow-[0_0_20px_#00f0ff] animate-pulse" />
        </div>
      )}

      {/* Hiệu ứng UNIBEAM LASER CANNON BẮN TỪ NGỰC */}
      {laserAction === "unibeam" && (
        <div className="pointer-events-none absolute right-44 top-1/2 -translate-y-1/2 z-30 flex items-center">
          {/* Lõi nổ Unibeam */}
          <div className="h-20 w-20 rounded-full bg-yellow-200 blur-md shadow-[0_0_60px_#ffd700] animate-pulse" />
          {/* Luồng Laser Unibeam cực đại */}
          <div className="h-16 w-[1000px] bg-gradient-to-l from-yellow-100 via-amber-300 to-transparent rounded-full shadow-[0_0_80px_#ffd700] filter drop-shadow-[0_0_30px_#00f0ff] animate-pulse" />
        </div>
      )}

      {/* Hiệu ứng KHIÊN NĂNG LƯỢNG */}
      {laserAction === "shield" && (
        <div className="pointer-events-none absolute right-8 top-1/2 -translate-y-1/2 z-30 flex items-center justify-center">
          <div className="h-44 w-44 rounded-full border-4 border-cyan-400 bg-cyan-500/20 shadow-[0_0_60px_#00f0ff] backdrop-blur-sm animate-pulse flex items-center justify-center">
            <ShieldCheckIcon className="h-20 w-20 text-cyan-300 animate-bounce" />
          </div>
        </div>
      )}

      {/* Tỏa sáng Arc Reactor góc phải */}
      <div className="absolute -right-12 -top-12 h-64 w-64 rounded-full bg-cyan-500/25 blur-3xl pointer-events-none" />
      <div className="absolute left-1/4 -bottom-10 h-48 w-48 rounded-full bg-amber-500/25 blur-3xl pointer-events-none" />

      <div className="relative z-10 flex flex-wrap items-center justify-between gap-6">
        {/* Cột trái: Thông tin Thuần Iron Man & Xin chào D.H.SON */}
        <div className="space-y-3 max-w-2xl">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-black/80 border border-amber-400 px-3.5 py-1 text-[11px] font-extrabold uppercase tracking-widest text-amber-300 shadow-[0_0_15px_rgba(255,215,0,0.5)]">
              ⚡ STARK INDUSTRIES — MARK 85 CHIBI 🦾
            </span>
            <span className="rounded-full bg-cyan-500/20 border border-cyan-400/60 px-3 py-0.5 text-[10px] font-bold tracking-wide text-cyan-300">
              {statusMsg}
            </span>
          </div>

          <h1 className="text-2xl lg:text-4xl font-black tracking-tight text-white drop-shadow-[0_2px_10px_rgba(255,215,0,0.6)]">
            Xin chào, <span className="bg-gradient-to-r from-yellow-300 via-amber-400 to-red-400 bg-clip-text text-transparent">{fullName}</span>! 🦾
          </h1>

          <p className="text-xs lg:text-sm text-cyan-200/95 font-mono tracking-wide italic">
            "I am Iron Man Chibi. Click vào nhân vật hoặc các nút điều khiển bên dưới để thực hiện bắn Laser Repulsor & Unibeam!" ⚡
          </p>

          {/* Nút thao tác động: BẮN LASER / UNIBEAM / BẬT KHIÊN */}
          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <button
              onClick={fireRepulsor}
              className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-red-600 to-amber-600 border border-amber-300 px-3.5 py-1.5 text-xs font-extrabold text-white shadow-[0_0_20px_rgba(239,68,68,0.5)] hover:scale-105 active:scale-95 transition-all cursor-pointer"
            >
              <BoltIcon className="h-4 w-4 text-cyan-300 animate-pulse" />
              <span>💥 BẮN LASER REPULSOR</span>
            </button>

            <button
              onClick={fireUnibeam}
              className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-600 via-blue-600 to-cyan-500 border border-cyan-300 px-3.5 py-1.5 text-xs font-extrabold text-white shadow-[0_0_20px_rgba(6,182,212,0.6)] hover:scale-105 active:scale-95 transition-all cursor-pointer"
            >
              <FireIcon className="h-4 w-4 text-yellow-300 animate-bounce" />
              <span>⚡ UNIBEAM CANNON BLAST</span>
            </button>

            <button
              onClick={activateShield}
              className="flex items-center gap-1.5 rounded-xl bg-black/80 border border-cyan-400/80 px-3.5 py-1.5 text-xs font-bold text-cyan-300 hover:bg-black transition-all cursor-pointer"
            >
              <ShieldCheckIcon className="h-4 w-4 text-cyan-400" />
              <span>🛡️ BẬT KHIÊN NANOTECH</span>
            </button>
          </div>

          {/* Chỉ số HUD */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1 text-[11px] font-mono">
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
              <span>MODE: <strong className="text-white">LASER CHIBI</strong></span>
            </div>
          </div>
        </div>

        {/* Cột phải: Nhân vật Iron Man Chibi Siêu Đáng Yêu & Quyền Năng (Interactive SVG Render) */}
        <div 
          onClick={fireRepulsor}
          className="relative shrink-0 my-1 flex items-center justify-center cursor-pointer group"
          title="Click vào Iron Man Chibi để bắn Laser Repulsor!"
        >
          <div className={`absolute -inset-3 rounded-3xl bg-gradient-to-r from-cyan-400 via-red-600 to-amber-400 blur-xl opacity-90 transition-all duration-300 group-hover:scale-110 ${
            laserAction !== "idle" ? "scale-125 animate-ping" : "animate-pulse"
          }`} />
          
          <div className="relative flex flex-col items-center justify-center rounded-3xl bg-black/90 p-4 border-2 border-amber-400 shadow-2xl h-40 w-40 sm:h-44 sm:w-44 lg:h-52 lg:w-52 transition-transform duration-300 group-hover:scale-105">
            {/* Vòng nổ năng lượng Repulsor ở tay */}
            <div className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-cyan-400/40 blur-md animate-ping" />

            {/* SVG Nhân vật Iron Man Chibi Đáng Yêu Kèm Tay Bắn Repulsor & Ngực Arc Reactor */}
            <svg viewBox="0 0 120 130" className="h-28 w-28 sm:h-32 sm:w-32 lg:h-36 lg:w-36 filter drop-shadow-[0_0_20px_rgba(0,240,255,0.9)]">
              {/* Đầu Chibi To Tròn Ngộ Nghĩnh */}
              <circle cx="60" cy="45" r="36" fill="#8B000D" stroke="#FFD700" strokeWidth="3" />
              {/* Mặt Vàng Gold Faceplate Chibi */}
              <path d="M 36 35 C 44 26, 76 26, 84 35 L 88 62 C 85 78, 70 85, 60 86 C 50 85, 35 78, 32 62 Z" fill="#D4AF37" stroke="#FFD700" strokeWidth="2" />
              {/* Trán Mũ Đỏ Upper Forehead */}
              <path d="M 34 32 C 45 22, 75 22, 86 32 L 80 44 C 68 40, 52 40, 40 44 Z" fill="#B22222" stroke="#FFD700" strokeWidth="1" />
              
              {/* Mắt Cyan Phát Sáng Glow Eyes Chibi */}
              <polygon points="40,48 52,48 49,54 42,54" fill="#00F0FF" className="animate-pulse" filter="drop-shadow(0 0 5px #00F0FF)" />
              <polygon points="68,48 80,48 78,54 71,54" fill="#00F0FF" className="animate-pulse" filter="drop-shadow(0 0 5px #00F0FF)" />
              {/* Miệng Cười Chibi Cute Mouth */}
              <path d="M 52 72 Q 60 78 68 72" stroke="#8B000D" strokeWidth="2.5" fill="none" strokeLinecap="round" />

              {/* Thân Chibi Nhỏ Nhắn Cute Body */}
              <path d="M 42 84 L 78 84 L 74 115 L 46 115 Z" fill="#8B000D" stroke="#FFD700" strokeWidth="2" />
              {/* Giáp Vai Vàng Gold Shoulders */}
              <circle cx="36" cy="88" r="8" fill="#D4AF37" stroke="#FFD700" strokeWidth="1.5" />
              <circle cx="84" cy="88" r="8" fill="#D4AF37" stroke="#FFD700" strokeWidth="1.5" />

              {/* Lõi Ngực Arc Reactor Tròn Cyan rực rỡ */}
              <circle cx="60" cy="98" r="9" fill="#00F0FF" className="animate-pulse" filter="drop-shadow(0 0 8px #00F0FF)" />
              <circle cx="60" cy="98" r="5" fill="#FFFFFF" />

              {/* Bàn tay Chibi Giơ Ra Phía Trước Bắn Laser Repulsor */}
              <g className="animate-bounce">
                <circle cx="94" cy="94" r="10" fill="#8B000D" stroke="#FFD700" strokeWidth="1.5" />
                <circle cx="94" cy="94" r="6" fill="#00F0FF" filter="drop-shadow(0 0 8px #00F0FF)" />
                <circle cx="94" cy="94" r="3" fill="#FFFFFF" />
              </g>
            </svg>
            
            <div className="mt-1 rounded bg-black/90 px-2.5 py-0.5 text-center text-[9px] font-mono font-bold text-yellow-300 border border-amber-500/60 shadow-md">
              ⚡ CLICK BẮN LASER!
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
