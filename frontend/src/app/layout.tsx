import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Be Vietnam Pro: phông được thiết kế riêng cho tiếng Việt (dấu chuẩn, đẹp).
const sans = Be_Vietnam_Pro({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sans",
  display: "swap",
});
// Mono dành cho mã hợp đồng / MST — gợi ý "đây là định danh".
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "CÔNG TY DOSCO — Quản lý dự án xây dựng",
  description: "Đấu thầu, hợp đồng, dự án, tiến độ và báo cáo lãi/lỗ.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "CÔNG TY DOSCO" },
  // ERP nội bộ chạy trên tên miền công ty (erp.dosco.vn) -> CẤM lập chỉ mục.
  // robots.txt chỉ ngăn thu thập; thẻ noindex mới ngăn trang lọt vào kết quả
  // tìm kiếm khi bị ai đó đặt liên kết trỏ tới.
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = {
  themeColor: "#0B1F33",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={`${sans.variable} ${mono.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
