"""Find voters who have not completed every required peer-review form."""
from sqlalchemy.orm import Session

from app.models import PeerReview, User, UserRole

_DEPARTMENTS = {"測量解析": "Phòng Bản đồ", "3次元設計": "Phòng BIM",
                "土木設計": "Phòng Thiết kế đường 2D", "AI開発": "Phòng AI"}


def _departments(value: str | None) -> set[str]:
    # Match splitDepts/normalizeDept in the existing voting forms.
    return {_DEPARTMENTS.get(part.strip(), part.strip()) for part in (value or "").split(",") if part.strip()}


def pending_evaluators(db: Session, company_id: int, month: str) -> list[User]:
    people = db.query(User).filter(User.company_id == company_id, User.is_active.is_(True),
        User.is_approved.is_(True), User.role != UserRole.DIRECTOR).all()
    ballots = db.query(PeerReview).filter(PeerReview.company_id == company_id, PeerReview.month == month,
        PeerReview.kind.in_(("QUALITY", "TEAM")), PeerReview.score_1.between(1, 5),
        PeerReview.score_2.between(1, 5), PeerReview.score_3.between(1, 5)).all()
    cast = {}
    for ballot in ballots:
        cast.setdefault(ballot.evaluator_id, set()).add((ballot.evaluatee_id, ballot.kind))
    departments = {person.id: _departments(person.department) for person in people}
    pending = []
    for voter in people:
        required = set()
        for peer in people:
            if peer.id == voter.id:
                continue
            required.add((peer.id, "TEAM"))
            if not departments[voter.id] or departments[voter.id] & departments[peer.id]:
                required.add((peer.id, "QUALITY"))
        if required - cast.get(voter.id, set()):
            pending.append(voter)
    return sorted(pending, key=lambda person: (person.full_name.casefold(), person.id))
