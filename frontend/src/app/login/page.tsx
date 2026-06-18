"use client";

// Trang đăng nhập — cửa vào ERP (mở từ nút "Đăng nhập" trên dosco.vn).
// Responsive: desktop hiển thị 2 cột (panel thương hiệu + form); điện thoại là 1 cột.
// Gửi email + mật khẩu tới /auth/login, lưu JWT rồi chuyển về Dashboard.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  MapIcon,
  PencilSquareIcon,
  Square3Stack3DIcon,
  CubeIcon,
  HomeModernIcon,
} from "@heroicons/react/24/outline";
import { api } from "@/lib/api";

const DEMO = [
  { role: "Giám đốc", email: "giamdoc@dosco.vn" },
  { role: "Quản lý", email: "quanly@dosco.vn" },
  { role: "Kế toán", email: "ketoan@dosco.vn" },
  { role: "Nhân viên", email: "hientruong@dosco.vn" },
];

// Các hạng mục công ty DOSCO đảm nhiệm (nguồn: dosco.vn).
const SERVICES = [
  { icon: MapIcon, title: "Khảo sát & xử lý dữ liệu không gian", desc: "Bay UAV/drone, ảnh trực giao, dữ liệu địa hình & mô hình điểm mây phục vụ thiết kế, BIM." },
  { icon: PencilSquareIcon, title: "Thiết kế hạ tầng – cầu đường", desc: "Thiết kế đường bộ, cải tạo địa hình, cân bằng khối lượng đất theo tiêu chuẩn Nhật Bản." },
  { icon: Square3Stack3DIcon, title: "Tường chắn & thoát nước", desc: "Tường đất có cốt, cấu kiện bê tông đúc sẵn, hệ thống thoát nước." },
  { icon: CubeIcon, title: "Mô hình CIM / BIM 3D", desc: "Mô hình 3D độ chính xác cao theo chuẩn Nhật, đạt tới LOD 400." },
  { icon: HomeModernIcon, title: "Thiết kế nhà gỗ kiểu Nhật", desc: "Thiết kế nhà ở từ phác thảo kiến trúc, đạt tiêu chuẩn xây dựng Nhật Bản." },
];

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("giamdoc@dosco.vn");
  const [password, setPassword] = useState("123456");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const googleBtnRef = useRef<HTMLDivElement>(null);

  // Nạp Google Identity Services và hiển thị nút "Đăng nhập bằng Google".
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;

    async function handleCredential(response: { credential?: string }) {
      if (!response.credential) return;
      setError(null);
      setLoading(true);
      try {
        await api.loginWithGoogle(response.credential);
        router.replace("/");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Đăng nhập Google thất bại.");
      } finally {
        setLoading(false);
      }
    }

    function init() {
      const g = (window as any).google;
      if (!g?.accounts?.id || !googleBtnRef.current) return;
      g.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleCredential });
      g.accounts.id.renderButton(googleBtnRef.current, {
        theme: "outline",
        size: "large",
        width: 320,
        text: "signin_with",
        locale: "vi",
      });
    }

    if (document.getElementById("gsi-script")) {
      init();
      return;
    }
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.id = "gsi-script";
    s.onload = init;
    document.body.appendChild(s);
  }, [router]);

  async function submit() {
    setError(null);
    setLoading(true);
    try {
      await api.login(email, password);
      router.replace("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Đăng nhập thất bại.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* ============ PANEL THƯƠNG HIỆU (chỉ desktop) ============ */}
      <div className="hidden lg:flex lg:w-1/2 lg:flex-col lg:justify-between bg-ink p-12 text-white">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="DOSCO" className="h-12 w-auto rounded-xl2 bg-white px-4 py-2 object-contain" />
        </div>
        <div className="max-w-md">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber">
            Hợp tác &amp; phát triển Việt Nam – Nhật Bản
          </p>
          <h1 className="mt-3 text-3xl font-bold leading-tight">
            Tư vấn – thiết kế <span className="text-amber">hạ tầng &amp; khảo sát</span>
          </h1>
          <p className="mt-3 text-sm text-white/60">
            DOSCO CO., LTD — đơn vị tư vấn thiết kế công trình hạ tầng, khảo sát không gian
            và mô hình BIM/CIM theo tiêu chuẩn Nhật Bản.
          </p>
          <p className="mt-6 text-[11px] font-semibold uppercase tracking-wider text-white/40">
            Các hạng mục đảm nhiệm
          </p>
          <ul className="mt-3 space-y-3">
            {SERVICES.map((s, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl2 bg-amber/15 text-amber">
                  <s.icon className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-white/90">{s.title}</p>
                  <p className="text-[11px] leading-snug text-white/55">{s.desc}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-white/40">© DOSCO CO., LTD · Coma Building, 125D Minh Khai, Hà Nội</p>
      </div>

      {/* ============ PANEL FORM ============ */}
      <div className="flex w-full flex-1 items-center justify-center bg-ink px-5 py-10 lg:w-1/2 lg:bg-paper">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="w-full max-w-sm"
        >
          {/* Logo + tiêu đề (mobile hiển thị logo; desktop hiển thị tiêu đề) */}
          <div className="mb-8 text-center lg:mb-6 lg:text-left">
            <img
              src="/logo.png"
              alt="DOSCO Logo"
              className="mx-auto mb-3 h-14 w-auto rounded-xl2 bg-white px-5 py-2.5 object-contain lg:hidden"
            />
            <p className="text-sm text-white/60 lg:hidden">Tư vấn – thiết kế hạ tầng &amp; khảo sát · Việt Nam – Nhật Bản</p>
            <h2 className="hidden text-2xl font-bold text-ink lg:block">Đăng nhập</h2>
            <p className="hidden text-sm text-muted lg:block">Đăng nhập để truy cập hệ thống nội bộ DOSCO.</p>
          </div>

          <div className="rounded-xl2 bg-white p-5 shadow-card lg:border lg:border-line">
            <label className="block text-xs font-medium text-muted">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              className="mt-1 w-full rounded-xl2 border border-line px-3 py-2.5 text-sm outline-none focus:border-steel"
              placeholder="ten@congty.vn"
            />

            <label className="mt-4 block text-xs font-medium text-muted">Mật khẩu</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              className="mt-1 w-full rounded-xl2 border border-line px-3 py-2.5 text-sm outline-none focus:border-steel"
              placeholder="••••••"
            />

            {error && <p className="mt-3 text-xs text-bad">{error}</p>}

            <button
              onClick={submit}
              disabled={loading}
              className="mt-5 w-full rounded-xl2 bg-amber py-3 text-sm font-semibold text-ink disabled:opacity-60"
            >
              {loading ? "Đang đăng nhập…" : "Đăng nhập"}
            </button>

            {GOOGLE_CLIENT_ID && (
              <div className="mt-5">
                <div className="flex items-center gap-3 text-[11px] text-muted">
                  <span className="h-px flex-1 bg-line" />
                  hoặc
                  <span className="h-px flex-1 bg-line" />
                </div>
                <div ref={googleBtnRef} className="mt-3 flex justify-center" />
              </div>
            )}

            <div className="mt-5 border-t border-line pt-4">
              <p className="text-[11px] font-medium text-muted">Tài khoản demo (mật khẩu: 123456)</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {DEMO.map((d) => (
                  <button
                    key={d.email}
                    onClick={() => {
                      setEmail(d.email);
                      setPassword("123456");
                    }}
                    className="rounded-full bg-paper px-3 py-1 text-[11px] text-steel hover:bg-line"
                  >
                    {d.role}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
