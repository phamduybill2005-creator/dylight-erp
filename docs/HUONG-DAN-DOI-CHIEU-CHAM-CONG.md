# Đối chiếu nghỉ phép và chấm công theo buổi

## Cách sử dụng

1. Vào **Chấm công**, chọn ngày ở phần **Theo ngày**. Khung **Đối chiếu nghỉ phép và chấm công** hiển thị từng nhân sự, mốc chấm thực tế và kết quả sáng/chiều. Nhân viên chỉ xem được của mình; cấp quản lý có quyền xem đội theo phân quyền hiện có.
2. Lọc phòng ban, trạng thái hoặc bật **Cần xử lý** để tìm nghỉ/muộn không phép, đơn chờ duyệt và dữ liệu cần kiểm tra. Dùng **Xem đơn** để mở đúng hồ sơ liên quan.
3. Khi lập đơn đi muộn mới, nhập **Giờ được phép đến**. Đơn chỉ được tính có phép khi được duyệt đúng buổi; giờ vào muộn hơn mọi giờ đã được duyệt vẫn bị ghi nhận chưa có phép. Đơn cũ không có giờ đến vẫn có hiệu lực theo buổi đã duyệt.
4. Với xin phép qua điện thoại/Zalo, ADMIN bấm **Xác nhận phép**, chọn đúng buổi và loại phép, nhập người đồng ý cùng lý do. **Đặt lại tự động** gỡ xác nhận riêng của Admin; đơn đã duyệt vẫn được áp dụng. Giờ quẹt không thay đổi. Mỗi lần lưu/đặt lại được ghi lịch sử cùng danh tính người thực hiện.
5. Với trường hợp vắng chưa có đơn, kiểm tra máy đã Online, dữ liệu trên Yunatt và việc ghép nhân viên. Sau khi toàn bộ ca kết thúc, ADMIN ghi cách đã kiểm tra và bấm xác nhận đủ dữ liệu nguồn của đúng buổi. Các trường hợp vắng không có phép khi đó mới được chốt **Nghỉ không phép**. Lần đồng bộ thành công không tự thay thế bước kiểm tra này.

## Quy tắc và phạm vi

- Làm cả ngày: chỉ xét muộn theo giờ vào buổi sáng. Chỉ làm chiều: xét giờ vào so với giờ bắt đầu chiều, mặc định 13:30 hoặc giờ riêng. Không yêu cầu bốn lượt quẹt mỗi ngày.
- Đơn nghỉ sáng không miễn muộn chiều; đơn đi muộn không cho phép vắng cả buổi. Đơn đang chờ duyệt, bị từ chối hoặc đã hủy không được coi là phép đã duyệt.
- Lịch nguồn SCHEDULE là buổi không phải đi làm, không phải nghỉ có phép. Lịch đã duyệt mới nhất áp dụng cho ngày đó.
- Lượt quẹt đơn lẻ chưa rõ vào/ra, thiếu giờ ra, mốc giờ tương lai hoặc ngày trước khi tạo tài khoản chưa có căn cứ được giữ ở **Cần kiểm tra**. Khi có thêm mốc máy hoặc chỉnh giờ hợp lệ, kết quả tự đối chiếu lại.
- Các ngày có dữ liệu lịch sử/đơn đã duyệt vẫn được đối chiếu ngay cả khi trước ngày tạo tài khoản. Ngày tạo tài khoản không được coi là ngày bắt đầu đi làm.
- Xác nhận mới theo buổi không bị mất khi đồng bộ lại. Đường sửa cờ đi muộn cũ trên API đã được ngừng dùng; dùng xác nhận theo buổi để có lý do và lịch sử đầy đủ.
- Kết quả trong khung đối chiếu là phân loại mới theo buổi. Tổng hợp tháng/Đánh giá và thông báo nhóm chưa được chuyển sang cơ chế mới trong bước 1–4 này.

## Triển khai

- Backend có hai bảng mới: `attendance_session_overrides`, `attendance_data_confirmations`, và cột `leave_requests.allowed_arrival_time`. Cơ chế khởi động ERP hiện có tạo bảng mới và thêm cột vào bảng cũ; migration `f48a11b6c920` cũng được cung cấp cho cơ sở dữ liệu ERP đã có schema.
- `AFTERNOON_END_MIN` mặc định 1020 (17:00). `ATTENDANCE_HOLIDAYS` là danh sách ngày `YYYY-MM-DD` ngăn cách bằng dấu phẩy; Chủ nhật mặc định không có lịch làm.
- Đã kiểm thử migration lặp lại và bảo toàn dữ liệu trên SQLite tạm. Chưa thực hiện migration hoặc kiểm tra dữ liệu trên máy chủ thật.
