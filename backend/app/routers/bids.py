"""Router Quản lý Đấu thầu (Bids) — CRUD cơ bản, lọc theo công ty.

Phân quyền TIỀN: chỉ GIÁM ĐỐC thấy/đặt `package_value` (giá gói thầu).
Quản lý/Kế toán vẫn theo dõi + soạn hồ sơ thầu (tên, chủ đầu tư, trạng thái,
ngày nộp) nhưng KHÔNG thấy con số giá gói thầu, và KHÔNG đặt được nó.
Nhân viên (STAFF) không truy cập module đấu thầu.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_roles, can_see_money
from app.models import Bid, User, UserRole
from app.schemas import BidCreate, BidOut, BidUpdate

router = APIRouter(prefix="/bids", tags=["Đấu thầu"])

# Đấu thầu là module Quản lý trở lên (không dành cho nhân viên).
_GUARD = require_roles(UserRole.MANAGER, UserRole.ACCOUNTANT, UserRole.DIRECTOR)


def _out(bid: Bid, current: User) -> BidOut:
    """Ẩn giá gói thầu (package_value) nếu người xem không được thấy tiền."""
    out = BidOut.model_validate(bid)
    if not can_see_money(current):
        out = out.model_copy(update={"package_value": None})
    return out


@router.get("", response_model=list[BidOut])
def list_bids(db: Session = Depends(get_db), current: User = Depends(_GUARD)):
    rows = (
        db.query(Bid)
        .filter(Bid.company_id == current.company_id)
        .order_by(Bid.created_at.desc())
        .all()
    )
    return [_out(b, current) for b in rows]


@router.post("", response_model=BidOut, status_code=201)
def create_bid(
    payload: BidCreate,
    db: Session = Depends(get_db),
    current: User = Depends(_GUARD),
):
    data = payload.model_dump()
    # Chỉ Giám đốc được đặt giá gói thầu; người khác tạo hồ sơ thầu với giá = 0 (Giám đốc điền sau).
    if not can_see_money(current):
        data["package_value"] = 0
    bid = Bid(**data, company_id=current.company_id)
    db.add(bid)
    db.commit()
    db.refresh(bid)
    return _out(bid, current)


@router.get("/{bid_id}", response_model=BidOut)
def get_bid(bid_id: int, db: Session = Depends(get_db), current: User = Depends(_GUARD)):
    bid = db.get(Bid, bid_id)
    if not bid or bid.company_id != current.company_id:
        raise HTTPException(404, "Không tìm thấy gói thầu.")
    return _out(bid, current)


@router.patch("/{bid_id}", response_model=BidOut)
def update_bid(
    bid_id: int,
    payload: BidUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(_GUARD),
):
    bid = db.get(Bid, bid_id)
    if not bid or bid.company_id != current.company_id:
        raise HTTPException(404, "Không tìm thấy gói thầu.")
    data = payload.model_dump(exclude_unset=True)
    # Không được thấy tiền thì cũng không được sửa giá gói thầu (bỏ qua field này).
    if not can_see_money(current):
        data.pop("package_value", None)
    for k, v in data.items():
        setattr(bid, k, v)
    db.commit()
    db.refresh(bid)
    return _out(bid, current)
