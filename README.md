# CÔNG TY DOSCO — Hệ thống quản lý dự án xây dựng (Web/PWA)

Ứng dụng quản lý nội bộ **mobile-first** cho công ty xây dựng, bao phủ toàn bộ
vòng đời dự án: **đấu thầu → dự án & hợp đồng → chi phí (hóa đơn) → tiến độ →
quyết toán → báo cáo lãi/lỗ**.

> **Điểm nhấn:** Cán bộ hiện trường **chụp ảnh hóa đơn ngay tại công trường**,
> **AI tự động bóc tách** (nhà cung cấp, MST, số tiền, ngày) và cập nhật chi phí
> theo thời gian thực để giám đốc theo dõi **lãi/lỗ**.

---

## 1. Công nghệ

| Lớp | Công nghệ |
|-----|-----------|
| Frontend | Next.js 14 (App Router), React 18, Tailwind CSS, Heroicons, Framer Motion |
| Backend | Python **FastAPI**, SQLAlchemy 2.0, Pydantic v2 |
| AI OCR | OpenAI **GPT-4o Vision** / Google Cloud Vision (có chế độ `mock` để chạy thử không cần API key) |
| CSDL | **PostgreSQL** (multi-tenant, 9 bảng) |
| Xác thực | **JWT** (OAuth2 password flow) |

Chi tiết kiến trúc & ERD: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## 2. Cấu trúc thư mục

```
dylight-erp/
├── docker-compose.yml         # Chạy cả 3 dịch vụ bằng 1 lệnh
├── docs/ARCHITECTURE.md       # Kiến trúc & lược đồ CSDL
├── backend/                   # API FastAPI + AI OCR
│   ├── app/
│   │   ├── main.py            # Khởi tạo app, CORS, đăng ký router
│   │   ├── config.py          # Cấu hình (đọc từ biến môi trường)
│   │   ├── database.py        # Engine + session SQLAlchemy
│   │   ├── models.py          # 9 bảng ORM (multi-tenant)
│   │   ├── schemas.py         # Pydantic v2
│   │   ├── security.py        # Băm mật khẩu + JWT
│   │   ├── deps.py            # Phụ thuộc: user hiện tại, phân quyền
│   │   ├── seed.py            # Nạp dữ liệu mẫu
│   │   ├── services/ocr_service.py   # Lõi AI bóc tách hóa đơn
│   │   └── routers/           # auth, companies, bids, projects,
│   │                          # contracts, invoices, payments,
│   │                          # progress, dashboard
│   ├── requirements.txt
│   └── Dockerfile
└── frontend/                  # Giao diện Next.js (PWA)
    ├── src/
    │   ├── app/               # layout, dashboard, login, invoices, projects
    │   ├── components/app-shell.tsx   # Khung + nút FAB "Chụp hóa đơn"
    │   └── lib/               # api client, types, format
    ├── public/manifest.webmanifest    # Cấu hình PWA
    ├── package.json
    └── Dockerfile
```

---

## 3. Cách chạy

### Cách A — Docker (khuyến nghị, 1 lệnh)

```bash
docker compose up --build
# Lần đầu, nạp dữ liệu mẫu (mở terminal khác):
docker compose exec backend python -m app.seed
```

- Frontend: <http://localhost:3000>
- API docs (Swagger): <http://localhost:8000/docs>

### Cách B — Chạy thủ công

**Backend**
```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env        # chỉnh DATABASE_URL trỏ tới PostgreSQL của bạn
python -m app.seed          # nạp dữ liệu mẫu
uvicorn app.main:app --reload --port 8000
```

**Frontend**
```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```

---

## 4. Tài khoản demo

Mật khẩu chung: `123456`

| Vai trò | Email |
|---------|-------|
| Giám đốc (xem báo cáo lãi/lỗ) | `giamdoc@dosco.vn` |
| Kế toán (duyệt hóa đơn) | `ketoan@dosco.vn` |
| Cán bộ hiện trường (chụp hóa đơn) | `hientruong@dosco.vn` |
| Quản trị (công ty khác) | `admin@dosco.vn` |

---

## 5. Bật AI OCR thật

Mặc định dùng `OCR_PROVIDER=mock` (trả dữ liệu giả lập để chạy thử không tốn phí).
Để dùng AI thật, sửa biến môi trường backend:

- **OpenAI GPT-4o Vision:** `OCR_PROVIDER=openai` và `OPENAI_API_KEY=sk-...`
- **Google Vision:** `OCR_PROVIDER=google` và `GOOGLE_VISION_API_KEY=...`

Nếu provider lỗi, hệ thống tự fallback về `mock` để không chặn luồng làm việc.

---

## 6. Phạm vi & lộ trình

