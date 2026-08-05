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
from app.schemas import (
    Token, UserOut, UserUpdate, UserCreate, UserDepartmentChange,
    GoogleLoginRequest, ChangePassword, AdminResetPassword,
)
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
    m_ids = data.get("manager_ids")
    if m_ids:
        parts = [p.strip() for p in m_ids.split(",") if p.strip().isdigit()]
        if parts:
            data["manager_id"] = int(parts[0])
    elif data.get("manager_id"):
        data["manager_ids"] = str(data["manager_id"])

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
    return _with_has_sub(db, user, current.company_id)


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

    if payload.email is not None:
        email = payload.email.lower()
        if user.email != email and db.query(User).filter(User.email == email).first():
            raise HTTPException(400, "Email này đã được sử dụng.")
        user.email = email

    update_data = payload.model_dump(exclude_unset=True, exclude={"email"})
    if "manager_ids" in update_data:
        m_ids = update_data["manager_ids"]
        if m_ids:
            parts = [p.strip() for p in m_ids.split(",") if p.strip().isdigit()]
            if parts:
                update_data["manager_id"] = int(parts[0])
            else:
                update_data["manager_id"] = None
        else:
            update_data["manager_id"] = None
    elif "manager_id" in update_data:
        if update_data["manager_id"] is not None:
            update_data["manager_ids"] = str(update_data["manager_id"])
        else:
            update_data["manager_ids"] = None

    for k, v in update_data.items():
        setattr(user, k, v)

    db.commit()
    db.refresh(user)
    # Tính has_subordinates (runtime attr) để frontend nhận đúng cấp bậc ngay sau khi lưu.
    return _with_has_sub(db, user, current.company_id)


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


def _dept_list(s: str | None) -> list[str]:
    return [d.strip() for d in (s or "").split(",") if d.strip()]


def _guard_dept_scope(current: User, dept: str) -> None:
    """ADMIN/Giám đốc quản lý phòng bất kỳ; Quản lý chỉ được thao tác phòng CỦA MÌNH."""
    if current.role in (UserRole.ADMIN, UserRole.DIRECTOR):
        return
    if dept not in _dept_list(current.department):
        raise HTTPException(403, "Bạn chỉ được thêm/bớt người trong phòng của chính mình.")


def _with_has_sub(db: Session, u: User, company_id: int) -> User:
    u.has_subordinates = (
        db.query(User.id)
        .filter(User.manager_id == u.id, User.company_id == company_id)
        .first()
        is not None
    )
    return u


@router.post("/users/{user_id}/departments", response_model=UserOut)
def add_user_to_department(
    user_id: int,
    payload: UserDepartmentChange,
    db: Session = Depends(get_db),
    # Quản lý & Giám đốc (ADMIN luôn được phép) — kéo người VÀO phòng.
    current: User = Depends(require_roles(UserRole.MANAGER, UserRole.DIRECTOR)),
):
    """Kéo 1 người VÀO một phòng ban — CỘNG THÊM (giữ nguyên các phòng cũ)."""
    target = db.get(User, user_id)
    if not target or target.company_id != current.company_id:
        raise HTTPException(404, "Không tìm thấy nhân viên.")
    dept = payload.department.strip()
    if not dept:
        raise HTTPException(400, "Thiếu tên phòng ban.")
    _guard_dept_scope(current, dept)
    parts = _dept_list(target.department)
    if dept not in parts:
        parts.append(dept)
        target.department = ", ".join(parts)
        db.commit()
        db.refresh(target)
    return _with_has_sub(db, target, current.company_id)


@router.delete("/users/{user_id}/departments", response_model=UserOut)
def remove_user_from_department(
    user_id: int,
    department: str,
    db: Session = Depends(get_db),
    current: User = Depends(require_roles(UserRole.MANAGER, UserRole.DIRECTOR)),
):
    """Đá 1 người RA khỏi một phòng ban. Còn phòng khác thì giữ lại; hết phòng -> để trống."""
    target = db.get(User, user_id)
    if not target or target.company_id != current.company_id:
        raise HTTPException(404, "Không tìm thấy nhân viên.")
    dept = department.strip()
    _guard_dept_scope(current, dept)
    parts = [d for d in _dept_list(target.department) if d != dept]
    target.department = ", ".join(parts) if parts else None
    db.commit()
    db.refresh(target)
    return _with_has_sub(db, target, current.company_id)


