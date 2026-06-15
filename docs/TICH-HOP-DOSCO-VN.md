# Đưa ERP lên mạng & nối nút "Đăng nhập" trên dosco.vn

Mục tiêu: nhân viên/giám đốc bấm **"Đăng nhập"** trên https://dosco.vn → mở **phần mềm ERP** (chạy được cả trên máy tính và điện thoại) → đăng nhập bằng tài khoản ERP.

> **Thứ tự bắt buộc:** ERP phải có **địa chỉ công khai trên internet** trước, *rồi mới* trỏ nút "Đăng nhập" tới đó. Hiện ERP mới chạy ở máy local (`localhost`), chưa thể nối nút được.

dosco.vn chạy **WordPress** (theme **Flatsome**, host Vinahost) → bước nối nút **không cần lập trình**, chỉ sửa trong trang quản trị.

---

## BƯỚC 1 — Đưa ERP lên server (có 2 hướng)

ERP gồm 3 phần: **Frontend (Next.js)** + **Backend (FastAPI/Python)** + **CSDL (PostgreSQL)**.
Hosting WordPress chia sẻ hiện tại **không chạy được** Python/Node — cần một trong hai:

### Hướng A (khuyến nghị, đơn giản vận hành): 1 VPS + Docker + tên miền phụ `erp.dosco.vn`

> Bộ file triển khai đã làm sẵn trong repo: **`docker-compose.prod.yml`**, **`Caddyfile`**, **`.env.prod.example`** — chỉ việc chạy.

1. Thuê 1 **VPS** (Vinahost/AWS/DigitalOcean… ~2GB RAM trở lên), cài **Docker + Docker Compose**.
2. Trỏ DNS: tạo bản ghi **A** `erp.dosco.vn` → IP của VPS (trong trang quản lý tên miền).
3. Copy toàn bộ mã nguồn ERP lên VPS.
4. Tạo file cấu hình: `cp .env.prod.example .env` rồi **đổi hết** mật khẩu/secret trong `.env`.
5. Chạy: `docker compose -f docker-compose.prod.yml up -d --build`
   (Caddy tự xin chứng chỉ HTTPS cho `erp.dosco.vn`; web + API cùng 1 tên miền → không lo CORS.)
6. Nạp dữ liệu lần đầu: `docker compose -f docker-compose.prod.yml exec backend python -m app.seed`
7. Mở `https://erp.dosco.vn` kiểm tra đăng nhập → **đổi ngay mật khẩu các tài khoản demo**.

### Hướng B (FREE, đơn giản nhất) — TẤT CẢ trên Render, 1 tài khoản, 1 lần bấm

Đã làm sẵn **`render.yaml`** mô tả cả CSDL + backend + frontend, tự nối với nhau.

**B0. Đưa mã nguồn lên GitHub** (Render deploy từ GitHub):
```
git init && git add . && git commit -m "ERP DOSCO"
# Tạo repo trống trên github.com rồi:
git remote add origin https://github.com/<tài-khoản>/<repo>.git
git branch -M main && git push -u origin main
```
(Không rành dòng lệnh? Dùng **GitHub Desktop** kéo-thả thư mục này lên.)

**B1. Deploy:** tạo tài khoản https://render.com → **New → Blueprint** → chọn repo vừa đẩy → **Apply**.
Render tự tạo: CSDL Postgres + Backend + Frontend, tự sinh `SECRET_KEY`/`ATTENDANCE_API_KEY`, tự nối `DATABASE_URL`.

**B2. Nạp dữ liệu lần đầu:** vào service **`dosco-erp-api`** → tab **Shell** → chạy: `python -m app.seed`

**B3. Mở app:** vào service **`dosco-erp-web`**, bấm URL (dạng `https://dosco-erp-web.onrender.com`) → đăng nhập → **đổi ngay mật khẩu demo**.

> Nếu Render cấp URL khác tên mặc định (do trùng tên), sửa lại 3 giá trị URL trong `render.yaml` (`FRONTEND_ORIGINS`, `NEXT_PUBLIC_API_BASE`, `NEXT_PUBLIC_ASSET_BASE`) cho khớp rồi redeploy.

**B4. (Tùy chọn) Gắn tên miền đẹp `erp.dosco.vn`:** trong Render → service `dosco-erp-web` → **Settings → Custom Domains** → thêm `erp.dosco.vn` → Render cho 1 bản ghi **CNAME**; thêm bản ghi đó ở trang DNS (Vinahost). Rồi sửa `FRONTEND_ORIGINS` (service api) thành `https://erp.dosco.vn`.

