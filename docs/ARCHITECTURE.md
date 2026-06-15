# Kiến trúc & Lược đồ CSDL — DYLIGHT ERP

## 1. Tổng quan kiến trúc

```
┌────────────────────┐     HTTPS/JSON      ┌────────────────────┐
│   Frontend (PWA)   │  ───────────────►   │   Backend API      │
│   Next.js 14       │   JWT Bearer        │   FastAPI (Python) │
│   App Router       │  ◄───────────────   │   SQLAlchemy 2.0   │
└────────────────────┘                     └─────────┬──────────┘
                                                      │
                                          ┌───────────┴───────────┐
                                          │                       │
                                   ┌──────▼──────┐        ┌────────▼────────┐
                                   │ PostgreSQL  │        │  OCR Service    │
                                   │ (9 bảng)    │        │  GPT-4o Vision /│
                                   └─────────────┘        │  Google Vision  │
                                                          └─────────────────┘
```

Thiết kế **đa người dùng (multi-tenant)**: mỗi bảng nghiệp vụ mang khóa `company_id`.
Mọi truy vấn API đều lọc theo công ty của người dùng đăng nhập (lấy từ JWT) →
dữ liệu các công ty tách biệt tuyệt đối.

## 2. Vòng đời tài chính của dự án

```
   BID            PROJECT          CONTRACT         INVOICE          PAYMENT
(Đấu thầu)  ──►  (Dự án)    ──►   (Hợp đồng)  ──►  (Hóa đơn AI)  ──►  (Thanh toán)
 trúng thầu      triển khai       ký kết giá       chi phí thực      thu/chi tiền
                                                   (AI bóc tách)
```

Báo cáo **lãi/lỗ** = Giá trị hợp đồng − Tổng hóa đơn đã duyệt (VERIFIED).

## 3. Chín bảng cốt lõi (ERD)

```
companies (1) ───< users           (nhân sự thuộc công ty)
companies (1) ───< bids            (gói thầu)
companies (1) ───< projects        (dự án)
companies (1) ───< contracts
companies (1) ───< invoices
companies (1) ───< payments

bids       (1) ───< projects       (1 gói thầu trúng → 1 dự án)
projects   (1) ───< contracts      (1 dự án có nhiều hợp đồng)
projects   (1) ───< invoices
projects   (1) ───< progress       (nhật ký tiến độ)
contracts  (1) ───< invoices       (hóa đơn gắn với hợp đồng)
contracts  (1) ───< payments       (đợt thanh toán theo hợp đồng)
users      (1) ───< invoices       (người tải hóa đơn lên)
users      (1) ───< activity_logs  (nhật ký thao tác)
```

| # | Bảng | Vai trò chính |
|---|------|---------------|
| 1 | `companies` | Pháp nhân/chi nhánh (gốc multi-tenant) |
| 2 | `users` | Tài khoản + vai trò (ADMIN, DIRECTOR, MANAGER, ACCOUNTANT, FIELD_STAFF) |
| 3 | `bids` | Gói thầu đang theo đuổi/đã trúng |
| 4 | `projects` | Dự án thi công |
| 5 | `contracts` | Hợp đồng (giá trị chưa VAT, % VAT) |
| 6 | `invoices` | **Hóa đơn — chứa link ảnh + dữ liệu AI bóc tách** |
| 7 | `payments` | Đợt thu/chi (tạm ứng, theo tiến độ, quyết toán) |
| 8 | `progress` | Nhật ký % hoàn thành theo mốc |
| 9 | `activity_logs` | Vết kiểm toán mọi thao tác quan trọng |

### Trọng tâm: bảng `invoices`

Ngoài các trường nghiệp vụ, bảng này lưu kết quả AI:

- `image_url`, `original_filename` — ảnh hóa đơn gốc đã chụp.
- `supplier_name`, `supplier_tax_code` (MST), `invoice_number`, `invoice_date`.
- `amount_no_vat`, `vat_amount`, `total_amount` — số tiền AI đọc được.
- `category` — phân loại chi phí (vật tư, nhân công, máy…).
- `ocr_raw` (JSON) — toàn bộ phản hồi thô từ model để đối soát.
- `ocr_confidence` — độ tin cậy.
- `status` — `PENDING → PROCESSING → EXTRACTED → VERIFIED / REJECTED`.

Chỉ hóa đơn **VERIFIED** mới được tính vào chi phí trong báo cáo lãi/lỗ →
giám đốc luôn nhìn thấy con số đã được kế toán kiểm chứng.

## 4. Trạng thái & vai trò

- **UserRole**: ADMIN (toàn quyền), DIRECTOR (xem báo cáo), MANAGER (chỉ huy
  trưởng), ACCOUNTANT (duyệt hóa đơn), FIELD_STAFF (chụp & tải hóa đơn).
- Quyền duyệt hóa đơn (`/invoices/{id}/verify`) giới hạn cho ADMIN, DIRECTOR,
  ACCOUNTANT, MANAGER.
