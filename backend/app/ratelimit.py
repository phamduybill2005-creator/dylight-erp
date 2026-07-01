"""
Chống DÒ MẬT KHẨU (brute-force / credential-stuffing) — bộ đếm THẤT BẠI trong bộ nhớ.

Chỉ đếm lần đăng nhập SAI (không đếm lần đúng) -> văn phòng dùng chung 1 IP đăng nhập
bình thường KHÔNG bị khóa; chỉ kẻ dò mật khẩu (nhiều lần sai) mới bị chặn tạm.

Đủ cho triển khai 1 tiến trình (Render free 1 worker). Nếu scale nhiều worker/instance
thì chuyển sang Redis. Bộ nhớ tự dọn theo cửa sổ thời gian.
"""
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status

_WINDOW = 900          # 15 phút
_MAX_PER_EMAIL = 8     # 8 lần sai / 15 phút cho MỘT tài khoản -> khóa tạm (chặn dò 1 tài khoản)
_MAX_PER_IP = 50       # 50 lần sai / 15 phút cho MỘT IP (rộng cho văn phòng NAT chung, vẫn chặn stuffing)

_fails: dict[str, deque] = defaultdict(deque)


def _client_ip(request: Request) -> str:
    """IP client thật — Render đứng sau proxy nên đọc X-Forwarded-For trước."""
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _prune(key: str) -> None:
    now = time.time()
    dq = _fails[key]
    while dq and now - dq[0] > _WINDOW:
        dq.popleft()
    if not dq:
        _fails.pop(key, None)


def check_login_allowed(request: Request, email: str | None) -> None:
    """Gọi TRƯỚC khi kiểm mật khẩu. 429 nếu đã quá ngưỡng lần sai gần đây."""
    ip = _client_ip(request)
    _prune(f"ip:{ip}")
    if len(_fails.get(f"ip:{ip}", ())) >= _MAX_PER_IP:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Quá nhiều lần đăng nhập sai từ mạng này. Vui lòng đợi ít phút rồi thử lại.",
        )
    if email:
        k = f"em:{email.strip().lower()}"
        _prune(k)
        if len(_fails.get(k, ())) >= _MAX_PER_EMAIL:
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                "Tài khoản tạm khóa do nhập sai nhiều lần. Vui lòng thử lại sau ~15 phút.",
            )


def record_login_failure(request: Request, email: str | None) -> None:
    """Gọi khi đăng nhập SAI (sai mật khẩu / không có tài khoản)."""
    now = time.time()
    _fails[f"ip:{_client_ip(request)}"].append(now)
    if email:
        _fails[f"em:{email.strip().lower()}"].append(now)


def clear_login_failures(email: str | None) -> None:
    """Gọi khi đăng nhập ĐÚNG -> xóa lịch sử sai của tài khoản đó."""
    if email:
        _fails.pop(f"em:{email.strip().lower()}", None)
