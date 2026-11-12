"""Find voters who have not completed every required peer-review form."""
from sqlalchemy.orm import Session

from app.models import PeerReview, User, UserRole
from app.services.peer_review_policy import normalized_departments


def pending_evaluators(db: Session, company_id: int, month: str) -> list[User]:
    people = db.query(User).filter(User.company_id == company_id, User.is_active.is_(True),
        User.is_approved.is_(True), User.role != UserRole.DIRECTOR).all()
    ballots = db.query(PeerReview).filter(PeerReview.company_id == company_id, PeerReview.month == month,
        PeerReview.kind.in_(("QUALITY", "TEAM")), PeerReview.score_1.between(1, 5),
        PeerReview.score_2.between(1, 5), PeerReview.score_3.between(1, 5)).all()
    cast = {}
    for ballot in ballots:
        cast.setdefault(ballot.evaluator_id, set()).add((ballot.evaluatee_id, ballot.kind))
    departments = {person.id: normalized_departments(person.department) for person in people}
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
