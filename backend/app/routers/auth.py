"""Router xác thực: đăng nhập (mật khẩu & Google), cấp JWT và quản lý nhân sự."""
import secrets

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import get_current_user, require_roles
from app.models import User, UserRole, Company
from app.schemas import Token, UserOut, UserUpdate, UserCreate, GoogleLoginRequest, ChangePassword
from app.security import create_access_token, verify_password, hash_password

router = APIRouter(prefix="/auth", tags=["Xác thực"])

GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo"


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
    form: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    """
    Đăng nhập bằng email + mật khẩu (OAuth2 password flow).
    Trường 'username' của form chính là email người dùng.
    """
    user = db.query(User).filter(User.email == form.username).first()
    if not user or not verify_password(form.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email hoặc mật khẩu không đúng.",
        )
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Tài khoản đã bị khóa.")
    if not user.is_approved:
        raise HTTPException(status_code=403, detail="Tài khoản đang chờ duyệt.")

    token = create_access_token(
        subject=user.id,
        extra={"company_id": user.company_id, "role": user.role.value},
    )
    return Token(access_token=token)


@router.post("/google", response_model=Token)
def login_google(payload: GoogleLoginRequest, db: Session = Depends(get_db)):
    """Đăng nhập bằng tài khoản Google: xác minh token, tìm/tạo nhân viên, cấp JWT."""
    info = _verify_google_credential(payload.credential)
    user = provision_google_user(db, info["email"], info["name"])
    if not user.is_active:
        raise HTTPException(403, "Tài khoản đã bị khóa.")
    if not user.is_approved:
        raise HTTPException(
            403,
            "Tài khoản của bạn đã được ghi nhận, đang chờ Giám đốc/Quản trị duyệt và "
            "phân vị trí. Vui lòng đăng nhập lại sau khi được duyệt.",
        )
    token = create_access_token(
        subject=user.id,
        extra={"company_id": user.company_id, "role": user.role.value},
    )
    return Token(access_token=token)


@router.get("/me", response_model=UserOut)
def read_me(current: User = Depends(get_current_user)):
    """Trả về thông tin tài khoản đang đăng nhập (để frontend hiển thị)."""
    return current


@router.post("/change-password", status_code=204)
def change_password(
    payload: ChangePassword,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Người dùng tự đổi mật khẩu của mình (cần nhập mật khẩu hiện tại)."""
    if not verify_password(payload.old_password, current.hashed_password):
        raise HTTPException(status_code=400, detail="Mật khẩu hiện tại không đúng.")
    current.hashed_password = hash_password(payload.new_password)
    db.commit()


@router.get("/users", response_model=list[UserOut])
def list_users(
    db: Session = Depends(get_db),
    current: User = Depends(require_roles(UserRole.ADMIN, UserRole.DIRECTOR, UserRole.MANAGER, UserRole.ACCOUNTANT)),
):
    """Liệt kê toàn bộ nhân sự cùng công ty."""
    return db.query(User).filter(User.company_id == current.company_id).all()


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

