# Deploy ERP lên tên miền riêng (bỏ Render)

Hướng dẫn đưa hệ thống về chạy trên **máy chủ của công ty**, truy cập bằng
`https://erp.dosco.vn`, không phụ thuộc Render nữa.

---

## 0. Vì sao phải có VPS

Hệ thống gồm 3 phần: **Next.js** (web), **FastAPI/Python** (API), **PostgreSQL** (CSDL).

| Loại máy chủ | Chạy được không |
|---|---|
| Shared hosting cPanel/DirectAdmin (chỉ PHP + MySQL) | **Không** |
| VPS / Cloud Server (có SSH, cài được Docker) | Được |

Hosting đang chạy `dosco.vn` là **shared hosting** — chỉ phục vụ WordPress, không
cài được Docker. Vì vậy **giữ nguyên `dosco.vn`** cho website giới thiệu, và dựng
ERP ở **subdomain riêng** `erp.dosco.vn` trỏ về VPS.

Cấu hình VPS tối thiểu: **2 GB RAM**, 2 vCPU, 20 GB đĩa, Ubuntu 22.04/24.04.
(1 GB RAM có thể bị kill lúc `next build` — xem mục Sự cố.)

---

## 1. Chuẩn bị VPS

```bash
ssh root@<IP_VPS>
```

Cài Docker:

```bash
curl -fsSL https://get.docker.com | sh
```

Kiểm tra:

```bash
docker --version && docker compose version
```

---

## 2. Trỏ tên miền

Vào trang quản lý DNS của `dosco.vn` (nhà cung cấp **VinaHost**, nameserver
`ns3/ns4.vinahost.vn`), thêm **một** bản ghi:

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `erp` | `<IP_VPS>` | 300 |

Không đụng tới bản ghi của `dosco.vn` và `www` — website WordPress giữ nguyên.

Chờ vài phút rồi kiểm tra (phải ra đúng IP VPS):

```bash
nslookup erp.dosco.vn 8.8.8.8
```

> Bản ghi DNS phải trỏ đúng **trước khi** chạy bước 5, vì Caddy cần truy cập
> được domain từ Internet mới xin được chứng chỉ HTTPS.

---

## 3. Tải mã nguồn về VPS

```bash
git clone https://github.com/phamduybill2005-creator/dylight-erp.git /opt/dylight-erp
```

```bash
cd /opt/dylight-erp
```

---

## 4. Tạo file `.env`

Sinh 2 chuỗi bí mật (chạy 2 lần, lưu lại kết quả):

```bash
openssl rand -base64 48
```

Tạo file `.env` ngay trong `/opt/dylight-erp`:

```bash
nano .env
```

Nội dung:

```
DOMAIN=erp.dosco.vn
SECRET_KEY=<chuỗi ngẫu nhiên thứ 1>
ATTENDANCE_API_KEY=<chuỗi ngẫu nhiên thứ 2>
POSTGRES_PASSWORD=<mật khẩu mạnh cho Postgres>

# AI đọc hóa đơn (bỏ trống thì kế toán nhập tay, KHÔNG bịa số)
OCR_PROVIDER=openai
OPENAI_API_KEY=<sk-... nếu có>
```

**Không commit file `.env` lên Git.**

### Chọn CSDL — quan trọng

Bạn đang có **dữ liệu thật trên Neon**. Chọn 1 trong 2:

**Cách A — Giữ nguyên Neon (khuyến nghị, không rủi ro mất dữ liệu).**
Thêm vào `.env` chuỗi kết nối Neon đang dùng ở Render:

```
DATABASE_URL=postgresql+psycopg2://<user>:<pass>@<host>.neon.tech/<db>?sslmode=require
```

Lấy chuỗi này ở Render → service `dosco-erp-api` → **Environment** → `DATABASE_URL`.
Chỉ cần đổi tiền tố thành `postgresql+psycopg2://` nếu nó đang là `postgres://`.
Container `db` vẫn chạy nhưng không dùng đến — vô hại.

**Cách B — Chuyển hẳn CSDL về VPS.** Bỏ trống `DATABASE_URL`, hệ thống dùng
Postgres trong container. Phải chuyển dữ liệu sang (xem mục 7).

---

## 5. Khởi chạy

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Lần đầu mất khoảng 5–10 phút (build Next.js + cài thư viện Python).

Xem log:

```bash
docker compose -f docker-compose.prod.yml logs -f
```

Xong thì mở `https://erp.dosco.vn` — Caddy tự xin chứng chỉ Let's Encrypt, không
cần mua SSL.

---