Đây là **MVP chạy được**, kiến trúc đầy đủ 4 giai đoạn (CSDL → backend/AI →
giao diện → tích hợp). Các phần đã hoàn thiện:

- ✅ Lược đồ 9 bảng multi-tenant + dữ liệu mẫu.
- ✅ API: auth/JWT, công ty, đấu thầu, dự án, hợp đồng, **hóa đơn (upload + OCR + duyệt)**, thanh toán, tiến độ, dashboard KPI & lãi/lỗ.
- ✅ Giao diện PWA: đăng nhập, Dashboard KPI + lưới chức năng, **luồng chụp/bóc tách/duyệt hóa đơn**, danh sách dự án, đối soát quyết toán.
- ✅ **Quản lý nhân sự**: xem, sửa hồ sơ/phân cấp, và **tạo tài khoản nhân viên mới** ngay trong app (Quản trị/Giám đốc/Chỉ huy trưởng).
- ✅ **Bảng dự toán chi tiết (BOQ) kiểu Excel** trong từng dự án (tab *Hạng mục*): nhóm cha–con, sửa trực tiếp từng ô, tự tính Thành tiền = Khối lượng × Đơn giá, tiểu tổng từng nhóm + tổng dự toán, và **xuất Excel**.
- ✅ **Xuất báo cáo Excel/CSV** (mở được bằng Excel, có BOM UTF-8): Báo cáo lãi/lỗ và Đối soát quyết toán.
- ✅ **Alembic migration** đã thiết lập sẵn (xem mục 8) để dùng cho production thay vì `create_all`.

Hướng phát triển tiếp theo (gợi ý):

- Màn hình chi tiết hợp đồng, biểu đồ tiến độ.
- Cho phép kế toán **sửa** trường AI trước khi duyệt (endpoint PATCH đã sẵn).
- Lưu file lên **S3/Cloud Storage** thay vì đĩa cục bộ; token qua cookie httpOnly.

---

## 7. Ghi chú kỹ thuật

- Tiền tệ lưu `Numeric(18,2)`; hiển thị định dạng VND ở frontend.
- Backend tạo bảng tự động khi khởi động (tiện cho MVP).
- Ảnh hóa đơn phục vụ tại `/static/...` từ backend.

---

## 8. Migration cơ sở dữ liệu (Alembic)

MVP tự tạo bảng bằng `create_all`. Cho **production**, dùng Alembic (đã cấu hình
sẵn, đọc `DATABASE_URL` từ `.env` nên dùng chung cho SQLite lẫn PostgreSQL):

```bash
cd backend
# Tạo toàn bộ bảng theo migration (DB trống):
alembic upgrade head

# DB đã có sẵn bảng (vd dosco.db dựng bằng create_all) -> đánh dấu đã ở bản mới nhất:
alembic stamp head

# Sau khi sửa app/models.py, sinh migration mới rồi áp dụng:
alembic revision --autogenerate -m "mo ta thay doi"
alembic upgrade head
```

> Migration khởi tạo nằm ở `backend/alembic/versions/`. Khi chuyển sang production
> nên tắt `Base.metadata.create_all` trong `app/main.py` và chỉ dùng `alembic upgrade head`.

---

## 9. Đăng nhập bằng Google

Cho phép đăng nhập bằng tài khoản Google (song song với email/mật khẩu). Nút
"Đăng nhập bằng Google" chỉ hiện khi đã cấu hình Client ID.

**Lấy OAuth Client ID** (Google Cloud Console → APIs & Services → Credentials →
*Create credentials → OAuth client ID → Web application*). Thêm
`http://localhost:3001` (và domain thật khi deploy) vào **Authorized JavaScript origins**.

**Bật tính năng** — dán Client ID vào 2 nơi rồi khởi động lại cả 2 dịch vụ:

```bash
# backend/.env
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com

# frontend/.env.local
NEXT_PUBLIC_GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
```

**Ai được vào** (cấu hình ở `backend/.env`, mặc định an toàn):

- `GOOGLE_AUTO_CREATE=true` — bất kỳ Google nào cũng đăng nhập được; lần đầu tự
  tạo nhân viên mới với vai trò `GOOGLE_DEFAULT_ROLE` (mặc định `FIELD_STAFF`,
  thấp nhất) thuộc công ty `GOOGLE_DEFAULT_COMPANY_ID` (mặc định `1`).
- Đổi `GOOGLE_AUTO_CREATE=false` để **siết lại**: chỉ email đã có trong hệ thống
  mới đăng nhập được (an toàn hơn cho dữ liệu tài chính).

Backend xác minh ID token qua Google rồi cấp JWT của hệ thống như đăng nhập thường.
