# Đối chiếu nghỉ phép và chấm công theo buổi

## Cách sử dụng

1. Vào **Chấm công → Tổng hợp chấm công**, chọn tháng rồi bấm tên nhân viên. Chi tiết hiển thị tất cả ngày trong tháng, kể cả ngày không có lượt quẹt. Nhân viên chỉ xem được của mình; cấp quản lý xem theo phân quyền hiện có.
2. Mỗi dòng có ngày, trạng thái ngắn và giờ chấm thực tế. Khi sáng/chiều khác nhau, trạng thái ghi rõ từng buổi. Đơn nghỉ đã duyệt tự hiện **Nghỉ có phép** dù ngày đó không có lượt quẹt. Ngày tương lai ghi rõ **Chưa đến ngày**; mở bút chì để xem căn cứ và liên kết **Xem đơn** nếu có.
3. Khi lập đơn đi muộn mới, nhập **Giờ được phép đến**. Đơn chỉ được tính có phép khi được duyệt đúng buổi; giờ vào muộn hơn mọi giờ đã được duyệt vẫn bị ghi nhận chưa có phép. Đơn cũ không có giờ đến vẫn có hiệu lực theo buổi đã duyệt.
4. Với xin phép qua điện thoại/Zalo, ADMIN bấm **bút chì cạnh ngày**, chọn **Sáng / Chiều / Cả ngày**, chọn **Nghỉ có phép / Muộn có phép**, nhập người cho phép cùng lý do rồi **Lưu xác nhận**. Có thể làm ngay cả khi không có lượt quẹt. **Đặt lại tự động** chỉ gỡ xác nhận riêng của Admin; đơn đã duyệt vẫn áp dụng. Mỗi lần lưu/đặt lại có lịch sử người thực hiện; chọn cả ngày lưu hai buổi cùng một giao dịch.
5. Giờ quẹt và xác nhận phép được lưu riêng. Nếu cần sửa giờ thực tế, ADMIN mở bút chì rồi dùng phần **Giờ chấm công thực tế**; phần này chỉ xuất hiện khi đã có mốc chấm. Nhân sự không còn hoạt động vẫn xem được đơn và giờ lịch sử, nhưng không tạo xác nhận phép mới.
6. Vắng chưa có đơn và chưa xác minh đủ dữ liệu nguồn được giữ ở **Chờ dữ liệu**, không tự coi là nghỉ có phép hoặc không phép. Lần đồng bộ thành công không chứng minh máy đã gửi đủ lượt quẹt. Giao diện gọn này không tự xác nhận dữ liệu nguồn cho toàn công ty.
7. Vào **Đánh giá**, chọn cùng tháng: **Muộn CP/KP** tự tổng hợp theo lần; **Nghỉ CP/KP** theo ngày (mỗi buổi 0,5 ngày). Admin sửa phép, duyệt đơn hoặc đồng bộ chấm công thì số liệu được tính lại khi tải và tự làm mới trên trang. Dấu **buổi chờ đối soát** cho biết còn dữ liệu chưa đủ kết luận; các buổi này chưa tính vi phạm. Muốn điều chỉnh phép, sửa tại ngày chấm công; ba điểm Ý thức, Chất lượng công việc và Tập thể vẫn do Giám đốc nhập.
8. **Mốc bắt đầu tính Đánh giá là ngày có lượt chấm công đầu tiên trong toàn bộ lịch sử của nhân viên**, không phải ngày tạo tài khoản hoặc đầu tháng đang xem. Các ngày trước mốc không cộng số nghỉ/muộn hoặc buổi chờ đối soát; chưa từng chấm công thì các số này bằng 0. Bản ghi trống/chỉ có ghi chú và giờ chấm tương lai không tạo mốc. Đồng bộ thêm lịch sử sẽ tự tính lại mốc. Thông tin chấm công và đơn phép đã lưu vẫn được giữ nguyên; chỉ phạm vi tổng hợp Đánh giá được giới hạn theo mốc này.

## Quy tắc và phạm vi

- Làm cả ngày: chỉ xét muộn theo giờ vào buổi sáng. Chỉ làm chiều: xét giờ vào so với giờ bắt đầu chiều, mặc định 13:30 hoặc giờ riêng. Không yêu cầu bốn lượt quẹt mỗi ngày.
- Đơn nghỉ sáng không miễn muộn chiều; đơn đi muộn không cho phép vắng cả buổi. Đơn đang chờ duyệt, bị từ chối hoặc đã hủy không được coi là phép đã duyệt.
- Lịch nguồn SCHEDULE là buổi không phải đi làm, không phải nghỉ có phép. Lịch đã duyệt mới nhất áp dụng cho ngày đó.
- Lượt quẹt đơn lẻ chưa rõ vào/ra, thiếu giờ ra, mốc giờ tương lai hoặc ngày trước khi tạo tài khoản chưa có căn cứ được giữ ở **Cần kiểm tra**. Khi có thêm mốc máy hoặc chỉnh giờ hợp lệ, kết quả tự đối chiếu lại.
- Các ngày có dữ liệu lịch sử/đơn đã duyệt vẫn được đối chiếu ngay cả khi trước ngày tạo tài khoản. Ngày tạo tài khoản không được coi là ngày bắt đầu đi làm.
- Xác nhận mới theo buổi không bị mất khi đồng bộ lại. Đường sửa cờ đi muộn cũ trên API đã được ngừng dùng; dùng xác nhận theo buổi để có lý do và lịch sử đầy đủ.
- Trạng thái trong chi tiết là phân loại theo buổi. Tổng ngày công/giờ trên thẻ vẫn dựa vào chấm công thực tế; ngày nghỉ có phép không tự cộng giờ làm. Tab Đánh giá và Excel dùng cùng số tự tổng hợp; không cộng trùng đơn nghỉ, không tính ngày tương lai. Số chấm công nhập tay cũ vẫn giữ trong cơ sở dữ liệu nhưng không thay thế kết quả đối chiếu. Chưa tự trừ điểm đánh giá hoặc gửi thông báo nhóm.

## Triển khai

- Backend có hai bảng mới: `attendance_session_overrides`, `attendance_data_confirmations`, và cột `leave_requests.allowed_arrival_time`. Cơ chế khởi động ERP hiện có tạo bảng mới và thêm cột vào bảng cũ; migration `f48a11b6c920` cũng được cung cấp cho cơ sở dữ liệu ERP đã có schema.
- `AFTERNOON_END_MIN` mặc định 1020 (17:00). `ATTENDANCE_HOLIDAYS` là danh sách ngày `YYYY-MM-DD` ngăn cách bằng dấu phẩy; Chủ nhật mặc định không có lịch làm.
- Đã kiểm thử migration lặp lại và bảo toàn dữ liệu trên SQLite tạm. Chưa thực hiện migration hoặc kiểm tra dữ liệu trên máy chủ thật.
