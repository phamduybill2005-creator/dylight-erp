"""
Router Đánh giá ĐỒNG NGHIỆP (tab "Đánh giá" — mọi người trừ Giám đốc).

Mỗi tháng, một người chấm đồng nghiệp bằng 2 phiếu, mỗi phiếu 3 tiêu chí điểm 1–5:
  - QUALITY "Chất lượng công việc": sản phẩm đúng, ít lỗi / nộp bài đúng hẹn / phối hợp với mọi người.
  - TEAM    "Hòa đồng, tập thể"   : hòa đồng, thân thiện / tham gia hoạt động tập thể / tiếp thu góp ý.
1 phiếu = (người chấm, người được chấm, tháng, loại); gửi lại trong tháng là sửa phiếu đó.
RIÊNG TƯ: mỗi người chỉ xem được phiếu MÌNH đã chấm (/mine). Giám đốc / Quản trị xem
TỔNG HỢP (điểm trung bình, số phiếu) theo người/tháng ở /summary — không xem ai chấm ai.
Không ai chấm Giám đốc; Giám đốc không chấm (tab này không hiện với Giám đốc).
"""
import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db, vn_now
from app.deps import get_current_user, require_roles
from app.models import PeerReview, User, UserRole
from app.schemas import PeerReviewIn, PeerReviewOut, PeerReviewSummaryRow

router = APIRouter(prefix="/peer-reviews", tags=["Đánh giá đồng nghiệp"])

_MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def _check_month(month: str) -> str:
    if not _MONTH_RE.match(month or ""):
        raise HTTPException(400, "Tháng không hợp lệ, cần dạng YYYY-MM.")
    return month


def _out(rec: PeerReview) -> PeerReviewOut:
    return PeerReviewOut(
        id=rec.id, evaluatee_id=rec.evaluatee_id, evaluatee_name=rec.evaluatee_name,
        month=rec.month, kind=rec.kind, scores=[rec.score_1, rec.score_2, rec.score_3],
        updated_at=rec.updated_at,
    )


@router.get("/mine", response_model=list[PeerReviewOut])
def my_peer_reviews(
    month: str,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Phiếu MÌNH đã chấm trong tháng (cả 2 loại) — để điền sẵn khi mở lại và biết đã chấm ai."""
    _check_month(month)
    rows = (
        db.query(PeerReview)
        .filter(PeerReview.evaluator_id == current.id, PeerReview.month == month)
        .order_by(PeerReview.updated_at.desc())
        .all()
    )
    return [_out(r) for r in rows]


@router.put("", response_model=PeerReviewOut)
def save_peer_review(
    payload: PeerReviewIn,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Gửi / sửa 1 phiếu (người được chấm, tháng, loại). Ghi đè phiếu cũ cùng khóa nếu có."""
    if current.role == UserRole.DIRECTOR:
        raise HTTPException(403, "Giám đốc không tham gia chấm đánh giá đồng nghiệp.")
    month = _check_month(payload.month)
    if month > vn_now().strftime("%Y-%m"):
        raise HTTPException(400, "Chưa thể đánh giá cho tháng tương lai.")
    evaluatee = db.get(User, payload.evaluatee_id)
    if not evaluatee or evaluatee.company_id != current.company_id or not evaluatee.is_active:
        raise HTTPException(404, "Không tìm thấy đồng nghiệp trong công ty.")
    if evaluatee.id == current.id:
        raise HTTPException(400, "Không thể tự đánh giá chính mình.")
    if evaluatee.role == UserRole.DIRECTOR:
        raise HTTPException(403, "Không ai được đánh giá Giám đốc.")

    rec = (
        db.query(PeerReview)
        .filter(
            PeerReview.evaluator_id == current.id,
            PeerReview.evaluatee_id == evaluatee.id,
            PeerReview.month == month,
            PeerReview.kind == payload.kind,
        )
        .first()
    )
    if rec is None:
        rec = PeerReview(
            company_id=current.company_id, evaluator_id=current.id,
            evaluatee_id=evaluatee.id, month=month, kind=payload.kind,
        )
        db.add(rec)
    rec.score_1, rec.score_2, rec.score_3 = payload.scores
    rec.updated_at = vn_now()
    db.commit()
    db.refresh(rec)
    return _out(rec)


@router.delete("/{review_id}", status_code=204)
def delete_my_peer_review(
    review_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Rút lại 1 phiếu MÌNH đã chấm."""
    rec = db.get(PeerReview, review_id)
    if not rec or rec.evaluator_id != current.id:
        raise HTTPException(404, "Không tìm thấy phiếu.")
    db.delete(rec)
    db.commit()


@router.get("/summary", response_model=list[PeerReviewSummaryRow])
def peer_review_summary(
    from_month: str,
    to_month: str,
    db: Session = Depends(get_db),
    current: User = Depends(require_roles(UserRole.DIRECTOR)),
):
    """Giám đốc / Quản trị: điểm TRUNG BÌNH (1–5) + số phiếu mỗi người NHẬN theo tháng & loại.
    Không trả chi tiết ai chấm — giữ bảo mật người gửi."""
    _check_month(from_month)
    _check_month(to_month)
    if from_month > to_month:
        raise HTTPException(400, "Tháng bắt đầu phải trước hoặc bằng tháng kết thúc.")
    avg_expr = func.avg((PeerReview.score_1 + PeerReview.score_2 + PeerReview.score_3) / 3.0)
    rows = (
        db.query(PeerReview.evaluatee_id, PeerReview.month, PeerReview.kind, avg_expr, func.count(PeerReview.id))
        .filter(
            PeerReview.company_id == current.company_id,
            PeerReview.month >= from_month,
            PeerReview.month <= to_month,
        )
        .group_by(PeerReview.evaluatee_id, PeerReview.month, PeerReview.kind)
        .all()
    )
    return [
        PeerReviewSummaryRow(user_id=uid, month=m, kind=k, avg=round(float(a or 0), 2), count=int(c))
        for uid, m, k, a, c in rows
    ]
