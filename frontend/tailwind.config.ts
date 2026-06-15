import type { Config } from "tailwindcss";

/**
 * Hệ màu thương hiệu DYLIGHT — gam "công trường":
 * navy thép (tin cậy, kỹ thuật) + hổ phách an toàn (hi-vis, mũ bảo hộ).
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0B1F33",        // navy đậm — chữ chính / thanh điều hướng
        steel: "#1E3A5F",      // navy phụ
        amber: {
          DEFAULT: "#F4A124",  // hổ phách an toàn — nút chính / điểm nhấn
          deep: "#D9831A",
        },
        paper: "#F4F6FA",      // nền ứng dụng
        line: "#E4E9F0",       // đường kẻ mảnh
        muted: "#64748B",      // chữ phụ
        ok: "#16A34A",         // lãi
        bad: "#DC2626",        // lỗ
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(11,31,51,.06), 0 8px 24px -12px rgba(11,31,51,.12)",
        fab: "0 8px 24px -6px rgba(244,161,36,.55)",
      },
      borderRadius: { xl2: "1.25rem" },
    },
  },
  plugins: [],
};
export default config;
