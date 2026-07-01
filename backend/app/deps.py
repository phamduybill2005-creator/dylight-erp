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
    return user


def can_see_money(user: User) -> bool:
    """
    True nếu người dùng được xem TIỀN của dự án (giá trị hợp đồng, chi phí,
    thanh toán/công nợ, khối lượng – đơn giá – thành tiền hạng mục, lãi/lỗ).

    Theo yêu cầu chủ doanh nghiệp: CHỈ GIÁM ĐỐC (ADMIN + DIRECTOR) thấy tiền.
    Quản lý cấp cao/cấp trung và nhân viên đều KHÔNG thấy. Khớp đúng
    canSeeMoney (= isDirector) ở frontend.

    Ngoại lệ: hóa đơn chi phí đầu vào (Hóa đơn AI) vẫn cho Quản lý/Kế toán
    chụp + duyệt — xem router invoices.py (không dùng hàm này).
    """
    return user.role in (UserRole.ADMIN, UserRole.DIRECTOR)


def is_staff_tier(user: User) -> bool:
    """
    True nếu người dùng ở TẦNG NHÂN VIÊN (STAFF).

    Dùng whitelist 4 vai trò quản-lý-trở-lên (ADMIN/DIRECTOR/MANAGER/ACCOUNTANT),
    khớp đúng roleTier ở frontend. Vai trò mới thêm sau này mặc định bị coi là
    STAFF — an toàn hơn blacklist. (Việc ẩn TIỀN nay dùng can_see_money.)
    """
    return user.role not in (
        UserRole.ADMIN,
        UserRole.DIRECTOR,
        UserRole.MANAGER,
        UserRole.ACCOUNTANT,
    )


def require_roles(*roles: UserRole):
    """
    Factory tạo dependency chặn theo vai trò.
    Dùng: Depends(require_roles(UserRole.ACCOUNTANT, UserRole.DIRECTOR))
    """
    def checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles and user.role != UserRole.ADMIN:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Bạn không có quyền thực hiện thao tác này.",
            )
        return user
    return checker