def _purge_user_references(db: Session, uid: int) -> None:
    """Dọn MỌI tham chiếu tới user #uid trước khi xóa hẳn:
      - cột khóa ngoại CHO PHÉP NULL  -> đặt NULL (gỡ liên kết: manager_id / lead_id /
        assignee_id... của NGƯỜI/DỰ ÁN khác vẫn giữ nguyên, chỉ bỏ trỏ tới người bị xóa);
      - cột khóa ngoại NOT NULL       -> xóa dòng (dữ liệu CÁ NHÂN của người này: chấm
        công, phiếu đánh giá, lương, thành viên dự án, tin nhắn...).
    Lặp lại (retry) để thỏa mãn thứ tự khóa ngoại. Cuối cùng loại id khỏi các chuỗi
    manager_ids (nhiều quản lý) của người khác."""
    from app.models import Base

    users_id = User.__table__.c.id
    refs = [
        (table, col)
        for table in Base.metadata.sorted_tables
        for col in table.columns
        if col is not users_id and any(fk.column is users_id for fk in col.foreign_keys)
    ]
    pending, guard = refs, 0
    while pending:
        guard += 1
        if guard > len(refs) + 5:
            raise HTTPException(409, "Không thể xóa: dữ liệu liên quan ràng buộc phức tạp.")
        still, progressed = [], False
        for table, col in pending:
            sp = db.begin_nested()
            try:
                if col.nullable:
                    db.execute(table.update().where(col == uid).values({col.name: None}))
                else:
                    db.execute(table.delete().where(col == uid))
                sp.commit()
                progressed = True
            except Exception:  # noqa: BLE001 — vướng FK thì thử lại vòng sau
                sp.rollback()
                still.append((table, col))
        if not progressed:
            raise HTTPException(409, "Không thể xóa: còn dữ liệu ràng buộc.")
        pending = still

    for u in db.query(User).filter(User.manager_ids.isnot(None)).all():
        parts = [x for x in str(u.manager_ids).split(",") if x.strip() and x.strip() != str(uid)]
        new = ",".join(parts) if parts else None
        if new != u.manager_ids:
            u.manager_ids = new


@router.delete("/users/{user_id}", status_code=204)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    # Giám đốc & Quản trị (ADMIN luôn được phép qua require_roles) mới được XÓA tài khoản.
    current: User = Depends(require_roles(UserRole.DIRECTOR)),
):
    """XÓA HẲN một tài khoản + dữ liệu cá nhân của họ. Chặn: tự xóa mình; DIRECTOR xóa
    tài khoản quản trị/giám đốc (chỉ ADMIN được); xóa ADMIN cuối cùng của công ty."""
    target = db.get(User, user_id)
    if not target or target.company_id != current.company_id:
        raise HTTPException(404, "Không tìm thấy nhân viên.")
    if target.id == current.id:
        raise HTTPException(400, "Không thể tự xóa tài khoản của chính mình.")
    if target.role in (UserRole.ADMIN, UserRole.DIRECTOR) and current.role != UserRole.ADMIN:
        raise HTTPException(403, "Chỉ Quản trị hệ thống (ADMIN) mới được xóa tài khoản quản trị/giám đốc.")
    if target.role == UserRole.ADMIN:
        n_admin = db.query(User).filter(
            User.company_id == current.company_id, User.role == UserRole.ADMIN
        ).count()
        if n_admin <= 1:
            raise HTTPException(400, "Không thể xóa tài khoản Quản trị hệ thống cuối cùng.")

    _purge_user_references(db, target.id)
    db.delete(target)
    db.commit()

