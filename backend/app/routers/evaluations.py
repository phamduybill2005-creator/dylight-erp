"""
Router Đánh giá (Evaluations) — 2 chiều giữa Nhân viên ↔ Quản lý trực tiếp.

Quy tắc chiều đánh giá (chốt với người dùng):
  - Nhân viên (FIELD_STAFF) chấm điểm QUẢN LÝ TRỰC TIẾP của mình (manager_id).
  - Quản lý (MANAGER / ACCOUNTANT) chấm điểm CẤP DƯỚI trực tiếp của mình.
  - Giám đốc chỉ XEM, không chấm điểm.
Chấm THEO TỪNG NGÀY (eval_date) & TỪNG DỰ ÁN (project_id, tùy chọn) — mỗi (ngày, dự án)
một phiếu (gửi lại thì ghi đè); kỳ tuần (period = Thứ 7) tự suy từ ngày để TỔNG HỢP THEO TUẦN.
"""
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, require_roles
from app.models import (
    Evaluation, EvaluationDirection, Project, ProjectEvaluation, ProjectItem,
    User, UserRole,
)
from app.schemas import EvaluationCreate, EvaluationOut, EvaluationSummary, StarOverviewRow

router = APIRouter(prefix="/evaluations", tags=["Đánh giá"])

_MANAGER_ROLES = (UserRole.MANAGER, UserRole.ACCOUNTANT)
_VIEW_ROLES = (UserRole.MANAGER, UserRole.ACCOUNTANT, UserRole.DIRECTOR)


def _week_saturday(d: date) -> str:
    """Ngày Thứ 7 của tuần chứa d (tuần CN..T7), dạng 'YYYY-MM-DD' — khớp weekSaturday ở frontend."""
    js_day = (d.weekday() + 1) % 7   # CN=0 … T7=6 (giống Date.getDay của JS)
    return (d + timedelta(days=6 - js_day)).isoformat()


