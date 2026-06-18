"""
Router Đánh giá (Evaluations) — 2 chiều giữa Nhân viên ↔ Quản lý trực tiếp.

Quy tắc chiều đánh giá (chốt với người dùng):
  - Nhân viên (FIELD_STAFF) chấm điểm QUẢN LÝ TRỰC TIẾP của mình (manager_id).
  - Quản lý (MANAGER / ACCOUNTANT) chấm điểm CẤP DƯỚI trực tiếp của mình.
  - Giám đốc chỉ XEM, không chấm điểm.
Mỗi kỳ (period 'YYYY-MM') một người chỉ có một phiếu cho một đối tượng (ghi đè khi gửi lại).
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, require_roles
from app.models import Evaluation, EvaluationDirection, User, UserRole
from app.schemas import EvaluationCreate, EvaluationOut, EvaluationSummary

router = APIRouter(prefix="/evaluations", tags=["Đánh giá"])

_MANAGER_ROLES = (UserRole.MANAGER, UserRole.ACCOUNTANT)
_VIEW_ROLES = (UserRole.MANAGER, UserRole.ACCOUNTANT, UserRole.DIRECTOR)


@router.post("", response_model=EvaluationOut, status_code=201)
def create_or_update_evaluation(
    payload: EvaluationCreate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Nhân viên/Quản lý gửi phiếu đánh giá. Tự suy ra chiều theo vai trò người chấm."""
    evaluatee = db.get(User, payload.evaluatee_id)
    if not evaluatee or evaluatee.company_id != current.company_id:
        raise HTTPException(404, "Không tìm thấy người được đánh giá trong công ty.")
    if evaluatee.id == current.id:
        raise HTTPException(400, "Không thể tự đánh giá chính mình.")

    # Xác định & kiểm tra chiều đánh giá hợp lệ.
    if current.role == UserRole.FIELD_STAFF:
        if current.manager_id != evaluatee.id:
            raise HTTPException(403, "Bạn chỉ được đánh giá quản lý trực tiếp của mình.")
        direction = EvaluationDirection.STAFF_TO_MANAGER
    elif current.role in _MANAGER_ROLES:
        if evaluatee.manager_id != current.id:
            raise HTTPException(403, "Bạn chỉ được đánh giá nhân viên cấp dưới trực tiếp.")
        direction = EvaluationDirection.MANAGER_TO_STAFF
    else:
        raise HTTPException(403, "Vai trò này không tham gia chấm điểm đánh giá.")

    # Ghi đè phiếu cùng kỳ nếu đã tồn tại.
    rec = (
        db.query(Evaluation)
        .filter(
            Evaluation.evaluator_id == current.id,
            Evaluation.evaluatee_id == evaluatee.id,
            Evaluation.period == payload.period,
        )
        .first()
    )
    if rec is None:
        rec = Evaluation(
            company_id=current.company_id, evaluator_id=current.id,
            evaluatee_id=evaluatee.id, period=payload.period, direction=direction,
        )
        db.add(rec)
    rec.rating = payload.rating
    rec.comment = payload.comment
    rec.direction = direction
    db.commit()
    db.refresh(rec)
    return rec


@router.get("/received", response_model=list[EvaluationOut])
def evaluations_received(
    db: Session = Depends(get_db), current: User = Depends(get_current_user)
):
    """Các phiếu đánh giá về CHÍNH MÌNH."""
    return (
        db.query(Evaluation)
        .filter(Evaluation.evaluatee_id == current.id)
        .order_by(Evaluation.period.desc())
        .all()
    )


@router.get("/given", response_model=list[EvaluationOut])
def evaluations_given(
    db: Session = Depends(get_db), current: User = Depends(get_current_user)
):
    """Các phiếu MÌNH ĐÃ CHẤM cho người khác."""
    return (
        db.query(Evaluation)
        .filter(Evaluation.evaluator_id == current.id)
        .order_by(Evaluation.period.desc())
        .all()
    )


@router.get("/all", response_model=list[EvaluationOut])
def all_evaluations(
    period: str | None = None,
    db: Session = Depends(get_db),
    current: User = Depends(require_roles(UserRole.DIRECTOR)),
):
    """TẤT CẢ phiếu đánh giá trong công ty (Giám đốc) — lọc theo kỳ (tuần) nếu có."""
    q = db.query(Evaluation).filter(Evaluation.company_id == current.company_id)
    if period:
        q = q.filter(Evaluation.period == period)
    return q.order_by(Evaluation.period.desc(), Evaluation.id.desc()).all()


@router.get("/summary", response_model=list[EvaluationSummary])
def evaluations_summary(
    period: str | None = None,
    db: Session = Depends(get_db),
    current: User = Depends(require_roles(UserRole.DIRECTOR)),
):
    """Tổng hợp điểm trung bình MỖI NGƯỜI NHẬN trong kỳ (Giám đốc) — số liệu được đẩy lên."""
    q = db.query(Evaluation).filter(Evaluation.company_id == current.company_id)
    if period:
        q = q.filter(Evaluation.period == period)
    evals = q.all()
    users = {u.id: u for u in db.query(User).filter(User.company_id == current.company_id).all()}
    ratings: dict[int, list[int]] = {}
    for e in evals:
        ratings.setdefault(e.evaluatee_id, []).append(e.rating)
    out = []
    for uid, rs in ratings.items():
        u = users.get(uid)
        if not u:
            continue
        out.append(EvaluationSummary(
            user_id=uid, full_name=u.full_name, role=u.role,
            avg_rating=round(sum(rs) / len(rs), 2), num_ratings=len(rs),
        ))
    # Điểm thấp lên đầu để Giám đốc chú ý trước.
    return sorted(out, key=lambda s: (s.avg_rating, -s.num_ratings))


@router.get("", response_model=list[EvaluationOut])
def evaluations_for_user(
    evaluatee_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(require_roles(*_VIEW_ROLES)),
):
    """Quản lý / Giám đốc xem toàn bộ phiếu đánh giá của một người (cùng công ty)."""
    target = db.get(User, evaluatee_id)
    if not target or target.company_id != current.company_id:
        raise HTTPException(404, "Không tìm thấy nhân viên.")
    return (
        db.query(Evaluation)
        .filter(Evaluation.evaluatee_id == evaluatee_id)
        .order_by(Evaluation.period.desc())
        .all()
    )
