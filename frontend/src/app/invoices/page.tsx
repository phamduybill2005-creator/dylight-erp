"use client";

// Tính năng "Hóa đơn" đã được gỡ khỏi giao diện. Giữ lại route này để mọi
// đường dẫn/bookmark cũ tới /invoices tự chuyển về Trang chủ thay vì báo 404.
// (Backend hóa đơn vẫn còn — có thể khôi phục giao diện sau nếu cần.)

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function InvoicesRemovedPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/");
  }, [router]);
  return null;
}
