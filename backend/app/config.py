"""
Cấu hình trung tâm của ứng dụng.
Đọc toàn bộ tham số từ biến môi trường (file .env) để dễ triển khai
trên nhiều môi trường (dev / staging / production) mà không sửa code.
"""
from functools import lru_cache
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Giá trị SECRET_KEY mặc định (CHỈ dùng cho dev). Nếu PROD (DEBUG=False) mà vẫn
# còn giá trị này -> app TỪ CHỐI khởi động, tránh việc ai biết khóa nằm sẵn trong
# git tự ký token giả mạo Giám đốc/Quản trị.
_DEFAULT_SECRET = "doi-secret-key-nay-trong-production-rat-quan-trong"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # --- Thông tin chung ---
    APP_NAME: str = "CÔNG TY DOSCO"
    API_V1_PREFIX: str = "/api/v1"
    DEBUG: bool = True

    # --- Cơ sở dữ liệu PostgreSQL ---
    # Ví dụ: postgresql+psycopg2://user:pass@localhost:5432/dylight
    DATABASE_URL: str = "postgresql+psycopg2://dylight:dylight@db:5432/dylight"

    # --- Bảo mật / JWT ---
    SECRET_KEY: str = _DEFAULT_SECRET
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 ngày

    # --- CORS: domain frontend được phép gọi API ---
    FRONTEND_ORIGINS: str = "http://localhost:3000"

    # --- Cấu hình AI OCR ---
    # OCR_PROVIDER: "openai" | "google" | "mock"
    # "mock" giúp chạy demo end-to-end mà KHÔNG cần API key.
    OCR_PROVIDER: str = "mock"
    OPENAI_API_KEY: str = ""
    OPENAI_VISION_MODEL: str = "gpt-4o"
    GOOGLE_VISION_API_KEY: str = ""

    # --- Lưu trữ ảnh hóa đơn ---
    UPLOAD_DIR: str = "uploads"
    MAX_UPLOAD_MB: int = 15

    # --- Tự nạp dữ liệu mẫu khi khởi động nếu CSDL trống ---
    # Tiện cho deploy: không cần vào Shell chạy seed thủ công. An toàn vì chỉ
    # tạo dữ liệu khi chưa có công ty nào. Đặt False để tắt sau khi đã có dữ liệu thật.
    AUTO_SEED: bool = True

    # --- Chấm công (attendance) ---
    # Khóa API cho máy chấm công gọi endpoint /attendance/punch (header X-API-Key).
    # Để trống = chưa bật endpoint cho máy (mọi lời gọi máy sẽ bị từ chối).
    ATTENDANCE_API_KEY: str = ""
    # Mốc giờ bắt đầu làm việc (giờ địa phương) để tính "đi trễ".
    WORK_START_HOUR: int = 8
    # CA làm việc để tính CÔNG (0.5 công / ca). Làm cả 2 ca = 1 công, 1 ca = 0.5 công.
    # Đơn vị: PHÚT trong ngày. Ca sáng 08:00–11:45, ca chiều 13:30–17:00.
    MORNING_END_MIN: int = 11 * 60 + 45       # 11:45 — hết ca sáng
    AFTERNOON_START_MIN: int = 13 * 60 + 30    # 13:30 — vào ca chiều

    # --- Máy chấm công ĐẨY TRỰC TIẾP qua giao thức ZKTeco PUSH/ADMS (/iclock) ---
    # Trỏ "địa chỉ máy chủ" trên máy về domain ERP; máy tự gọi /iclock/cdata.
    # CHỈ nhận các số sê-ri (SN) liệt kê ở đây (cách nhau dấu phẩy). Trống = TỪ CHỐI hết (an toàn).
    IATT_DEVICE_SNS: str = ""
    IATT_COMPANY_ID: int = 0     # 0 = gán vào công ty đầu tiên
    IATT_TIMEZONE: int = 7       # múi giờ trả về cho máy (VN = 7)

    # --- Đồng bộ TỰ ĐỘNG từ cổng chấm công Yunatt (global.yunatt.com) ---
    # Máy chấm công khuôn mặt DOSCO đẩy dữ liệu lên Yunatt cloud. Backend dùng
    # trình duyệt ẩn (Playwright) đăng nhập Yunatt, lấy lượt quẹt cả tháng rồi
    # ghi vào bảng Attendance (tự hiện ở tổng hợp của sếp & cá nhân từng người).
    YUNATT_ENABLED: bool = False                       # True = bật đồng bộ + lịch chạy
    YUNATT_BASE_URL: str = "https://global.yunatt.com"
    YUNATT_EMAIL: str = ""                             # tài khoản Yunatt (email)
    YUNATT_PASSWORD: str = ""                          # mật khẩu Yunatt (đặt ở ENV server, KHÔNG commit)
    YUNATT_COMPANY_ID: int = 0                         # công ty ERP nhận dữ liệu (0 = công ty đầu tiên)
    YUNATT_SYNC_HOUR: int = 20                         # giờ chạy tự động hằng ngày (20 = 8h tối)
    YUNATT_SYNC_MINUTE: int = 0
    YUNATT_TIMEZONE: str = "Asia/Ho_Chi_Minh"         # múi giờ cho lịch chạy
    YUNATT_HEADLESS: bool = True                       # False để debug (mở trình duyệt thật)

    # --- Đăng nhập bằng Google (OAuth2 / Google Identity) ---
    # Dán OAuth Client ID (....apps.googleusercontent.com) vào để BẬT tính năng.
    GOOGLE_CLIENT_ID: str = ""
    # True (MẶC ĐỊNH): email Google lạ -> tự tạo tài khoản CHỜ DUYỆT (is_approved=False);
    #   chưa vào được hệ thống cho tới khi Giám đốc/Quản trị web duyệt & phân vị trí.
    # False (siết tối đa): từ chối thẳng mọi email chưa được thêm trước.
    GOOGLE_AUTO_CREATE: bool = True
    GOOGLE_DEFAULT_COMPANY_ID: int = 1          # công ty gán cho người tự tạo
    GOOGLE_DEFAULT_ROLE: str = "FIELD_STAFF"    # vai trò mặc định (thấp nhất) cho người tự tạo

    @model_validator(mode="after")
    def _enforce_prod_secret(self):
        """PROD (DEBUG=False): cấm dùng SECRET_KEY mặc định -> chống giả mạo token."""
        if not self.DEBUG and self.SECRET_KEY == _DEFAULT_SECRET:
            raise ValueError(
                "SECRET_KEY dang la gia tri mac dinh tren moi truong PROD (DEBUG=False). "
                "Hay dat bien moi truong SECRET_KEY bang mot chuoi ngau nhien dai (>=32 ky tu)."
            )
        return self

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.FRONTEND_ORIGINS.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    """Cache cấu hình để không phải đọc lại .env mỗi lần gọi."""
    return Settings()


settings = get_settings()
