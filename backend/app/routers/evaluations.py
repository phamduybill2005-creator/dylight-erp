"""
Router Đánh giá (Evaluations) — 2 chiều giữa Nhân viên ↔ Quản lý trực tiếp.

Quy tắc chiều đánh giá (chốt với người dùng):
  - Nhân viên (FIELD_STAFF) chấm điểm QUẢN LÝ TRỰC TIẾP của mình (manager_id).
  - Giám đốc / Quản trị / Quản lý cấp cao / Quản lý cấp trung chấm được MỌI NGƯỜI trong
    công ty (bấm sao ở bảng đánh giá tháng).
  - KHÔNG AI được chấm Giám đốc.
RIÊNG TƯ: mỗi người chỉ xem được phiếu MÌNH NHẬN (/received) và phiếu MÌNH CHẤM (/given);
KHÔNG có API xem phiếu (ai chấm ai bao nhiêu sao) của người khác — đừng thêm lại.
Chấm THEO TỪNG NGÀY (eval_date) & TỪNG DỰ ÁN (project_id, tùy chọn) — mỗi (ngày, dự án)
một phiếu (gửi lại thì ghi đè); kỳ tuần (period = Thứ 7) tự suy từ ngày để TỔNG HỢP THEO TUẦN.
"""
import re
from calendar import monthrange
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, require_roles
from app.models import (
    Attendance, Evaluation, EvaluationDirection, EvaluationMonthReview, LeaveRequest, LeaveStatus,
    Project, ProjectEvaluation, ProjectItem, Timesheet, User, UserRole,
)
# Dùng CHUNG luật miễn trễ (đơn đi muộn được duyệt) với trang Chấm công để số
# "Đi muộn" ở bảng Đánh giá khớp đúng số ở Tổng hợp.
from app.routers.attendance import _apply_late_exemption
from app.schemas import (
    EvaluationCreate, EvaluationMonthReviewIn, EvaluationMonthReviewOut, EvaluationOut,
    EvaluationOverviewRow, EvaluationSummary, StarOverviewRow,
)

router = APIRouter(prefix="/evaluations", tags=["Đánh giá"])

# Dùng BẢNG ĐÁNH GIÁ THÁNG và chấm được mọi người (trừ Giám đốc).
_TABLE_ROLES = (UserRole.DIRECTOR, UserRole.ADMIN, UserRole.MANAGER, UserRole.MANAGER_MID)


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
    if evaluatee.role == UserRole.DIRECTOR:
        raise HTTPException(403, "Không ai được đánh giá Giám đốc.")

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
    elif current.role in _TABLE_ROLES:
        # GĐ / Quản trị / QL cấp cao / QL cấp trung chấm bất kỳ ai trong công ty ở bảng đánh
        # giá tháng (Giám đốc đã bị chặn ở trên). Xếp chung chiều MANAGER_TO_STAFF.
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


