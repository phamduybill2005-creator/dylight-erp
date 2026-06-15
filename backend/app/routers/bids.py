"""Router Quản lý Đấu thầu (Bids) — CRUD cơ bản, lọc theo công ty."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import Bid, User
from app.schemas import BidCreate, BidOut, BidUpdate

router = APIRouter(prefix="/bids", tags=["Đấu thầu"])


@router.get("", response_model=list[BidOut])
def list_bids(db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    return (
        db.query(Bid)
        .filter(Bid.company_id == current.company_id)
        .order_by(Bid.created_at.desc())
        .all()
    )


@router.post("", response_model=BidOut, status_code=201)
def create_bid(
    payload: BidCreate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    bid = Bid(**payload.model_dump(), company_id=current.company_id)
    db.add(bid)
    db.commit()
    db.refresh(bid)
    return bid


@router.get("/{bid_id}", response_model=BidOut)
def get_bid(bid_id: int, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    bid = db.get(Bid, bid_id)
    if not bid or bid.company_id != current.company_id:
        raise HTTPException(404, "Không tìm thấy gói thầu.")
    return bid


@router.patch("/{bid_id}", response_model=BidOut)
def update_bid(
    bid_id: int,
    payload: BidUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    bid = db.get(Bid, bid_id)
    if not bid or bid.company_id != current.company_id:
        raise HTTPException(404, "Không tìm thấy gói thầu.")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(bid, k, v)
    db.commit()
    db.refresh(bid)
    return bid
