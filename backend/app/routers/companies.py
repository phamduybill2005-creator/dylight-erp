"""Router công ty/chi nhánh — phục vụ dropdown 'Chọn công ty' trên header."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import Company, User
from app.schemas import CompanyOut

router = APIRouter(prefix="/companies", tags=["Công ty"])


@router.get("", response_model=list[CompanyOut])
def list_companies(
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """
    Liệt kê các công ty đang hoạt động.
    (MVP: trả tất cả công ty active; mở rộng sau theo phạm vi mà user
    được phép truy cập — vd quan hệ user_companies nhiều-nhiều.)
    """
    return db.query(Company).filter(Company.is_active.is_(True)).all()
