// Chi tiết PHÒNG BẢN ĐỒ của một dự án: lưu chung trong ô `evaluation` (Ghi chú)
// dưới dạng JSON — không đổi schema DB. Dùng cho bảng Dự án ở chế độ Phòng Bản đồ.
// Không import gì khác để test được bằng node --test (tests/bando-details.test.cjs).

export type BanDoDetails = {
  vung: string;      // Vùng / khu vực của dự án — chữ tự do
  riegl: string;     // nhập số
  qlcl: string;      // nhập số
  data: string;      // Ô TÍCH: "1" = đã tích, "" = chưa (dữ liệu cũ nhập số: khác "0" coi là đã tích)
  analysis: string;  // SỐ hecta — đơn vị "ha" cố định (dữ liệu cũ có thể còn kèm chữ "ha")
  trace: string;     // Ô TÍCH như DATA
  section: string;   // nhập số
  tieu_de: string;   // Ghi chú
};

export const EMPTY_BANDO: BanDoDetails = {
  vung: "", riegl: "", qlcl: "", data: "", analysis: "", trace: "", section: "", tieu_de: "",
};

/** Giá trị lưu vào JSON khi ô tích được tích. */
export const TICKED = "1";

const str = (v: unknown): string => (v == null ? "" : String(v));

/** Chuỗi `evaluation` -> chi tiết. Không phải JSON (ghi chú thường) thì để nguyên vào `tieu_de`. */
export function parseBanDoDetails(evalStr?: string | null): BanDoDetails {
  if (!evalStr) return { ...EMPTY_BANDO };
  const s = evalStr.trim();
  if (s.startsWith("{")) {
    try {
      const parsed = JSON.parse(s);
      return {
        vung: str(parsed.vung),
        riegl: str(parsed.riegl),
        qlcl: str(parsed.qlcl),
        data: str(parsed.data),
        analysis: str(parsed.analysis),
        trace: str(parsed.trace),
        section: str(parsed.section),
        tieu_de: str(parsed.tieu_de),
      };
    } catch {
      return { ...EMPTY_BANDO, tieu_de: s };
    }
  }
  return { ...EMPTY_BANDO, tieu_de: s };
}

/** Chi tiết -> chuỗi lưu vào `evaluation`; trống hết thì trả "" (xoá ghi chú). */
export function stringifyBanDoDetails(details: BanDoDetails): string {
  const allEmpty = Object.values(details).every((v) => !v.trim());
  if (allEmpty) return "";
  return JSON.stringify(details);
}

/** Ô tích DATA / TRACE: đã tích khi có giá trị khác rỗng và khác "0"
 *  (trước đây 2 cột này nhập số, "0" nghĩa là chưa làm). */
export function isBanDoTicked(v: string | null | undefined): boolean {
  const t = (v || "").trim().toLowerCase();
  return t !== "" && t !== "0" && t !== "false";
}

/** Giữ nguyên nền/chữ/viền của cả ô DATA / TRACE trong bảng Dự án. */
export function tickCellClass(_ticked: boolean): string {
  return "";
}

/** Chỉ làm mờ viền riêng của checkbox chưa tích. */
export function tickInputClass(ticked: boolean): string {
  return ticked
    ? "border-transparent bg-teal-700"
    : "border-slate-300/70 bg-white";
}

/** Analysis chỉ lưu SỐ (đơn vị "ha" hiện cố định cạnh ô): "28.5 ha" -> "28.5",
 *  "36ha" -> "36", "3,2ha" -> "3.2". Dùng cho cả giá trị cũ lẫn lúc đang gõ. */
export function analysisNumber(v: string | null | undefined): string {
  return (v || "").replace(/,/g, ".").replace(/[^\d.]/g, "");
}
