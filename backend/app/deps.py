"""
Các dependency dùng chung cho route:
- get_current_user : giải mã JWT, trả về User đang đăng nhập.
- require_roles    : chặn truy cập nếu sai vai trò.

Mọi truy vấn nghiệp vụ phải lọc theo current_user.company_id để bảo đảm
nguyên tắc đa người dùng: công ty A không thấy dữ liệu công ty B.
"""
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import User, UserRole
from app.security import decode_access_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.API_V1_PREFIX}/auth/login")

_CRED_ERROR = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Phiên đăng nhập không hợp lệ hoặc đã hết hạn.",
    headers={"WWW-Authenticate": "Bearer"},
)


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    """Lấy người dùng hiện tại từ token Bearer."""
    payload = decode_access_token(token)
    if not payload:
        raise _CRED_ERROR
    user_id = payload.get("sub")
    if user_id is None:
        raise _CRED_ERROR
    user = db.get(User, int(user_id))
    if user is None or not user.is_active or not user.is_approved:
        raise _CRED_ERROR
    # Token bị thu hồi khi đổi/đặt-lại mật khẩu hoặc đăng-xuất-mọi-thiết-bị:
    # tv trong token phải khớp token_version hiện tại. Token cũ (không có tv) -> 0.
    if int(payload.get("tv", 0)) != int(user.token_version or 0):
        raise _CRED_ERROR
    return user


# "Quản lý cấp cao" chốt cứng theo email — để chắc chắn đúng người kể cả khi dữ
# liệu sơ đồ tổ chức chưa chuẩn.
SENIOR_MANAGER_EMAILS = {"dhson@dosco.vn", "hklam@dosco.vn", "ncbinh@dosco.vn"}

# Đúng 3 vai trò lãnh đạo cao nhất: Quản trị hệ thống, Giám đốc, Quản lý cấp cao.
_TOP_LEADERSHIP_ROLES = (UserRole.ADMIN, UserRole.DIRECTOR, UserRole.MANAGER)


def is_top_leadership(user: User) -> bool:
    """True với Quản trị hệ thống / Giám đốc / Quản lý cấp cao.

    Xét THẲNG theo VAI TRÒ được phân, cố ý KHÔNG dùng _is_senior_manager của
    projects.py: hàm đó suy "cấp cao" ra từ sơ đồ tổ chức (có cấp dưới + không
    có ai quản lý bên trên) nên một Quản lý cấp trung — thậm chí một nhân viên —
    đang quản người khác sẽ lọt vào. Dùng cho những việc KHÔNG LÙI ĐƯỢC: sửa giờ
    của người khác (routers/timesheets.py) và xóa vĩnh viễn khỏi thùng rác
    (routers/archive.py).
    """
    if user.role in _TOP_LEADERSHIP_ROLES:
        return True
    return (user.email or "").strip().lower() in SENIOR_MANAGER_EMAILS


def can_see_money(user: User) -> bool:
    """
    True nếu người dùng được xem TIỀN của dự án (giá trị hợp đồng, chi phí,
    thanh toán/công nợ, khối lượng – đơn giá – thành tiền hạng mục, lãi/lỗ).

    Theo yêu cầu chủ doanh nghiệp: CHỈ GIÁM ĐỐC (ADMIN + DIRECTOR) thấy tiền.
    Quản lý cấp cao/cấp trung và nhân viên đều KHÔNG thấy. Khớp đúng
    canSeeMoney (= isDirector) ở frontend.

    Ngoại lệ: hóa đơn chi phí đầu vào (Hóa đơn AI) vẫn cho Quản lý
    chụp + duyệt — xem router invoices.py (không dùng hàm này).
    """
    return user.role in (UserRole.ADMIN, UserRole.DIRECTOR)


def is_staff_tier(user: User) -> bool:
    """
    True nếu người dùng ở TẦNG NHÂN VIÊN (STAFF).

    Dùng whitelist ADMIN/DIRECTOR/MANAGER cho các nghiệp vụ này.
    Vai trò mới thêm sau này mặc định bị coi là
    STAFF — an toàn hơn blacklist. (Việc ẩn TIỀN nay dùng can_see_money.)
    """
    return user.role not in (
        UserRole.ADMIN,
        UserRole.DIRECTOR,
        UserRole.MANAGER,
    )


def require_roles(*roles: UserRole):
    """
    Factory tạo dependency chặn theo vai trò.
    Dùng: Depends(require_roles(UserRole.DIRECTOR))
    """
    def checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles and user.role != UserRole.ADMIN:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Bạn không có quyền thực hiện thao tác này.",
            )
        return user
    return checker
