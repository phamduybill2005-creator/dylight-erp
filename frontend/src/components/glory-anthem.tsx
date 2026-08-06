"use client";

import { useEffect, useRef, useState } from "react";
import { SpeakerWaveIcon, SpeakerXMarkIcon } from "@heroicons/react/24/solid";

export default function GloryAnthemAudio({ autoPlay = true }: { autoPlay?: boolean }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Lõi tạo giai điệu kèn đồng Stadium Organ "Glory Glory Man United" bằng Web Audio API
  const playSynthAnthem = () => {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;

      // Nốt nhạc đoạn Điệp khúc Glory Glory Man United chuẩn (Tần số Hz & Độ dài giây)
      const notes = [
        // Glo-ry glo-ry Man U-ni-ted
        { freq: 392.00, duration: 0.4 }, { freq: 392.00, duration: 0.2 }, { freq: 392.00, duration: 0.2 },
        { freq: 392.00, duration: 0.4 }, { freq: 349.23, duration: 0.25 }, { freq: 329.63, duration: 0.35 }, { freq: 392.00, duration: 0.4 },
        
        // Glo-ry glo-ry Man U-ni-ted
        { freq: 440.00, duration: 0.4 }, { freq: 440.00, duration: 0.2 }, { freq: 440.00, duration: 0.2 },
        { freq: 440.00, duration: 0.4 }, { freq: 392.00, duration: 0.25 }, { freq: 349.23, duration: 0.35 }, { freq: 329.63, duration: 0.4 },
        
        // Glo-ry glo-ry Man U-ni-ted
        { freq: 392.00, duration: 0.4 }, { freq: 392.00, duration: 0.2 }, { freq: 392.00, duration: 0.2 },
        { freq: 392.00, duration: 0.4 }, { freq: 349.23, duration: 0.25 }, { freq: 329.63, duration: 0.35 }, { freq: 293.66, duration: 0.4 },
        
        // As the Reds go march-ing ON!
        { freq: 261.63, duration: 1.0 }
      ];

      let startTime = ctx.currentTime + 0.05;
      setIsPlaying(true);

      notes.forEach((n) => {
        // Oscillator 1 (Sóng Răng cưa — tạo tiếng kèn đồng mạnh mẽ)
        const osc1 = ctx.createOscillator();
        osc1.type = "sawtooth";
        osc1.frequency.setValueAtTime(n.freq, startTime);

        // Oscillator 2 (Sóng Tam giác — bồi thêm âm trầm dày Old Trafford)
        const osc2 = ctx.createOscillator();
        osc2.type = "triangle";
        osc2.frequency.setValueAtTime(n.freq * 0.5, startTime);

        const gainNode = ctx.createGain();
        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(0.18, startTime + 0.05);
        gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + n.duration - 0.02);

        osc1.connect(gainNode);
        osc2.connect(gainNode);
        gainNode.connect(ctx.destination);

        osc1.start(startTime);
        osc2.start(startTime);
        osc1.stop(startTime + n.duration);
        osc2.stop(startTime + n.duration);

        startTime += n.duration;
      });

      // Tự động tắt sau khi kết thúc điệp khúc (~6.5s)
      setTimeout(() => {
        setIsPlaying(false);
        if (ctx.state !== "closed") {
          ctx.close().catch(() => {});
        }
      }, (startTime - ctx.currentTime) * 1000 + 200);

    } catch (err) {
      console.warn("Audio Context playback error:", err);
      setIsPlaying(false);
    }
  };

  const playAnthem = () => {
    // Nếu có file audio MP3 thì ưu tiên phát MP3
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.volume = 0.8;
      const promise = audioRef.current.play();
      if (promise !== undefined) {
        promise
          .then(() => {
            setIsPlaying(true);
            // Tự động dừng sau 7 giây theo yêu cầu
            setTimeout(() => {
              if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current.currentTime = 0;
              }
              setIsPlaying(false);
            }, 7000);
          })
          .catch(() => {
            // Nếu trình duyệt chặn phát MP3 chưa tương tác -> dùng Web Audio API synth
            playSynthAnthem();
          });
        return;
      }
    }
    playSynthAnthem();
  };

  const stopAnthem = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      audioCtxRef.current.close().catch(() => {});
    }
    setIsPlaying(false);
  };

  useEffect(() => {
    if (!autoPlay) return;

    // Tự động bật nhạc khi vừa mở tab / trang chủ
    let timer = setTimeout(() => {
      playAnthem();
    }, 400);

    // Hỗ trợ tự kích hoạt nhạc ở cú click đầu tiên nếu trình duyệt chặn autoplay
    const handleFirstUserInteraction = () => {
      playAnthem();
      window.removeEventListener("click", handleFirstUserInteraction);
      window.removeEventListener("touchstart", handleFirstUserInteraction);
    };

    window.addEventListener("click", handleFirstUserInteraction, { once: true });
    window.addEventListener("touchstart", handleFirstUserInteraction, { once: true });

    return () => {
      clearTimeout(timer);
      window.removeEventListener("click", handleFirstUserInteraction);
      window.removeEventListener("touchstart", handleFirstUserInteraction);
      stopAnthem();
    };
  }, [autoPlay]);

  return (
    <div className="inline-flex items-center gap-2">
      {/* File Audio HTML5 dự phòng */}
      <audio ref={audioRef} src="/glory_glory.mp3" preload="none" />

      {/* Nút bấm điều khiển & hiển thị trạng thái nhạc Glory Glory */}
      <button
        type="button"
        onClick={() => (isPlaying ? stopAnthem() : playAnthem())}
        className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold transition-all duration-300 shadow-lg border ${
          isPlaying
            ? "bg-yellow-400 text-black border-yellow-300 animate-pulse scale-105"
            : "bg-black/60 text-yellow-300 border-yellow-500/50 hover:bg-black/80 hover:scale-102"
        }`}
        title="Nhạc điệp khúc Glory Glory Man United (Tự tắt sau 7s)"
      >
        {isPlaying ? (
          <>
            <SpeakerWaveIcon className="h-4 w-4 animate-bounce text-red-600" />
            <span>🎶 Đang phát Glory Glory (7s)...</span>
          </>
        ) : (
          <>
            <SpeakerXMarkIcon className="h-4 w-4 text-yellow-400" />
            <span>🔊 Bật nhạc Glory Glory ⚽</span>
          </>
        )}
      </button>
    </div>
  );
}
