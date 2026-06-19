"""
Cấu hình trung tâm của ứng dụng.
Đọc toàn bộ tham số từ biến môi trường (file .env) để dễ triển khai
trên nhiều môi trường (dev / staging / production) mà không sửa code.
"""
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


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
    SECRET_KEY: str = "doi-secret-key-nay-trong-production-rat-quan-trong"
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

    # --- Máy chấm công ĐẨY TRỰC TIẾP qua giao thức ZKTeco PUSH/ADMS (/iclock) ---
    # Trỏ "địa chỉ máy chủ" trên máy về domain ERP; máy tự gọi /iclock/cdata.
    # CHỈ nhận các số sê-ri (SN) liệt kê ở đây (cách nhau dấu phẩy). Trống = TỪ CHỐI hết (an toàn).
    IATT_DEVICE_SNS: str = ""
    IATT_COMPANY_ID: int = 0     # 0 = gán vào công ty đầu tiên
    IATT_TIMEZONE: int = 7       # múi giờ trả về cho máy (VN = 7)

    # --- Đăng nhập bằng Google (OAuth2 / Google Identity) ---
    # Dán OAuth Client ID (....apps.googleusercontent.com) vào để BẬT tính năng.
    GOOGLE_CLIENT_ID: str = ""
    # True (MẶC ĐỊNH): email Google lạ -> tự tạo tài khoản CHỜ DUYỆT (is_approved=False);
    #   chưa vào được hệ thống cho tới khi Giám đốc/Quản trị web duyệt & phân vị trí.
    # False (siết tối đa): từ chối thẳng mọi email chưa được thêm trước.
    GOOGLE_AUTO_CREATE: bool = True
    GOOGLE_DEFAULT_COMPANY_ID: int = 1          # công ty gán cho người tự tạo
    GOOGLE_DEFAULT_ROLE: str = "FIELD_STAFF"    # vai trò mặc định (thấp nhất) cho người tự tạo

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.FRONTEND_ORIGINS.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    """Cache cấu hình để không phải đọc lại .env mỗi lần gọi."""
    return Settings()


settings = get_settings()