@router.delete("/mine", status_code=204)
def delete_my_evaluation(
    evaluatee_id: int,
    from_date: date,
    to_date: date,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """BỎ SAO (bấm lại đúng sao đang chọn ở bảng đánh giá tháng): xoá các phiếu CHUNG (không
    gắn dự án) CHÍNH MÌNH đã chấm người đó trong khoảng ngày. Chỉ xoá phiếu của mình."""
    if to_date < from_date:
        raise HTTPException(400, "Ngày kết thúc phải sau ngày bắt đầu.")
    (
        db.query(Evaluation)
        .filter(
            Evaluation.evaluator_id == current.id,
            Evaluation.evaluatee_id == evaluatee_id,
            Evaluation.project_id.is_(None),
            Evaluation.eval_date >= from_date, Evaluation.eval_date <= to_date,
        )
        .delete(synchronize_session=False)
    )
    db.commit()


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

    # Đánh giá quản lý TÁCH 2 CHIỀU (đều là sao người này NHẬN):
    #   - MANAGER_TO_STAFF: quản lý trực tiếp chấm cho người này.
    #   - STAFF_TO_MANAGER: nhân viên / cấp dưới chấm cho người này.
    mgr_down = agg(Evaluation.evaluatee_id, Evaluation,
                   Evaluation.direction == EvaluationDirection.MANAGER_TO_STAFF)
    mgr_up = agg(Evaluation.evaluatee_id, Evaluation,
                 Evaluation.direction == EvaluationDirection.STAFF_TO_MANAGER)
    prj = agg(ProjectEvaluation.evaluatee_id, ProjectEvaluation)
    itm = agg(ProjectItem.assignee_id, ProjectItem)

    users = db.query(User).filter(User.company_id == cid).all()
    out: list[StarOverviewRow] = []
    for u in users:
        md_s, md_c = mgr_down.get(u.id, (0, 0))   # quản lý trực tiếp chấm
        mu_s, mu_c = mgr_up.get(u.id, (0, 0))     # nhân viên / cấp dưới chấm
        p_s, p_c = prj.get(u.id, (0, 0))
        i_s, i_c = itm.get(u.id, (0, 0))
        total_s = md_s + mu_s + p_s + i_s
        total_c = md_c + mu_c + p_c + i_c
        if total_c == 0:
            continue  # chưa nhận sao nào -> bỏ qua
        avg = lambda s, c: round(s / c, 2) if c else None  # noqa: E731
        out.append(StarOverviewRow(
            user_id=u.id, full_name=u.full_name, role=u.role, department=u.department,
            from_manager_avg=avg(md_s, md_c), from_manager_count=md_c,
            from_staff_avg=avg(mu_s, mu_c), from_staff_count=mu_c,
            project_avg=avg(p_s, p_c), project_count=p_c,
            item_avg=avg(i_s, i_c), item_count=i_c,
            overall_avg=avg(total_s, total_c), overall_count=total_c,
        ))
    # Xếp hạng: điểm TB cao lên đầu; cùng điểm thì nhiều phiếu hơn lên trước.
    out.sort(key=lambda r: (-(r.overall_avg or 0), -r.overall_count))
    return out


@router.get("/overview", response_model=list[EvaluationOverviewRow])
def evaluation_overview(
    from_date: date,
    to_date: date,
    db: Session = Depends(get_db),
    current: User = Depends(require_roles(*_TABLE_ROLES)),
):
    """Bảng đánh giá tháng (GĐ / Quản trị / QL cấp cao / QL cấp trung): mỗi người đang làm
    trong khoảng ngày, bao gồm chính mình; chỉ hiện Giám đốc khi đó là người đang xem.
    Dòng của chính mình chỉ để xem số liệu, không được tự chấm sao.
      - office_hours : giờ có mặt theo chấm công, đã trừ nghỉ trưa (như "tổng giờ" ở Tổng hợp).
      - project_hours: tổng giờ khai ở bảng tiến độ dự án (timesheets).
      - late_days    : số ngày đi muộn, đã miễn ngày có đơn đi muộn được duyệt.
      - my_rating    : sao CHÍNH MÌNH đã chấm người đó trong khoảng ngày (phiếu chung,
                       không gắn dự án); nhiều phiếu thì lấy phiếu mới nhất."""
    if to_date < from_date:
        raise HTTPException(400, "Ngày kết thúc phải sau ngày bắt đầu.")
    cid = current.company_id

    users = (
        db.query(User)
        .filter(
            User.company_id == cid,
            or_(User.role != UserRole.DIRECTOR, User.id == current.id),
            User.is_active.is_(True), User.is_approved.is_(True),
        )
        .all()
    )

    records = (
        db.query(Attendance)
        .filter(
            Attendance.company_id == cid,
            Attendance.work_date >= from_date, Attendance.work_date <= to_date,
        )
        .all()
    )
    _apply_late_exemption(db, cid, records)
    office: dict[int, float] = {}
    late: dict[int, int] = {}
    for rec in records:
        # Làm tròn TỪNG NGÀY như attendance_summary để tổng khớp đúng Tổng hợp.
        office[rec.user_id] = office.get(rec.user_id, 0) + round(rec.worked_minutes / 60, 2)
        if rec.is_late:
            late[rec.user_id] = late.get(rec.user_id, 0) + 1

    project = {
        uid: float(h or 0)
        for uid, h in (
            db.query(Timesheet.user_id, func.sum(Timesheet.hours))
            .filter(
                Timesheet.company_id == cid,
                Timesheet.work_date >= from_date, Timesheet.work_date <= to_date,
            )
            .group_by(Timesheet.user_id)
            .all()
        )
    }

    mine: dict[int, int] = {}
    for ev in (
        db.query(Evaluation)
        .filter(
            Evaluation.evaluator_id == current.id,
            Evaluation.project_id.is_(None),
            Evaluation.eval_date >= from_date, Evaluation.eval_date <= to_date,
        )
        .order_by(Evaluation.id)   # phiếu mới hơn ghi đè phiếu cũ
    ):
        mine[ev.evaluatee_id] = ev.rating

    return [
        EvaluationOverviewRow(
            user_id=u.id, full_name=u.full_name, role=u.role, department=u.department,
            office_hours=round(office.get(u.id, 0), 2),
            project_hours=round(project.get(u.id, 0), 2),
            late_days=late.get(u.id, 0),
            my_rating=mine.get(u.id),
        )
        for u in users
    ]


# ---------------------------------------------------------------------------
# BẢNG ĐÁNH GIÁ THÁNG NHẬP TAY: Muộn CP/KP, Nghỉ CP/KP, Ý thức / Chất lượng CV / Tập thể
# ---------------------------------------------------------------------------
_MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
# Đơn nghỉ phép đã duyệt -> số ngày nghỉ CÓ PHÉP: cả ngày = 1, nửa ngày = 0,5; đơn đi muộn
# (LATE_*) không phải nghỉ nên không tính.
_LEAVE_DAY_VALUE = {"FULL": 1.0, "MORNING": 0.5, "AFTERNOON": 0.5}


def _month_bounds(month: str) -> tuple[date, date]:
    y, m = int(month[:4]), int(month[5:7])
    return date(y, m, 1), date(y, m, monthrange(y, m)[1])


def _months_between(from_month: str, to_month: str) -> list[str]:
    out: list[str] = []
    y, m = int(from_month[:4]), int(from_month[5:7])
    while f"{y:04d}-{m:02d}" <= to_month and len(out) < 24:
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m > 12:
            m, y = 1, y + 1
    return out


def _auto_leave_cp(db: Session, cid: int, months: list[str]) -> dict[tuple[int, str], float]:
    """Ngày nghỉ CÓ PHÉP tự tính theo (người, tháng) từ đơn nghỉ phép ĐÃ DUYỆT.
    Lịch sinh viên đăng ký (source "SCHEDULE") là lịch làm việc riêng, KHÔNG phải nghỉ phép
    nên không tính. Bỏ Chủ nhật. Giám đốc vẫn ghi đè được số này ở ô Nghỉ CP."""
    first, _ = _month_bounds(months[0])
    _, last = _month_bounds(months[-1])
    reqs = (
        db.query(LeaveRequest)
        .filter(
            LeaveRequest.company_id == cid,
            LeaveRequest.status == LeaveStatus.APPROVED,
            or_(LeaveRequest.source.is_(None), LeaveRequest.source != "SCHEDULE"),
            LeaveRequest.from_date <= last, LeaveRequest.to_date >= first,
        )
        .all()
    )
    out: dict[tuple[int, str], float] = {}
    for r in reqs:
        val = _LEAVE_DAY_VALUE.get((r.leave_type or "FULL").upper())
        if not val:
            continue
        d, end = max(r.from_date, first), min(r.to_date, last)
        while d <= end:
            if d.weekday() != 6:
                key = (r.user_id, d.strftime("%Y-%m"))
                out[key] = out.get(key, 0.0) + val
            d += timedelta(days=1)
    return out


def _review_out(rec: EvaluationMonthReview | None, user_id: int, month: str, auto: float) -> EvaluationMonthReviewOut:
    f = lambda v: float(v) if v is not None else None  # noqa: E731
    return EvaluationMonthReviewOut(
        user_id=user_id, month=month,
        late_cp=f(rec.late_cp) if rec else None,
        late_kp=f(rec.late_kp) if rec else None,
        leave_cp=f(rec.leave_cp) if rec else None,
        leave_kp=f(rec.leave_kp) if rec else None,
        score_attitude=f(rec.score_attitude) if rec else None,
        score_quality=f(rec.score_quality) if rec else None,
        score_team=f(rec.score_team) if rec else None,
        leave_cp_auto=round(auto, 1),
    )


@router.get("/month-reviews", response_model=list[EvaluationMonthReviewOut])
def month_reviews(
    from_month: str,
    to_month: str,
    db: Session = Depends(get_db),
    current: User = Depends(require_roles(*_TABLE_ROLES)),
):
    """Dòng đánh giá tháng nhập tay của mọi người trong công ty, các tháng từ from_month
    đến to_month (tối đa 24 tháng; xem theo quý = 3 tháng). Chỉ trả (người, tháng) đã có
    dữ liệu nhập hoặc có ngày nghỉ có phép tự tính; thiếu = chưa nhập gì."""
    if not (_MONTH_RE.match(from_month or "") and _MONTH_RE.match(to_month or "")):
        raise HTTPException(400, "Tháng không hợp lệ, cần dạng YYYY-MM.")
    if to_month < from_month:
        raise HTTPException(400, "Tháng kết thúc phải sau tháng bắt đầu.")
    months = _months_between(from_month, to_month)
    cid = current.company_id
    recs = (
        db.query(EvaluationMonthReview)
        .filter(EvaluationMonthReview.company_id == cid, EvaluationMonthReview.month.in_(months))
        .all()
    )
    auto = _auto_leave_cp(db, cid, months)
    by = {(r.user_id, r.month): r for r in recs}
    keys = set(by) | set(auto)
    return [_review_out(by.get(k), k[0], k[1], auto.get(k, 0.0)) for k in sorted(keys)]


@router.put("/month-reviews/{user_id}/{month}", response_model=EvaluationMonthReviewOut)
def set_month_review(
    user_id: int,
    month: str,
    payload: EvaluationMonthReviewIn,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Giám đốc nhập/sửa bảng đánh giá tháng của 1 người: gửi đúng trường cần đổi
    (None = xoá trắng; Nghỉ CP xoá trắng = quay về số tự tính)."""
    if current.role != UserRole.DIRECTOR:
        raise HTTPException(403, "Chỉ Giám đốc mới được nhập bảng đánh giá tháng.")
    if not _MONTH_RE.match(month or ""):
        raise HTTPException(400, "Tháng không hợp lệ, cần dạng YYYY-MM.")
    target = db.get(User, user_id)
    if not target or target.company_id != current.company_id:
        raise HTTPException(404, "Không tìm thấy nhân sự.")
    data = payload.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(400, "Chưa có trường nào để lưu.")

    rec = (
        db.query(EvaluationMonthReview)
        .filter(EvaluationMonthReview.user_id == user_id, EvaluationMonthReview.month == month)
        .first()
    )
    if rec is None:
        rec = EvaluationMonthReview(company_id=current.company_id, user_id=user_id, month=month)
        db.add(rec)
    for key, value in data.items():
        setattr(rec, key, value)
    rec.updated_by_id = current.id
    db.commit()
    db.refresh(rec)
    auto = _auto_leave_cp(db, current.company_id, [month]).get((user_id, month), 0.0)
    return _review_out(rec, user_id, month, auto)