@router.post("", response_model=EvaluationOut, status_code=201)
def create_or_update_evaluation(
    payload: EvaluationCreate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Nhân viên/Quản lý gửi phiếu đánh giá THEO NGÀY (+ dự án tùy chọn).
    Tự suy chiều theo vai trò; kỳ tuần (period) tự tính từ eval_date để tổng hợp tuần."""
    evaluatee = db.get(User, payload.evaluatee_id)
    if not evaluatee or evaluatee.company_id != current.company_id:
        raise HTTPException(404, "Không tìm thấy người được đánh giá trong công ty.")
    if evaluatee.id == current.id:
        raise HTTPException(400, "Không thể tự đánh giá chính mình.")

    # Dự án (tùy chọn) phải thuộc cùng công ty — lấy SỚM để còn kiểm tra chủ trì.
    proj = None
    if payload.project_id is not None:
        proj = db.get(Project, payload.project_id)
        if not proj or proj.company_id != current.company_id:
            raise HTTPException(404, "Không tìm thấy dự án.")

    # Xác định & kiểm tra chiều đánh giá hợp lệ.
    if current.role == UserRole.FIELD_STAFF:
        # Nhân viên chấm QUẢN LÝ TRỰC TIẾP của mình (chính + phụ qua manager_ids),
        # HOẶC CHỦ TRÌ (lead) của DỰ ÁN đang chọn (chỉ dự án mình tham gia).
        direct_mgrs: set[int] = set()
        if current.manager_id:
            direct_mgrs.add(current.manager_id)
        if current.manager_ids:
            for x in str(current.manager_ids).split(","):
                x = x.strip()
                if x.isdigit():
                    direct_mgrs.add(int(x))
        is_direct_mgr = evaluatee.id in direct_mgrs
        is_member = bool(proj and any(m.id == current.id for m in (proj.members or [])))
        is_project_lead = bool(proj and proj.lead_id == evaluatee.id and is_member)
        if not is_direct_mgr and not is_project_lead:
            raise HTTPException(403, "Bạn chỉ được đánh giá quản lý trực tiếp của mình hoặc chủ trì dự án bạn tham gia.")
        direction = EvaluationDirection.STAFF_TO_MANAGER
    elif current.role in _MANAGER_ROLES:
        if evaluatee.manager_id != current.id:
            raise HTTPException(403, "Bạn chỉ được đánh giá nhân viên cấp dưới trực tiếp.")
        direction = EvaluationDirection.MANAGER_TO_STAFF
    else:
        raise HTTPException(403, "Vai trò này không tham gia chấm điểm đánh giá.")

    period = _week_saturday(payload.eval_date)

    # Ghi đè phiếu CÙNG (người chấm, người nhận, NGÀY, DỰ ÁN) nếu đã có.
    q = db.query(Evaluation).filter(
        Evaluation.evaluator_id == current.id,
        Evaluation.evaluatee_id == evaluatee.id,
        Evaluation.eval_date == payload.eval_date,
    )
    q = q.filter(Evaluation.project_id.is_(None)) if payload.project_id is None \
        else q.filter(Evaluation.project_id == payload.project_id)
    rec = q.first()
    if rec is None:
        rec = Evaluation(
            company_id=current.company_id, evaluator_id=current.id,
            evaluatee_id=evaluatee.id, direction=direction,
        )
        db.add(rec)
    rec.eval_date = payload.eval_date
    rec.project_id = payload.project_id
    rec.period = period
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
        .order_by(Evaluation.period.desc(), Evaluation.id.desc())
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
        .order_by(Evaluation.period.desc(), Evaluation.id.desc())
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


@router.get("/star-overview", response_model=list[StarOverviewRow])
def star_overview(
    db: Session = Depends(get_db),
    current: User = Depends(require_roles(UserRole.DIRECTOR)),
):
    """TỔNG HỢP SỐ SAO mỗi người NHẬN được, gộp CẢ 3 nguồn (mọi thời gian) — Giám đốc:
      1) Đánh giá quản lý   — Evaluation (người NHẬN = evaluatee).
      2) Đánh giá theo dự án — ProjectEvaluation (người NHẬN = evaluatee).
      3) Đánh giá hạng mục   — ProjectItem.rating, gán cho NGƯỜI ĐƯỢC GIAO (assignee).
    overall = gộp tất cả sao (avg = tổng sao / tổng số phiếu). Chỉ liệt kê người có ≥1 sao.
    Xếp hạng cao → thấp (điểm TB giảm dần)."""
    cid = current.company_id

    def agg(key_col, model, *extra):
        """{user_id: (tổng_sao, số_phiếu)} — chỉ tính phiếu có sao (rating > 0)."""
        rows = (
            db.query(key_col, func.sum(model.rating), func.count(model.id))
            .filter(model.company_id == cid, model.rating > 0, key_col.isnot(None), *extra)
            .group_by(key_col)
            .all()
        )
        return {int(k): (int(s or 0), int(c or 0)) for k, s, c in rows}

    mgr = agg(Evaluation.evaluatee_id, Evaluation)
    prj = agg(ProjectEvaluation.evaluatee_id, ProjectEvaluation)
    itm = agg(ProjectItem.assignee_id, ProjectItem)

    users = db.query(User).filter(User.company_id == cid).all()
    out: list[StarOverviewRow] = []
    for u in users:
        m_s, m_c = mgr.get(u.id, (0, 0))
        p_s, p_c = prj.get(u.id, (0, 0))
        i_s, i_c = itm.get(u.id, (0, 0))
        total_s, total_c = m_s + p_s + i_s, m_c + p_c + i_c
        if total_c == 0:
            continue  # chưa nhận sao nào -> bỏ qua
        avg = lambda s, c: round(s / c, 2) if c else None  # noqa: E731
        out.append(StarOverviewRow(
            user_id=u.id, full_name=u.full_name, role=u.role, department=u.department,
            manager_avg=avg(m_s, m_c), manager_count=m_c,
            project_avg=avg(p_s, p_c), project_count=p_c,
            item_avg=avg(i_s, i_c), item_count=i_c,
            overall_avg=avg(total_s, total_c), overall_count=total_c,
        ))
    # Xếp hạng: điểm TB cao lên đầu; cùng điểm thì nhiều phiếu hơn lên trước.
    out.sort(key=lambda r: (-(r.overall_avg or 0), -r.overall_count))
    return out


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
        .order_by(Evaluation.period.desc(), Evaluation.id.desc())
        .all()
    )
