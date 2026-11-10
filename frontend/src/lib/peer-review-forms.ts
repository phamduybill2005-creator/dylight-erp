import type { PeerReviewKind } from "./types";

// Mỗi tiêu chí kèm mô tả mức 1 điểm / 5 điểm (bảng tiêu chí của công ty — Phụ lục 2 và 2a).
type Criterion = { label: string; low: string; high: string };
export type FormDef = { kind: PeerReviewKind; code: string; title: string; note: string; criteria: Criterion[] };
// Thứ tự tiêu chí = thứ tự scores[0..2] gửi lên backend — đừng đảo.
export const FORMS: FormDef[] = [
  {
    kind: "QUALITY", code: "CL", title: "Chất lượng công việc",
    note: "Quản lý và đồng nghiệp cùng dự án chấm hằng tháng, thang 1–5 (3 = Đạt). Tự chấm không tính.",
    criteria: [
      { label: "Sản phẩm đúng, ít lỗi", low: "Thường sai, phải làm lại", high: "Hầu như không lỗi, tự kiểm kỹ" },
      { label: "Nộp bài đúng hẹn", low: "Thường trễ, cả nhóm phải chờ", high: "Luôn đúng hẹn, trễ thì báo sớm" },
      { label: "Phối hợp với mọi người", low: "Khó liên lạc, không hợp tác", high: "Trao đổi rõ, sẵn sàng hỗ trợ" },
    ],
  },
  {
    kind: "TEAM", code: "HN", title: "Hòa đồng, tập thể",
    note: "Toàn thể đồng nghiệp chấm, thang 1–5 (3 = Đạt). Tự chấm không tính, phiếu không công khai với đồng nghiệp; Giám đốc / Quản trị có thể xem chi tiết.",
    criteria: [
      { label: "Hòa đồng, thân thiện", low: "Khép kín, gắt gỏng", high: "Dễ gần, gắn kết mọi người" },
      { label: "Tham gia hoạt động tập thể", low: "Hầu như không tham gia", high: "Tham gia đầy đủ, góp sức tổ chức" },
      { label: "Tiếp thu góp ý", low: "Phản ứng gay gắt, để bụng", high: "Bình tĩnh trao đổi, tiếp thu và sửa" },
    ],
  },
];
