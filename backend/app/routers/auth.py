"""Router xác thực: đăng nhập (mật khẩu & Google), cấp JWT và quản lý nhân sự."""
import secrets

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import distinct
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import get_current_user, require_roles
from app.ratelimit import check_login_allowed, record_login_failure, clear_login_failures
from app.models import User, UserRole, Company
from app.schemas import Token, UserOut, UserUpdate, UserCreate, GoogleLoginRequest, ChangePassword, AdminResetPassword
from app.security import create_access_token, verify_password, hash_password

router = APIRouter(prefix="/auth", tags=["Xác thực"])

GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo"


def _issue_token(user: User) -> str:
    """Cấp JWT kèm token_version (tv) hiện tại -> đổi/reset mật khẩu vô hiệu token cũ."""
    return create_access_token(
        subject=user.id,
        extra={"company_id": user.company_id, "role": user.role.value, "tv": user.token_version or 0},
    )


def _verify_google_credential(credential: str) -> dict:
    """Xác minh ID token của Google, trả về {email, name}. Ném HTTPException nếu sai."""
    if not settings.GOOGLE_CLIENT_ID:
        raise HTTPException(503, "Đăng nhập Google chưa được cấu hình (thiếu GOOGLE_CLIENT_ID).")
    try:
        resp = httpx.get(GOOGLE_TOKENINFO_URL, params={"id_token": credential}, timeout=10)
    except httpx.HTTPError:
        raise HTTPException(502, "Không kết nối được tới Google để xác minh.")
    if resp.status_code != 200:
        raise HTTPException(401, "Token Google không hợp lệ hoặc đã hết hạn.")
    data = resp.json()
    if data.get("aud") != settings.GOOGLE_CLIENT_ID:
        raise HTTPException(401, "Token Google không dành cho ứng dụng này.")
    if str(data.get("email_verified", "")).lower() != "true":
        raise HTTPException(401, "Email Google chưa được xác minh.")
    email = (data.get("email") or "").lower()
    if not email:
        raise HTTPException(401, "Không lấy được email từ tài khoản Google.")
    return {"email": email, "name": data.get("name") or email}


