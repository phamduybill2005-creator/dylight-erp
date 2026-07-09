"""
Router Đánh giá theo DỰ ÁN — chấm chéo 360° giữa các thành viên của một dự án.

Quy tắc (chốt với người dùng):
  - Mọi NGƯỜI THAM GIA dự án (thành viên + người chủ trì) chấm điểm LẪN NHAU.
  - Mỗi người chỉ có MỘT phiếu cho một đồng đội trong dự án (ghi đè khi chấm lại).
  - Điểm 1–5 sao + nhận xét. KHÔNG có kỳ (period) — 1 lần cho cả dự án.
  - Xem: người tham gia thấy phiếu MÌNH chấm + điểm MÌNH nhận (ẩn danh người chấm).
    Chủ trì / Giám đốc thấy TỔNG HỢP cả nhóm + từng phiếu (có tên người chấm).
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import Project, ProjectEvaluation, User, UserRole, project_members
from app.schemas import (
    ProjectEvalParticipant, ProjectEvalSummaryRow, ProjectEvaluationCreate,
    ProjectEvaluationOut, ProjectEvaluationView,
)

router = APIRouter(prefix="/project-evaluations", tags=["Đánh giá dự án"])


def _is_director(user: User) -> bool:
    return user.role in (UserRole.DIRECTOR, UserRole.ADMIN)


def _participants(db: Session, project: Project) -> list[User]:
    """Người tham gia dự án = thành viên (M2M) ∪ người chủ trì (nếu chưa là member)."""
    people: list[User] = []
    seen: set[int] = set()
    for u in project.members:
        if u.id not in seen:
            seen.add(u.id)
            people.append(u)
    if project.lead_id and project.lead_id not in seen:
        lead = db.get(User, project.lead_id)
        if lead:
            seen.add(lead.id)
            people.append(lead)
    return people


def _load_project(db: Session, project_id: int, current: User) -> Project:
    p = db.get(Project, project_id)
    if not p or p.company_id != current.company_id:
        raise HTTPException(404, "Không tìm thấy dự án.")
    return p


@router.post("", response_model=ProjectEvaluationOut, status_code=201)
def create_or_update(
    payload: ProjectEvaluationCreate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Gửi/ghi đè phiếu đánh giá một đồng đội trong dự án."""
    project = _load_project(db, payload.project_id, current)
    people = _participants(db, project)
    part_ids = {u.id for u in people}

    # Người chấm phải tham gia dự án (hoặc Giám đốc/Quản trị).
    if not _is_director(current) and current.id not in part_ids:
        raise HTTPException(403, "Bạn không tham gia dự án này nên không thể chấm điểm.")
    # Người được chấm phải là thành viên dự án.
    if payload.evaluatee_id not in part_ids:
        raise HTTPException(400, "Chỉ được đánh giá người tham gia dự án.")
    if payload.evaluatee_id == current.id:
        raise HTTPException(400, "Không thể tự đánh giá chính mình.")

    rec = (
        db.query(ProjectEvaluation)
        .filter(
            ProjectEvaluation.project_id == project.id,
            ProjectEvaluation.evaluator_id == current.id,
            ProjectEvaluation.evaluatee_id == payload.evaluatee_id,
        )
        .first()
    )
    if rec is None:
        rec = ProjectEvaluation(
            company_id=current.company_id, project_id=project.id,
            evaluator_id=current.id, evaluatee_id=payload.evaluatee_id,
        )
        db.add(rec)
    rec.rating = payload.rating
    rec.comment = payload.comment
    db.commit()
    db.refresh(rec)
    return rec


@router.get("", response_model=ProjectEvaluationView)
def project_evaluation_view(
    project_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Toàn bộ dữ liệu tab 'Đánh giá' của dự án — cắt theo quyền người xem."""
    project = _load_project(db, project_id, current)
    people = _participants(db, project)
    part_ids = {u.id for u in people}

    # Chỉ người tham gia / chủ trì / Giám đốc mới được xem.
    can_view = _is_director(current) or current.id in part_ids
    if not can_view:
        raise HTTPException(403, "Bạn không tham gia dự án này.")
    can_manage = _is_director(current) or project.lead_id == current.id

    recs = (
        db.query(ProjectEvaluation)
        .filter(ProjectEvaluation.project_id == project.id)
        .all()
    )

    participants = [
        ProjectEvalParticipant(
            user_id=u.id, full_name=u.full_name, role=u.role,
            department=u.department, is_lead=(u.id == project.lead_id),
        )
        for u in people
    ]

    given = [
        ProjectEvaluationOut.model_validate(r)
        for r in recs if r.evaluator_id == current.id
    ]

    # Phiếu VỀ MÌNH — ẩn danh người chấm (chấm chéo cần tế nhị).
    received_recs = [r for r in recs if r.evaluatee_id == current.id]
    received = [
        ProjectEvaluationOut(
            id=r.id, project_id=r.project_id, evaluator_id=0,
            evaluatee_id=r.evaluatee_id, rating=r.rating, comment=r.comment,
            created_at=r.created_at, evaluator_name=None, evaluatee_name=None,
        )
        for r in received_recs
    ]
    my_count = len(received_recs)
    my_avg = round(sum(r.rating for r in received_recs) / my_count, 2) if my_count else None

    summary: list[ProjectEvalSummaryRow] = []
    all_evaluations: list[ProjectEvaluationOut] = []
    if can_manage:
        by_target: dict[int, list[int]] = {}
        for r in recs:
            by_target.setdefault(r.evaluatee_id, []).append(r.rating)
        names = {u.id: u.full_name for u in people}
        for uid, rs in by_target.items():
            summary.append(ProjectEvalSummaryRow(
                user_id=uid, full_name=names.get(uid, f"#{uid}"),
                avg_rating=round(sum(rs) / len(rs), 2), num_ratings=len(rs),
            ))
        # Điểm thấp lên đầu để chủ trì/Giám đốc chú ý trước.
        summary.sort(key=lambda s: (s.avg_rating, -s.num_ratings))
        all_evaluations = [ProjectEvaluationOut.model_validate(r) for r in recs]

    return ProjectEvaluationView(
        project_id=project.id, can_manage=can_manage, participants=participants,
        given=given, received=received, my_avg=my_avg, my_count=my_count,
        summary=summary, all_evaluations=all_evaluations,
    )
