# Sửa giờ thông báo cũ đã xác minh

Thông báo mới dùng `vn_now()` từ commit `c72298a`. Frontend hiển thị theo
`Asia/Ho_Chi_Minh`. Tuy nhiên, thông báo cũ có thể lưu UTC hoặc giờ Việt Nam
trong cùng cột không có múi giờ. Deploy lại không tự sửa các bản ghi đó.

Chỉ dùng công cụ này cho những thời điểm đã được đối chiếu độc lập. Không cộng
7 giờ cho toàn bộ lịch sử, cũng không suy đoán từ giờ sớm/muộn trong ngày.

## Thực hiện trên môi trường có database thật

1. Sao lưu database. Xác định đúng `company_id`. Chạy từ thư mục `backend`
   với cấu hình database của môi trường cần sửa.
2. Tạo bản xem trước cho các phút UTC đã xác minh. Ví dụ dưới đây là các mốc
   01:24 và 01:13 ngày 15/10/2026 được người dùng xác nhận tương ứng 08:24 và
   08:13 giờ Việt Nam. Thay `COMPANY_ID` bằng ID thực tế:

```text
python -m scripts.repair_notification_times preview --company-id COMPANY_ID --utc-minute 2026-10-15T01:24 --utc-minute 2026-10-15T01:13 --output notification-time-repair.json
```

3. Kiểm tra từng `id`, người nhận, tiêu đề và `before`/`after` trong JSON.
   Loại khỏi danh sách `rows` các thông báo khác vô tình trùng phút hoặc chưa
   được xác minh. Không commit file này lên Git vì có thông tin nội bộ.
4. Áp dụng đúng danh sách đã kiểm tra:

```text
python -m scripts.repair_notification_times apply notification-time-repair.json
```

Lệnh preview không sửa database. Lệnh apply chỉ sửa `created_at` của các ID
trong công ty đã chỉ định, trong một giao dịch. Nếu bất kỳ giờ gốc nào thay
đổi hoặc đã được sửa, toàn bộ lần áp dụng sẽ bị hủy. Chạy lại cùng bản kế
hoạch sẽ bị từ chối để tránh cộng giờ hai lần. Giữ JSON cùng bản sao lưu để
đối chiếu sau khi sửa; không sửa các trường `before`/`after` để ép chạy lại.

Sau khi apply, tải lại bảng thông báo và kiểm tra cả ngày khi giờ chuyển qua
nửa đêm. Các thông báo chưa xác minh vẫn giữ nguyên cho tới khi có mốc đối chiếu.