## 6. Nếu CSDL trống hoàn toàn (chỉ Cách B, DB mới tinh)

```bash
docker compose -f docker-compose.prod.yml exec backend python -m app.seed
```

> **CẢNH BÁO:** lệnh này tạo tài khoản demo mật khẩu `123456`
> (`giamdoc@dosco.vn`, `quanly@dosco.vn`, `ketoan@dosco.vn`,
> `hientruong@dosco.vn`). Chạy xong **phải đổi mật khẩu ngay lập tức**.
> Nếu dùng **Cách A (Neon đã có dữ liệu thật)** thì **TUYỆT ĐỐI KHÔNG chạy lệnh này**.

---

## 7. Chuyển dữ liệu từ Neon về VPS (chỉ Cách B)

Trên máy có `pg_dump` (hoặc chính VPS):

```bash
pg_dump "<CHUỖI_KẾT_NỐI_NEON>" -Fc -f dylight.dump
```

Chép file lên VPS rồi nạp vào container:

```bash
docker compose -f docker-compose.prod.yml exec -T db pg_restore -U dylight -d dylight --clean --if-exists < dylight.dump
```

Kiểm tra số dự án trước/sau khi chuyển phải khớp nhau rồi mới tắt Render.

---

## 8. Vận hành

| Việc | Lệnh |
|---|---|
| Cập nhật mã mới | `git pull && docker compose -f docker-compose.prod.yml up -d --build` |
| Xem log | `docker compose -f docker-compose.prod.yml logs -f backend` |
| Khởi động lại | `docker compose -f docker-compose.prod.yml restart` |
| Dừng | `docker compose -f docker-compose.prod.yml down` |
| Sao lưu CSDL (Cách B) | `docker compose -f docker-compose.prod.yml exec db pg_dump -U dylight dylight > backup-$(date +%F).sql` |

Nên đặt lịch sao lưu hằng ngày bằng `cron`.

---

## 9. Sau khi chạy ổn mới tắt Render

Chạy song song vài ngày cho chắc. Khi quyết định tắt:

1. Render → `dosco-erp-web` và `dosco-erp-api` → **Suspend** (đừng xóa ngay).
2. Nếu chọn **Cách B**, kiểm tra kỹ dữ liệu đã sang đủ rồi mới đụng tới Neon.
3. GitHub Actions đồng bộ chấm công Yunatt
   (`.github/workflows/yunatt-sync.yml`) ghi thẳng vào CSDL — nếu đổi sang
   **Cách B** thì phải cập nhật secret `DATABASE_URL` trong GitHub, không thì
   đồng bộ vẫn chạy vào Neon cũ.

---

## Sự cố thường gặp

**Cổng 80/443 đã bị chiếm** (`bind: address already in use`) — trên VPS đã có
nginx / SafeLine WAF / control panel đang chạy. Caddy không khởi động được.
Hai cách xử lý:

- Dừng dịch vụ đang chiếm cổng, hoặc
- Bỏ Caddy, cho web server sẵn có làm reverse proxy: xóa service `caddy` trong
  compose, thêm `ports: ["127.0.0.1:3000:3000"]` cho `frontend` và
  `["127.0.0.1:8000:8000"]` cho `backend`, rồi khai báo site `erp.dosco.vn`
  trong nginx/WAF trỏ `/api/*` + `/static/*` → `127.0.0.1:8000`, còn lại →
  `127.0.0.1:3000`. HTTPS lúc này do nginx/WAF cấp.

**Trang trắng, Console báo lỗi CORS** — `FRONTEND_ORIGINS` không khớp domain
đang mở. Compose tự đặt theo `DOMAIN`; kiểm tra `.env` có đúng
`DOMAIN=erp.dosco.vn` không, rồi `up -d` lại.

**Gọi API vẫn trỏ về `onrender.com`** — biến `NEXT_PUBLIC_*` được "nướng" vào
bundle **lúc build**. Phải build lại, không restart suông được:

```bash
docker compose -f docker-compose.prod.yml up -d --build frontend
```

**`next build` bị Killed** — hết RAM. Nâng VPS lên 2 GB, hoặc tạo swap:

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
```

**Caddy không xin được chứng chỉ** — DNS chưa trỏ đúng, hoặc tường lửa chặn
cổng 80. Mở cổng:

```bash
ufw allow 80 && ufw allow 443
```

**Backend thoát ngay khi khởi động** với thông báo về `SECRET_KEY` — đúng như
thiết kế: `DEBUG=false` cấm dùng khóa mặc định. Đặt `SECRET_KEY` thật trong `.env`.
