# Thiết kế giao diện điện thoại cho DOSCO ERP

## Mục tiêu

Giao diện ở màn hình 360–430 px phải ưu tiên công việc chính, không bị tràn ngang ở cấp trang, không có nút nổi che dữ liệu và không buộc người dùng đọc bảng máy tính thu nhỏ. Giao diện máy tính, dữ liệu, API và phân quyền giữ nguyên.

## Khung ứng dụng

- Thanh đầu trang chỉ giữ logo, tin nhắn, thông báo và tài khoản.
- Thanh điều hướng cố định dưới màn hình có bốn mục chính: Tổng quan/Trang chủ, Dự án, Tiến độ, Lịch làm việc; mục Thêm mở danh sách chức năng còn lại theo quyền.
- Hai nút tin nhắn và thông báo chuyển vào thanh đầu trang, không nổi trên nội dung.
- Nội dung chừa khoảng an toàn cho thanh điều hướng dưới; vùng bấm chính tối thiểu khoảng 44 px.
- Nhãn `Tổng hợp` đổi thành `Chấm công`; `Profile` đổi thành `Nhân sự`.

## Màn hình dữ liệu

- Tiến độ: điện thoại dùng danh sách dự án gồm mã, tên, tổng giờ và công. Chạm một dự án để mở số giờ theo từng ngày. Bảng tuần/tháng đầy đủ chỉ hiển thị ở màn hình lớn.
- Dự án: điện thoại dùng thẻ có mã, tên tối đa hai dòng, trạng thái, người phụ trách, hạn và tiến độ. Nội dung chi tiết mở khi chạm.
- Doanh thu: điện thoại đưa số tiền lên cùng dự án; giờ là thông tin phụ. Tỷ giá và điều khiển phụ được thu gọn.
- Lịch làm việc: điện thoại dùng danh sách theo nhân sự/ngày và giữ bảng tháng cho màn hình lớn.
- Chấm công, nhân sự, nghỉ phép và đánh giá: dùng danh sách/thẻ có chỉ số quan trọng; bảng rộng chỉ dành cho màn hình lớn.

## Chi tiết và biểu mẫu

- Đầu trang chi tiết dự án xếp dọc trên điện thoại. Tên dùng toàn bộ chiều rộng; một thao tác chính hiển thị trực tiếp, thao tác còn lại nằm trong menu.
- Thanh công cụ của từng mục được phép xuống dòng.
- Biểu mẫu sửa dự án là bảng một cột trên điện thoại; các trường ngày không nằm cạnh nhau; modal dùng chiều cao màn hình với một vùng cuộn.

## Tiêu chí chấp nhận

- Không có cuộn ngang ở cấp `body` tại 360, 390 và 430 px.
- Không có nút tin nhắn/thông báo che nội dung.
- Các chỉ số quan trọng của từng trang thấy được mà không kéo ngang.
- Người dùng vẫn mở được bảng chi tiết trên máy tính và mọi thao tác cũ còn hoạt động.
- `npm test` và `npm run build` thành công; kiểm tra trực quan các trang chính ở 360, 390 và 430 px.
