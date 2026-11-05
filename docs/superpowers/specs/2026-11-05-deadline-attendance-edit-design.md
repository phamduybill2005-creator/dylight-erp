# Thiết kế: thông báo dự án và sửa giờ chấm công

## Ý định

Giúp người nhận thông báo nhận diện và mở đúng dự án ngay lập tức; đồng thời cho Quản trị hệ thống sửa giờ vào/ra khi nhân viên quên chấm một mốc trên bản ghi đã tồn tại.

## Mục tiêu

- Popup nhắc hạn hiển thị `[Mã dự án] Tên dự án`.
- Mỗi dự án trong popup mở thẳng `/projects/{id}` khi bấm; nút `Xem dự án` mở dự án đầu tiên.
- Chỉ tài khoản `ADMIN` được sửa `check_in` và `check_out` ngay trên từng dòng chi tiết chấm công.
- Khi bấm sửa, dòng hiện hai ô giờ cùng nút Lưu/Hủy; các vai trò khác chỉ xem như hiện tại.
- Backend từ chối giờ ra sớm hơn giờ vào và từ chối mốc thời gian không thuộc ngày công của bản ghi.
- Sau khi lưu, chi tiết ngày, tổng giờ và tổng hợp tháng được làm mới.
- Ghi nhật ký hoạt động khi giờ chấm công thay đổi.

## Không làm trong đợt này

- Không tạo bản ghi cho ngày chưa có bất kỳ mốc giờ nào.
- Không cho Giám đốc hoặc Quản lý sửa giờ; quyền sửa giờ chỉ dành cho `ADMIN`.
- Không thay đổi công thức tính ngày công, đi trễ hoặc tổng giờ.

## Ràng buộc

- Giữ nguyên API sửa mác đi trễ và ghi chú cho các vai trò hiện có.
- Trường giờ được gửi dưới dạng datetime đầy đủ nhưng giao diện chỉ nhập `HH:mm`; ngày lấy cố định từ `work_date`.
- Cho phép để trống một mốc nếu thực tế chỉ có giờ vào hoặc giờ ra.

## Các cách đã cân nhắc

1. **Sửa trực tiếp trên dòng — đã chọn.** Ít thao tác, đúng ngữ cảnh và giao diện chỉ mở ô nhập khi cần.
2. Modal sửa giờ. Sạch hơn nhưng thêm bước thao tác.
3. Luôn hiện ô nhập. Nhanh nhưng dễ sửa nhầm và làm bảng rối.

## Triển khai dự kiến

- Mở rộng `AttendanceUpdate` và endpoint cập nhật chấm công để nhận hai mốc giờ, kiểm quyền `ADMIN`, kiểm ngày/thứ tự giờ và ghi audit log.
- Mở rộng kiểu dữ liệu API phía frontend.
- Thêm trạng thái sửa giờ theo từng bản ghi trong trang Chấm công, với nút bút, Lưu và Hủy.
- Đổi thẻ dự án trong `DeadlineAlert` thành liên kết trực tiếp và bổ sung mã dự án ở popup lẫn thông báo desktop.
- Thêm kiểm thử backend cho quyền/validation/cập nhật giờ và kiểm thử frontend cho dữ liệu thông báo, sau đó chạy toàn bộ test và production build.
