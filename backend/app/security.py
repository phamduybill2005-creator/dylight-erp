"""
Tiện ích bảo mật:
- Băm & kiểm tra mật khẩu bằng bcrypt.
- Tạo & giải mã JWT access token.
"""
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.config import settings

# Cấu hình thuật toán băm mật khẩu (bcrypt là tiêu chuẩn an toàn phổ biến).
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(plain: str) -> str:
    """Băm mật khẩu trước khi lưu DB (KHÔNG bao giờ lưu mật khẩu thô)."""
    return pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    """So khớp mật khẩu người dùng nhập với bản băm trong DB."""
    return pwd_context.verify(plain, hashed)


def create_access_token(subject: str, extra: dict | None = None) -> str:
    """
    Tạo JWT. 'subject' thường là user_id.
    'extra' để nhúng thêm thông tin như company_id, role.
    """
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
    )
    payload: dict = {"sub": str(subject), "exp": expire}
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_access_token(token: str) -> dict | None:
    """Giải mã & xác thực token. Trả về payload, hoặc None nếu không hợp lệ."""
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError:
        return None
