# Zalo OA OAuth — DOSCO ERP / VPS Docker

Mã đã chuẩn bị ở local. Các lệnh thay đổi VPS bên dưới chỉ thực hiện sau một lần xác nhận deploy riêng. Chưa cấp quyền OA thật, chưa gửi tin GMF thật, chưa chạy migration trên database ERP local hoặc production.

Flow OAuth/GMF hiện tại không gọi `getoa` và **không yêu cầu quyền quản lý thông tin OA**. App Doscoerp cần được OA Admin cấp quyền cho OA Công ty DOSCO qua OAuth và được cấp quyền **quản lý thông tin nhóm** cho hai API đang dùng: [Lấy danh sách nhóm OA đang quản lý](https://docs.zaloplatforms.com/docs/OA/nhom-chat-gmf/quan-ly/get_group_of_oa) và [Gửi tin nhắn nhóm dạng Text](https://docs.zaloplatforms.com/docs/OA/nhom-chat-gmf/tin-nhan/text_message). API lấy thông tin một nhóm chưa được gọi trong code hiện tại; các quyền GMF bạn đã có không cần thay đổi.

## Proxy đã kiểm tra trong repository

`Caddyfile` dùng `handle /api/*` → `reverse_proxy backend:8000`, giữ nguyên đường dẫn, nên bao gồm `https://erp.dosco.vn/api/zalo/callback`. Router mới đăng ký trực tiếp `/api/zalo`, ngoài `/api/v1`.

`docker-compose.prod.yml` có service Caddy sử dụng file này. `docker-compose.yml` xuất backend ở `127.0.0.1:8000` và frontend ở `127.0.0.1:3000`, không có service Caddy; trường hợp đó proxy đang chạy trên host hoặc ở cấu hình khác. Phải đối chiếu cấu hình proxy thực sự được VPS nạp trước deploy. Chưa truy cập VPS nên chưa xác minh được cấu hình đang chạy. Không sửa Caddyfile, Dockerfile hay Compose trong thay đổi này.

## Biến môi trường backend

Đặt giá trị thật trong `backend/.env` trên VPS, giới hạn quyền đọc file. Không đưa vào biến `NEXT_PUBLIC_*`, frontend, Git hoặc Docker build args.

| Biến | Giá trị / ý nghĩa |
| --- | --- |
| `ZALO_ENABLED` | `false` mặc định; chuyển `true` sau khi chuẩn bị schema và đủ cấu hình |
| `ZALO_APP_ID` | App ID số của Doscoerp |
| `ZALO_APP_SECRET` | App Secret của Doscoerp |
| `ZALO_OA_CALLBACK_URL` | `https://erp.dosco.vn/api/zalo/callback` |
| `ZALO_OA_ID` | ID số của OA Công ty DOSCO, lấy từ trang quản trị OA |
| `ZALO_COMPANY_ID` | ID tenant DOSCO trong bảng `companies`; phải trùng công ty của ADMIN khởi tạo |
| `ZALO_GMF_GROUP_ID` | Nhóm GMF nhận thông báo nhóm soạn thủ công; mặc định trống để chưa tự gửi |
| `ZALO_TOKEN_ENCRYPTION_KEY` | Fernet key: Base64URL của 32 byte ngẫu nhiên, độc lập với JWT `SECRET_KEY` |

Tạo encryption key trên môi trường riêng, lưu vào trình quản lý secret / file backend; không chia sẻ đầu ra:

```bash
python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'
```

Giữ bản sao key an toàn cùng chiến lược backup database. Không đổi key tùy tiện: dữ liệu đã mã hóa sẽ không giải mã được. Luân chuyển key cần một quy trình riêng. Access token, refresh token và PKCE verifier được lưu dưới dạng Fernet ciphertext; state và cookie binding chỉ lưu SHA-256. Timestamps của hai bảng Zalo là UTC.

Giữ các thiết lập backend hiện hữu, đặc biệt `DATABASE_URL`, JWT `SECRET_KEY`, `DEBUG=false`, `AUTO_SEED=false`. Đây không phải các biến Zalo mới. `.dockerignore` mới loại `.env`, `*.env`, venv, DB và log khỏi backend image; cấu hình runtime cần được truyền qua Docker, không dựa vào `.env` được đóng gói trong image.

### Nếu VPS dùng docker-compose.yml

File này đã có `backend.env_file: ./backend/.env`: thêm các biến Zalo vào file đó là đủ, không cần sửa Compose.

### Nếu VPS dùng docker-compose.prod.yml

`.env` cạnh Compose chỉ cung cấp giá trị thay thế `${...}`; file hiện tại không truyền các biến Zalo vào backend. Tạo một override riêng **trên VPS sau khi được duyệt deploy**, ví dụ `docker-compose.zalo.yml`:

```yaml
services:
  backend:
    env_file:
      - ./backend/.env
```

Đặt các biến Zalo trong `backend/.env`. Các trường `environment` đã có của prod Compose vẫn được ưu tiên, giữ nguyên cấu hình ERP/DB hiện tại. Dùng cùng tên project Compose hiện hữu và cùng tập file trên mọi lệnh; chỉ thêm override, không đổi project/container/volume. Các lệnh minh họa cho nhánh này sử dụng:

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.zalo.yml <command>
```

Không dùng `docker compose config` đầy đủ trong log chia sẻ vì có thể in secret. Có thể kiểm tra tên service bằng `docker compose ... config --services`.

## Migration riêng, chưa chạy trên ERP

Revision `c72d40e9a615`, nối tiếp `b6a83f2d1c4e`, chỉ tạo:

- `zalo_oauth_transactions`: state hash, browser binding hash, ADMIN/tenant, snapshot cấu hình, verifier mã hóa, expiry và trạng thái single-use.
- `zalo_oa_credentials`: OA/tenant/app, cặp token mã hóa, `expires_at`, `updated_at`, generation và trạng thái refresh.

Mỗi tenant có một credential, mỗi OA có một credential. Module dùng cơ chế auth ERP hiện hữu. Khởi động ERP không tự tạo hai bảng này; khi chưa migrate, endpoint Zalo trả lỗi an toàn thay vì tạo schema ngầm.

Project hiện dùng cả startup `create_all`/ALTER và Alembic, nên chưa thể giả định revision database VPS trùng head. Script `scripts/zalo_prepare_db.py` mặc định chỉ đọc schema. `--apply` áp dụng **duy nhất revision này**, không chạy các migration ERP cũ và không sửa/stamp `alembic_version`. PostgreSQL có advisory lock trong transaction, kiểm tra schema trước khi tạo; schema đã tương thích sẽ bỏ qua, schema thiếu một bảng hoặc sai cấu trúc sẽ từ chối.

Sau khi baseline Alembic của ERP được quản lý riêng, revision này vẫn có thể nhận diện schema tương thích và bỏ qua DDL. Script không tự xác nhận những migration cũ là đã được áp dụng. Không dùng `alembic upgrade head` hoặc `alembic stamp head` cho đợt này.

## Trình tự deploy đề xuất — chỉ chạy sau xác nhận riêng

1. Đối chiếu đúng repository, project Compose, file Compose và cấu hình proxy đang dùng trên VPS. Kiểm tra `/api/*` tới FastAPI, giữ nguyên path và Host. Backup database bằng quy trình hiện hành; lưu backup ngoài Git, bảo vệ vì có dữ liệu ERP. Ghi lại image backend hiện tại để rollback.
2. Chuyển đúng các file backend/Zalo và tài liệu trong danh sách thay đổi. Không đưa những thay đổi frontend local chưa commit vào đợt này. Chuẩn bị env backend như trên; giữ `ZALO_ENABLED=false` cho đến khi chuẩn bị xong.
3. Build image backend mới. Chưa thay container đang chạy. Với `docker-compose.yml` hiện hữu:

   ```bash
   docker compose build backend
   docker compose run --rm --no-deps backend python scripts/zalo_prepare_db.py
   ```

   Lệnh thứ hai chỉ kiểm tra schema. Không chạy `app.main`, không seed, không tạo bảng và không gọi Zalo. Nếu kết quả báo sai schema/kết nối, dừng và kiểm tra; không chạy head/stamp để xử lý tự động.
4. Sau khi duyệt backup và kết quả schema, áp dụng riêng hai bảng:

   ```bash
   docker compose run --rm --no-deps backend python scripts/zalo_prepare_db.py --apply
   docker compose run --rm --no-deps backend python scripts/zalo_prepare_db.py
   ```

   Đối với prod Compose, thêm `-f docker-compose.prod.yml -f docker-compose.zalo.yml` vào **tất cả** lệnh tương ứng. Không chuyển từ file Compose hiện hữu sang file khác vì tên DB/service/volume khác nhau.
5. Kiểm tra đủ env, đổi `ZALO_ENABLED=true`, rồi thay riêng backend:

   ```bash
   docker compose up -d --no-deps backend
   ```

   Thao tác này có thể gián đoạn backend ngắn trong lúc thay container. Không build/restart frontend, Postgres, Caddy hoặc Yunatt. Startup schema ERP cũ vẫn hoạt động như trước; phần Zalo không thêm DDL vào startup. Kiểm tra health endpoint hiện hữu và log đã lọc secret. `GET /api/zalo/callback` không có state hợp lệ phải bị từ chối, không được bắt đầu OAuth hoặc gọi Zalo.
6. Kiểm tra chức năng ERP hiện hữu. Nếu cần rollback, khôi phục image backend cũ với env cũ; để nguyên hai bảng Zalo nhằm giữ dữ liệu, không downgrade/drop tự động.

Đây là hướng dẫn, chưa thực thi các lệnh trên. Build Docker và kiểm thử khóa/concurrency trên PostgreSQL thật cần môi trường staging có Docker/PostgreSQL; local hiện đã test SQLAlchemy trên SQLite tạm, SQL PostgreSQL offline, và toàn bộ backend test.

## OAuth thật và test nhóm — giai đoạn riêng sau deploy và cho phép

Chỉ ADMIN ERP thuộc `ZALO_COMPANY_ID` mới gọi được hai endpoint admin. Callback dùng cookie HttpOnly/Secure cùng trình duyệt khởi tạo; JWT không cần gửi tới callback. Trình duyệt phải truy cập đúng HTTPS domain cấu hình. Không mở URL OAuth ở trình duyệt/thiết bị khác; không chỉnh Host/Origin.

Khởi tạo từ trình duyệt đang đăng nhập ERP bằng request same-origin, ví dụ Console **sau khi được phép OAuth thật**:

```javascript
const result = await fetch('/api/zalo/authorize', {
  method: 'POST',
  headers: { Authorization: `Bearer ${localStorage.getItem('dylight_token')}` },
  credentials: 'same-origin'
});
if (!result.ok) throw new Error('Không khởi tạo được OAuth; kiểm tra quyền/cấu hình backend.');
const { authorization_url } = await result.json();
location.assign(authorization_url);
```

Không in JWT hoặc authorization URL/state vào log chia sẻ. Chỉ authorization URL và expiry được trả về; verifier không rời backend. Dùng API độc lập `/api/zalo`, không nối dưới biến frontend API base `/api/v1`.

OA Admin cấp quyền cho Doscoerp. Callback nhận `code`, `state`, `oa_id`, kiểm tra transaction, browser binding, OA đúng cấu hình, quyền ADMIN còn hiệu lực, expiry và single-use. Sau đó gửi token request OAuth v4 với `secret_key` header và verifier từ backend. Response chỉ chứa `status=connected`, `oa_id`. Trang JSON thành công là đủ trong giai đoạn này; không đổi frontend.

Trước khi consume transaction và đổi code, backend yêu cầu `oa_id` callback bằng cả `ZALO_OA_ID` và OA ID lưu trong transaction. Thiếu/sai OA ID sẽ bị từ chối mà chưa gọi token API. Credential lưu OA ID từ transaction đã qua kiểm tra, cùng company/app đã khởi tạo phiên; refresh chỉ đổi cặp token/expiry/generation/status, giữ nguyên OA/company/app. State, browser binding, expiry, single-use, verifier PKCE và quyền ADMIN/tenant vẫn được kiểm tra. Kiểm tra OA này dựa trên callback và transaction ADMIN đã xác thực; vì callback đi qua trình duyệt, đây không phải xác minh độc lập chủ sở hữu access token bằng API profile. Module hiện không cung cấp diagnostic `getoa`.

PKCE theo SDK chính thức: verifier ngẫu nhiên, challenge `Base64URL(SHA-256(verifier))` không padding. Không thêm `code_challenge_method` vì SDK Zalo hiện gửi `code_challenge` theo flow này. Transaction tồn tại tối đa 15 phút; authorization code vẫn phải dùng ngay trong thời hạn 10 phút của Zalo. Khởi tạo mới vô hiệu hóa phiên cũ của tenant, chống callback cũ ghi đè; verifier bị xóa khi consume/supersede, phiên quá hạn được dọn ở lần khởi tạo tiếp theo.

Test lấy nhóm sau khi kết nối, chỉ ADMIN, không gửi tin:

```javascript
const response = await fetch('/api/zalo/groups?offset=0&count=5', {
  headers: { Authorization: `Bearer ${localStorage.getItem('dylight_token')}` }
});
if (!response.ok) throw new Error('Không lấy được nhóm OA.');
const groups = await response.json();
console.table(groups.groups);
```

Response chỉ chứa OA ID/phân trang và `group_id`, `name`, `status`, `total_member`. Tăng offset để xem các trang tiếp theo. Không trả provider payload, token hoặc secret. `ZaloOAService.send_gmf_message(group_id, message)` được tái sử dụng bởi service thông báo thủ công bên dưới, không thêm endpoint gửi GMF độc lập. Trong test, hàm chỉ chạy qua MockTransport.

## Thông báo ERP soạn thủ công → GMF (bổ sung local)

Chỉ `POST /api/v1/notifications` được nối với `NotificationZaloService`. Quyền gửi và tập người nhận trong ERP giữ nguyên. Sau khi commit toàn bộ bản ghi ERP, service thử gửi **một** tin vào `ZALO_GMF_GROUP_ID`, ngoài vòng lặp người nhận. Không nối thông báo tự động về nghỉ phép, giao việc hoặc nhắc đánh giá với Zalo.

| Phạm vi ERP | Người nhận ghi trong tin GMF |
| --- | --- |
| `EVERYONE` | Tất cả mọi người |
| `DEPARTMENT` | Phòng <tên phòng ban>, không lặp chữ Phòng nếu tên đã có tiền tố |
| `MANAGERS` | Các quản lý |
| `STAFF` | Toàn bộ nhân viên |
| `USER` | Không gửi GMF; chỉ tạo thông báo ERP và báo chưa hỗ trợ gửi Zalo riêng |

Tin nhóm có định dạng:

```text
[THÔNG BÁO DOSCO]

Người nhận: <phạm vi>
Tiêu đề: <tiêu đề>
Nội dung: <nội dung>
Người gửi: <full_name của người gửi ERP đã xác thực>
```

Để gửi nhóm cần `ZALO_ENABLED=true`, `ZALO_COMPANY_ID` trùng công ty người gửi, `ZALO_GMF_GROUP_ID` không trống, đủ cấu hình OAuth và credential hợp lệ. Nhóm đã được chọn là `978226075868b136e879`; chỉ cấu hình giá trị này ở backend runtime khi được phép bật gửi thật. Env mẫu vẫn để trống. Không thêm migration hoặc thay cấu hình proxy/Compose.

Response giữ `sent` (số người nhận ERP), thêm `zalo.status=sent|skipped|failed` và reason code an toàn khi cần. `sent` của Zalo chỉ xác nhận API tiếp nhận, không chứng minh từng thành viên đã đọc. Frontend hiển thị riêng hai kết quả và tương thích backend cũ chưa có trường `zalo`.

Zalo lỗi/timeout hoặc thiếu credential không hủy thông báo ERP đã commit. Không tự retry GMF hoặc refresh token. Timeout có thể xảy ra sau khi Zalo đã nhận tin: không bấm gửi lại thông báo ERP để thử Zalo, vì có thể trùng tin. Cam kết một lần gọi GMF cho mỗi request ERP thành công; chưa có outbox/idempotency để chống trùng giữa các request người dùng gửi lại. Một lần refresh có thể thêm một HTTP request token trước request GMF. Gửi đồng bộ có thể làm response chờ thêm timeout của OAuth/GMF hiện có.

### Gửi riêng: chưa triển khai

Project chưa có mapping đã xác minh giữa ERP user và OA-scoped Zalo `user_id`. Số điện thoại không phải UID. Phương án cho giai đoạn riêng: bảng mapping `(company_id, erp_user_id, oa_id, zalo_user_id, verified_at)` với ràng buộc duy nhất theo OA/user; liên kết từ phiên ERP xác thực bằng nonce có expiry/single-use, đối chiếu tương tác qua webhook Zalo đã xác minh. Chưa tạo bảng hoặc endpoint này.

Private text dùng [API gửi tin tư vấn](https://docs.zaloplatforms.com/docs/OA/tin-nhan/tin-tu-van/gui-tin-tu-van-dang-van-ban), cần nhóm **quyền gửi tin nhắn**, ngoài quyền GMF. Cần đối chiếu [điều kiện gửi tin tư vấn](https://docs.zaloplatforms.com/docs/OA/tin-nhan/tin-tu-van/dieu-kien-gui-tin-tu-van) và mục đích nội dung; không mặc định thông báo nội bộ ERP đủ điều kiện. UID lấy từ tương tác/webhook OA, không bắt buộc thêm getoa hoặc quyền quản lý thông tin OA cho flow GMF. Nếu muốn gọi API lấy hồ sơ/danh sách người dùng thì đánh giá thêm quyền tương ứng ở giai đoạn đó. Khi chưa đủ mapping/quyền/điều kiện, `USER` chỉ báo `private_unavailable`, không gửi nhóm chung.

## Refresh và xử lý sự cố

Mỗi lần cần access token, service kiểm tra expiry và refresh nếu còn tối đa 5 phút. Claim refresh được commit trước HTTP, sau đó lưu cả cặp token mới cùng generation. Request cạnh tranh bị từ chối/tạm báo đang cập nhật; refresh cũ không ghi đè kết nối mới. Refresh token một lần dùng nên không retry khi timeout, lỗi provider hoặc lỗi lưu DB sau khi đã gọi: trạng thái chuyển `reconnect_required`; nếu process chết giữa chừng, trạng thái bền vững `refreshing` cũng chặn dùng lại token cũ. ADMIN cần kiểm tra/kết nối lại; không tự reset trạng thái về active.

Script mặc định chỉ đọc metadata và không gọi Zalo:

```bash
docker compose exec -T backend python scripts/zalo_refresh_token.py
```

**Chỉ sau OAuth thật và được phép chạy refresh**, có thể dùng lệnh sau trong job bảo trì định kỳ (ví dụ mỗi giờ), với đúng thư mục/project/Compose của VPS:

```bash
docker compose exec -T backend python scripts/zalo_refresh_token.py --refresh
```

Script chỉ in OA ID, status, expiry UTC; chỉ refresh khi gần hết hạn. Chưa tạo cron/job tự động trong đợt code này. Zalo mô tả access token 25 giờ, refresh token 3 tháng; implementation luôn sử dụng `expires_in` API trả về.

Giới hạn kiểm chứng: generation ngăn ghi đè cũ ở database, nhưng thứ tự vô hiệu hóa token phía Zalo khi cấp quyền lại và refresh đồng thời chưa được thử bằng integration thật. Cần xác minh trong staging được cho phép riêng trước production. Rà soát cũng ghi nhận test chưa mô phỏng commit refresh thành công nhưng mất acknowledgement, hoặc recovery write cùng bị lỗi; đây là phần có thể bổ sung sau, các nhánh lỗi lưu trước commit và lỗi HTTP đã được kiểm thử.

Callback query chứa authorization code/state. Uvicorn access logger được lọc toàn bộ query callback; response có `Cache-Control: no-store`, `Referrer-Policy: no-referrer`. Caddyfile trong repository hiện không bật access log. Nếu VPS bật log proxy/APM khác, cấu hình loại bỏ query callback và không thu request body/header của OAuth/token; kiểm tra ở bước đối chiếu proxy, không ghi code/token/secret vào log.

## Tài liệu chính thức đã đối chiếu

- [Zalo OA — xác thực và ủy quyền hiện tại](https://docs.zaloplatforms.com/docs/OA/bat-dau/xac-thuc-va-uy-quyen-cho-ung-dung-new)
- [SDK OAuth2Client](https://github.com/zaloplatform/zalo-php-sdk/blob/master/src/Authentication/OAuth2Client.php), [SDK PKCEUtil](https://github.com/zaloplatform/zalo-php-sdk/blob/master/src/Util/PKCEUtil.php)
- [GMF — danh sách nhóm OA](https://docs.zaloplatforms.com/docs/OA/nhom-chat-gmf/quan-ly/get_group_of_oa)
- [GMF — tin nhắn văn bản](https://docs.zaloplatforms.com/docs/OA/nhom-chat-gmf/tin-nhan/text_message)