> **Giới hạn bản FREE (chấp nhận cho nội bộ):**
> - Render free **ngủ sau ~15 phút** không dùng → lần bấm đầu chờ ~50 giây (sau đó nhanh).
> - CSDL Postgres free của Render **hết hạn sau 90 ngày** → cần tạo lại (hoặc đổi sang **Neon** free để bền: tạo DB ở neon.tech rồi thay `DATABASE_URL` của service api bằng chuỗi Neon).
> - Ổ đĩa free **không bền** → ảnh hóa đơn tải lên có thể mất khi restart; cần lưu lâu dài thì thêm S3/Cloudinary sau.

> **Muốn mượt hơn (vẫn free):** đặt frontend lên **Vercel** (nhanh, không ngủ, gắn `erp.dosco.vn` dễ) + backend trên Render + CSDL **Neon**. Bù lại phải tạo 3 tài khoản và nhập vài biến môi trường tay.

---

## Cấu hình sản xuất cần đổi

Trong `docker-compose.yml` (hoặc biến môi trường của dịch vụ), đổi các giá trị sau khỏi mặc định dev:

| Biến | Dev hiện tại | Sản xuất (ví dụ với `erp.dosco.vn`) |
|---|---|---|
| `SECRET_KEY` (backend) | chuỗi mẫu | **chuỗi ngẫu nhiên dài, bí mật** |
| `DATABASE_URL` (backend) | sqlite local | `postgresql+psycopg2://dylight:<mật khẩu mạnh>@db:5432/dylight` |
| `FRONTEND_ORIGINS` (backend) | `http://localhost:3000` | `https://erp.dosco.vn` |
| `ATTENDANCE_API_KEY` (backend) | key dev | **key mạnh** (cho máy chấm công) |
| `OCR_PROVIDER` (+ API key) | `mock` | `openai`/`google` nếu muốn bóc tách hóa đơn thật |
| `NEXT_PUBLIC_API_BASE` (frontend) | `http://localhost:8000/api/v1` | `https://erp.dosco.vn/api/v1` |
| `NEXT_PUBLIC_ASSET_BASE` (frontend) | `http://localhost:8000` | `https://erp.dosco.vn` |
| Mật khẩu Postgres | `dylight/dylight` | **đổi mật khẩu mạnh** |

> Sau khi chạy thật, **đổi hết mật khẩu tài khoản demo** (`123456`) và xóa/khóa tài khoản không dùng.

### Mẫu reverse proxy (Caddy)
File `Caddyfile` đặt cạnh `docker-compose.yml`, cho cùng tên miền phục vụ web + API (HTTPS tự cấp):
```
erp.dosco.vn {
    handle /api/* { reverse_proxy backend:8000 }
    handle /static/* { reverse_proxy backend:8000 }
    handle { reverse_proxy frontend:3000 }
}
```
(Thêm service `caddy` vào docker-compose, mở cổng 80/443, mount `Caddyfile`.)

---

## BƯỚC 2 — Nối nút "Đăng nhập" trên WordPress (sau khi có `https://erp.dosco.vn`)

Nút "Đăng nhập" góc trên phải là một mục menu / phần tử header của Flatsome. Cách đổi:

**Cách 1 — Menu (phổ biến nhất):**
1. Vào **wp-admin** → **Giao diện (Appearance) → Menus**.
2. Tìm mục **"Đăng nhập"**, mở ra, sửa ô **URL** thành `https://erp.dosco.vn`.
3. (Khuyến nghị) Mở thẻ "Tùy chọn nâng cao" và bật **mở tab mới** nếu muốn.
4. **Lưu menu (Save Menu)**.

**Cách 2 — Header builder của Flatsome (nếu nút nằm trong header element):**
1. **wp-admin → Flatsome → Theme Options → Header → (Elements)**, hoặc dùng **Customize → Header**.
2. Tìm phần tử/nút "Đăng nhập", sửa **Link** thành `https://erp.dosco.vn`.
3. **Publish/Lưu**.

**Cách 3 — Nếu là HTML thuần trong một block/widget:** sửa thẻ `<a>`:
```html
<a href="https://erp.dosco.vn" class="...">Đăng nhập</a>
```

> Không cần tích hợp đăng nhập tự động (SSO) — người dùng bấm nút sẽ tới trang đăng nhập của ERP và nhập tài khoản ERP của họ. (Nếu sau này muốn 1-lần-đăng-nhập từ WordPress, đó là dự án riêng.)

---

## Checklist nghiệm thu
- [ ] `https://erp.dosco.vn` mở được, có HTTPS (ổ khóa xanh).
- [ ] Đăng nhập 3 vai trò OK; Quản lý không thấy doanh thu/lãi-lỗ.
- [ ] Mở trên **điện thoại**: hiện thanh dưới + nút Chụp; trên **máy tính**: hiện sidebar trái.
- [ ] Nút "Đăng nhập" trên dosco.vn trỏ đúng tới ERP.
- [ ] Đã đổi `SECRET_KEY`, mật khẩu DB, `ATTENDANCE_API_KEY`, mật khẩu tài khoản demo.
