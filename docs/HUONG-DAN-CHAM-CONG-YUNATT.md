# Hướng dẫn cập nhật chấm công từ Yunatt vào ERP

Tài liệu này hướng dẫn cách đưa dữ liệu chấm công (máy khuôn mặt → Yunatt cloud)
vào app ERP, gồm **2 phần**:
- **Phần A — Cài đặt 1 lần** (deploy + cấu hình + ghép nhân viên).
- **Phần B — Cập nhật hằng ngày** (tự động + bấm tay khi cần).

---

## ⚙️ Phần A — Cài đặt 1 LẦN (làm xong là quên)

### A1. Đưa code lên app (deploy)
1. Mở Pull Request rồi bấm **Merge** vào nhánh `main`:
   https://github.com/phamduybill2005-creator/dylight-erp/pull/new/claude/nervous-meninsky-2fdd1f
2. Hệ thống build lại (Render: tự build ~5–10 phút; hoặc tự host: chạy
   `docker compose -f docker-compose.prod.yml up -d --build`).

### A2. Khai báo tài khoản Yunatt cho server
Đặt 2 biến môi trường (KHÔNG ghi vào code):
| Biến | Giá trị |
|---|---|
| `YUNATT_ENABLED` | `true` (đã đặt sẵn) |
| `YUNATT_EMAIL` | email đăng nhập Yunatt |
| `YUNATT_PASSWORD` | mật khẩu Yunatt |

- **Trên Render:** service `dosco-erp-api` → tab **Environment** → thêm `YUNATT_EMAIL`,
  `YUNATT_PASSWORD` → **Save** (service tự deploy lại).
- **Tự host (docker-compose):** thêm 3 dòng trên vào file `.env` cạnh
  `docker-compose.prod.yml` → chạy lại `docker compose ... up -d`.

### A3. Bảo đảm nhân viên đã có trong ERP
Mỗi người trên máy chấm công cần có **tài khoản/nhân sự** trong ERP để ghép vào.
Thiếu ai thì vào **Nhân sự** tạo trước (chỉ Giám đốc/Quản trị).

### A4. Ghép nhân viên Yunatt ↔ ERP (1 lần)
1. Đăng nhập app bằng tài khoản **Giám đốc/Quản trị**.
2. Menu **Máy chấm công** → mục **"Ghép nhân viên Yunatt ↔ ERP"**.
3. Bấm **"Tải danh sách người từ Yunatt"** (chờ ~15 giây).
4. Mỗi **mã** (01, 02, …) chọn đúng **nhân viên ERP** trong ô bên phải → tự lưu.
5. Ai bị "Chưa ghép" thì dữ liệu của người đó sẽ bị bỏ qua khi đồng bộ → nhớ ghép hết.

> Vì sao phải ghép? Máy Yunatt nhận diện theo **mã nhân viên** (01–25) và tên viết
> tắt (vd "D.V.QUANG"), nên hệ thống không tự đoán đúng người — cần chỉ định 1 lần.

---

## 🔄 Phần B — Cập nhật số liệu

### B1. Tự động (không phải làm gì)
Mỗi ngày **20:00**, server tự đăng nhập Yunatt, kéo chấm công **tháng này + tháng
trước** và ghi vào ERP.

> **Kiểm tra job đã chạy chưa:** menu **Máy chấm công** → ô **"Đồng bộ tự động"** có
> dòng **"Lần đồng bộ gần nhất: …"** (xanh = OK, đỏ = lỗi kèm nguyên nhân). Nhờ vậy
> Ban Giám đốc biết được job 20:00 có chạy đúng không mà không cần xem log server.

### B2. Cập nhật ngay lập tức (khi cần xem liền)
1. Menu **Máy chấm công** → bấm **"Đồng bộ ngay"** (chờ ~15–30 giây).
2. Xem dòng kết quả: *đã đồng bộ X ngày công, khớp Y/Z lượt quẹt*. Nếu báo "N người
   chưa map" → quay lại bước **A4** ghép nốt rồi bấm lại.

### B3. Xem số liệu
- **Giám đốc/Quản lý:** menu **Chấm công** → **Tổng hợp** (chọn tháng) thấy ngày công,
  tổng giờ, đi trễ từng người + 4 chỉ số nhanh.
- **Từng nhân viên:** vào **Chấm công** thấy lịch sử & tổng giờ của chính mình.

---

## ❓ Xử lý sự cố nhanh
| Hiện tượng | Cách xử lý |
|---|---|
| "Đồng bộ ngay" báo lỗi đăng nhập | Kiểm tra lại `YUNATT_EMAIL` / `YUNATT_PASSWORD` trong cấu hình server |
| "Tính năng đồng bộ đang tắt" | Đặt `YUNATT_ENABLED=true` rồi deploy lại |
| Có người không lên dữ liệu | Người đó "Chưa ghép" (bước A4) hoặc tháng đó không quẹt |
| Đi trễ tính sai mốc giờ | Đổi `WORK_START_HOUR` (mặc định 8 = 08:00) trong cấu hình |
| Ngày chỉ có 1 mốc → 0 giờ làm | Hôm đó chỉ quẹt 1 lần (thiếu giờ ra) — kiểm tra lại trên máy |