def provision_google_user(db: Session, email: str, name: str) -> User:
    """
    Tìm nhân viên theo email Google; nếu chưa có thì tự tạo tài khoản CHỜ DUYỆT
    (is_approved=False) — Giám đốc/Quản trị web phải duyệt & phân vị trí trước khi vào được.
    """
    user = db.query(User).filter(User.email == email).first()
    if user:
        return user
    if not settings.GOOGLE_AUTO_CREATE:
        raise HTTPException(403, "Email này chưa được cấp quyền truy cập hệ thống.")
    company = db.get(Company, settings.GOOGLE_DEFAULT_COMPANY_ID) or (
        db.query(Company).order_by(Company.id).first()
    )
    if not company:
        raise HTTPException(500, "Hệ thống chưa có công ty nào để gán tài khoản.")
    try:
        role = UserRole(settings.GOOGLE_DEFAULT_ROLE)
    except ValueError:
        role = UserRole.FIELD_STAFF
    user = User(
        company_id=company.id,
        email=email,
        full_name=name,
        # Mật khẩu ngẫu nhiên không ai biết -> tài khoản này chỉ đăng nhập bằng Google.
        hashed_password=hash_password(secrets.token_urlsafe(32)),
        role=role,
        is_approved=False,   # CHỜ DUYỆT: chưa vào được tới khi Giám đốc/Quản trị duyệt & phân vị trí
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.post("/login", response_model=Token)
def login(
    request: Request,
    form: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    """
    Đăng nhập bằng email + mật khẩu (OAuth2 password flow).
    Trường 'username' của form chính là email người dùng.
    """
    # Email không phân biệt hoa/thường: chuẩn hóa về chữ thường trước khi tra cứu.
    email = form.username.strip().lower()
    # Chống dò mật khẩu: chặn tạm nếu đã sai quá nhiều lần gần đây (theo tài khoản + IP).
    check_login_allowed(request, email)
    user = db.query(User).filter(User.email == email).first()
    if not user or not verify_password(form.password, user.hashed_password):
        record_login_failure(request, email)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email hoặc mật khẩu không đúng.",
        )
    clear_login_failures(email)
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Tài khoản đã bị khóa.")
    if not user.is_approved:
        raise HTTPException(status_code=403, detail="Tài khoản đang chờ duyệt.")

    return Token(access_token=_issue_token(user))


@router.post("/google", response_model=Token)
def login_google(request: Request, payload: GoogleLoginRequest, db: Session = Depends(get_db)):
    """Đăng nhập bằng tài khoản Google: xác minh token, tìm/tạo nhân viên, cấp JWT."""
    # Giới hạn tần suất theo IP để chống spam/dò token.
    check_login_allowed(request, None)
    try:
        info = _verify_google_credential(payload.credential)
    except HTTPException:
        record_login_failure(request, None)
        raise
    user = provision_google_user(db, info["email"], info["name"])
    if not user.is_active:
        raise HTTPException(403, "Tài khoản đã bị khóa.")
    if not user.is_approved:
        raise HTTPException(
            403,
            "Tài khoản của bạn đã được ghi nhận, đang chờ Giám đốc/Quản trị duyệt và "
            "phân vị trí. Vui lòng đăng nhập lại sau khi được duyệt.",
        )
    return Token(access_token=_issue_token(user))


@router.get("/me", response_model=UserOut)
def read_me(
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Trả về thông tin tài khoản đang đăng nhập (để frontend hiển thị)."""
    # 1 query (LIMIT 1 nhờ .first()): người này có đang là quản lý trực tiếp của ai không.
    current.has_subordinates = db.query(User.id).filter(
        User.manager_id == current.id, User.company_id == current.company_id
    ).first() is not None
    return current


@router.post("/change-password", response_model=Token)
def change_password(
    payload: ChangePassword,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Người dùng tự đổi mật khẩu của mình (cần nhập mật khẩu hiện tại).
    Vô hiệu token cũ ở MỌI thiết bị khác; trả token mới cho thiết bị hiện tại."""
    if not verify_password(payload.old_password, current.hashed_password):
        raise HTTPException(status_code=400, detail="Mật khẩu hiện tại không đúng.")
    current.hashed_password = hash_password(payload.new_password)
    current.token_version = (current.token_version or 0) + 1
    db.commit()
    db.refresh(current)
    return Token(access_token=_issue_token(current))


@router.post("/logout-all", response_model=Token)
def logout_all_devices(
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Đăng xuất khỏi MỌI thiết bị (vô hiệu mọi token cũ); giữ phiên hiện tại bằng token mới."""
    current.token_version = (current.token_version or 0) + 1
    db.commit()
    db.refresh(current)
    return Token(access_token=_issue_token(current))


@router.get("/users", response_model=list[UserOut])
def list_users(
    db: Session = Depends(get_db),
    current: User = Depends(require_roles(UserRole.ADMIN, UserRole.DIRECTOR, UserRole.MANAGER, UserRole.ACCOUNTANT)),
):
    """Liệt kê toàn bộ nhân sự cùng công ty."""
    users = db.query(User).filter(User.company_id == current.company_id).all()
    # 1 query gộp: tập các manager_id đang được tham chiếu trong công ty (không N+1).
    manager_ids = {
        mid for (mid,) in db.query(distinct(User.manager_id))
        .filter(User.company_id == current.company_id, User.manager_id.isnot(None))
        .all()
    }
    for u in users:
        u.has_subordinates = u.id in manager_ids   # gán runtime attr, Pydantic đọc được
    return users


@router.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    # CHỈ Giám đốc & Quản trị web (ADMIN luôn được phép) mới được cấp quyền truy cập.
    current: User = Depends(require_roles(UserRole.DIRECTOR)),
):
    """Cấp quyền truy cập web cho một người (tạo tài khoản trong cùng công ty)."""
    email = payload.email.lower()
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(400, "Email này đã được sử dụng.")

    # Người quản lý (nếu có) phải thuộc cùng công ty
    if payload.manager_id is not None:
        mgr = db.get(User, payload.manager_id)
        if not mgr or mgr.company_id != current.company_id:
            raise HTTPException(400, "Người quản lý không hợp lệ.")

    data = payload.model_dump(exclude={"password", "email"})
    # Bỏ trống mật khẩu = tài khoản chỉ đăng nhập bằng Google -> sinh mật khẩu ngẫu nhiên.
    raw_pw = payload.password or secrets.token_urlsafe(32)
    user = User(
        **data,
        email=email,
        company_id=current.company_id,
        hashed_password=hash_password(raw_pw),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    # CHỈ Giám đốc & Quản trị web (ADMIN) mới được đổi vai trò / khóa-mở truy cập.
    current: User = Depends(require_roles(UserRole.DIRECTOR)),
):
    """Cập nhật vai trò, trạng thái truy cập, hồ sơ, lịch làm việc của nhân viên."""
    user = db.get(User, user_id)
    if not user or user.company_id != current.company_id:
        raise HTTPException(404, "Không tìm thấy nhân viên.")

    # Chỉ ADMIN (quản trị hệ thống) mới được cấp quyền ADMIN cho người khác.
    # Chặn Giám đốc (DIRECTOR) tự tạo thêm ADMIN -> leo thang quyền tối đa.
    if payload.role == UserRole.ADMIN and current.role != UserRole.ADMIN:
        raise HTTPException(403, "Chỉ Quản trị hệ thống (ADMIN) mới được cấp quyền ADMIN.")

    # Không cho phép tự phân cấp làm quản lý của chính mình
    if payload.manager_id == user.id:
        raise HTTPException(400, "Không thể gán nhân viên tự quản lý chính mình.")

    # Chống tự khóa / tự hạ quyền chính mình -> tránh mất quyền quản trị.
    if user.id == current.id:
        if payload.is_active is False:
            raise HTTPException(400, "Không thể tự khóa tài khoản của chính mình.")
        if payload.role is not None and payload.role not in (UserRole.ADMIN, UserRole.DIRECTOR):
            raise HTTPException(400, "Không thể tự hạ quyền quản trị của chính mình.")

    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(user, k, v)

    db.commit()
    db.refresh(user)
    return user


@router.post("/users/{user_id}/reset-password", status_code=204)
def admin_reset_password(
    user_id: int,
    payload: AdminResetPassword,
    db: Session = Depends(get_db),
    # CHỈ Giám đốc & Quản trị web (ADMIN) mới được đặt lại mật khẩu cho người khác.
    current: User = Depends(require_roles(UserRole.DIRECTOR)),
):
    """Đặt lại mật khẩu cho nhân viên (admin cấp lại khi nhân viên quên), không cần mật khẩu cũ."""
    user = db.get(User, user_id)
    if not user or user.company_id != current.company_id:
        raise HTTPException(404, "Không tìm thấy nhân viên.")
    # Chống LEO THANG qua đường vòng reset-password: DIRECTOR không được đặt lại mật khẩu
    # của ADMIN hay của DIRECTOR khác (nếu không sẽ tự đặt mật khẩu rồi chiếm tài khoản
    # quản trị). Chỉ ADMIN mới reset ngang/trên cấp; ai cũng có thể reset của chính mình.
    if (
        current.role != UserRole.ADMIN
        and user.id != current.id
        and user.role in (UserRole.ADMIN, UserRole.DIRECTOR)
    ):
        raise HTTPException(
            403, "Chỉ Quản trị hệ thống mới được đặt lại mật khẩu của tài khoản quản trị/giám đốc khác."
        )
    user.hashed_password = hash_password(payload.new_password)
    # Đặt lại mật khẩu -> vô hiệu MỌI token cũ của người bị reset (buộc đăng nhập lại).
    user.token_version = (user.token_version or 0) + 1
    db.commit()

