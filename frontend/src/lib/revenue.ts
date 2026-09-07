"use client";

// CÔNG THỨC DOANH THU — MỘT NGUỒN DUY NHẤT.
//
//    Doanh thu (VNĐ) = Time khách hàng (giờ) × Đơn giá Yên (¥/h) × Tỷ giá VCB
//
// Trước đây bảng Dự án tự tính theo kiểu cũ (giờ × đơn giá, coi đơn giá là VNĐ)
// nên ra số khác hẳn trang Doanh thu cho cùng một dự án. Nay cả hai đều gọi vào
// đây, sửa công thức một chỗ là khớp cả hai.

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Project } from "@/lib/types";

/** Tỷ giá dự phòng khi chưa lấy được từ Vietcombank. */
export const VCB_FALLBACK_RATE = 159.9;

export type VcbRateType = "transfer" | "buy" | "sell";

export interface VcbData {
  source: string;
  updated_at: string;
  jpy: { currency_code: string; currency_name: string; buy: number; transfer: number; sell: number };
}

/** Chọn tỷ giá theo loại đang dùng; thiếu thì lùi về "chuyển khoản", rồi mới tới dự phòng. */
export function pickJpyRate(vcb: VcbData | null, rateType: VcbRateType): number {
  if (!vcb?.jpy) return VCB_FALLBACK_RATE;
  return vcb.jpy[rateType] || vcb.jpy.transfer || VCB_FALLBACK_RATE;
}

/** "1.500" / "1500 ¥" -> 1500 ; không đọc được -> 0. */
export function parseJpyInput(s: string | null | undefined): number {
  const digits = (s || "").replace(/\./g, "").replace(/,/g, "").replace(/[^\d]/g, "");
  return digits ? Number(digits) : 0;
}

/**
 * Doanh thu VNĐ của MỘT dự án.
 * @param jpyGlobal đơn giá Yên dùng chung (Giám đốc đặt). >0 thì ưu tiên hơn
 *                  đơn giá riêng của dự án — giống hệt trang Doanh thu.
 */
export function computeRevenueVnd(p: Project, jpyGlobal: number, rate: number): number {
  const hours = Number(p.client_hours ?? 0);
  const jpy = jpyGlobal > 0 ? jpyGlobal : Number(p.unit_price ?? 0);
  return hours > 0 && jpy > 0 ? Math.round(hours * jpy * rate) : 0;
}

/**
 * Dùng cho trang CHỈ CẦN CON SỐ (vd bảng Dự án): tự nạp tỷ giá VCB + đơn giá Yên
 * chung rồi trả về hàm tính sẵn. Trang Doanh thu không dùng hook này vì còn cần
 * dữ liệu tỷ giá để vẽ thanh công cụ, nhưng vẫn gọi chung 2 hàm thuần ở trên.
 */
export function useRevenueCalc() {
  const [vcb, setVcb] = useState<VcbData | null>(null);
  const [jpyGlobal, setJpyGlobal] = useState(0);
  const [rateType, setRateType] = useState<VcbRateType>("transfer");

  useEffect(() => {
    // Loại tỷ giá + đơn giá Yên do người dùng chọn ở trang Doanh thu.
    try {
      const rt = localStorage.getItem("revenue_vcb_rate_type") as VcbRateType | null;
      if (rt === "transfer" || rt === "buy" || rt === "sell") setRateType(rt);
      setJpyGlobal(parseJpyInput(localStorage.getItem("revenue_global_jpy")));
    } catch {
      /* trình duyệt chặn -> dùng mặc định */
    }

    api.getVcbRate().then(setVcb).catch(() => {});
    // Đơn giá chung lấy từ server mới là nguồn chuẩn giữa mọi tài khoản.
    api.getGlobalUnitPrice()
      .then((res) => {
        const v = Number(res?.unit_price ?? 0);
        if (v > 0) setJpyGlobal(Math.round(v));
      })
      .catch(() => {});
  }, []);

  const rate = pickJpyRate(vcb, rateType);
  const revenueOf = useCallback(
    (p: Project) => computeRevenueVnd(p, jpyGlobal, rate),
    [jpyGlobal, rate],
  );

  return { revenueOf, rate, jpyGlobal };
}
