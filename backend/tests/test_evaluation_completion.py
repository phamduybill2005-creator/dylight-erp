"""Completion is every required peer in both forms, within one company/month."""
import os
import unittest

os.environ.update(DATABASE_URL="sqlite:///:memory:", DEBUG="true", AUTO_SEED="false")

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.database import Base
from app.models import Company, PeerReview, User, UserRole


class EvaluationCompletionTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine, expire_on_commit=False)()
        self.addCleanup(self.engine.dispose)
        self.addCleanup(self.db.close)
        company = Company(name="Completion", code="COMPLETE")
        other = Company(name="Other", code="OTHER-COMPLETE")
        self.db.add_all([company, other]); self.db.flush()
        self.company_id = company.id
        self.admin = self.user("Admin", "Phòng Bản đồ", role=UserRole.ADMIN)
        self.peer = self.user("Peer", "測量解析")
        self.ai = self.user("AI", "Phòng AI")
        self.director = self.user("Director", role=UserRole.DIRECTOR)
        self.inactive = self.user("Inactive", active=False)
        self.unapproved = self.user("Pending", approved=False)
        self.outsider = self.user("Outsider", company_id=other.id)
        self.db.commit()

    def user(self, name, department=None, role=UserRole.FIELD_STAFF, active=True, approved=True, company_id=None):
        person = User(company_id=company_id or self.company_id, email=f"{name}@test.invalid", full_name=name,
                      hashed_password="unused", role=role, department=department, is_active=active, is_approved=approved)
        self.db.add(person); self.db.flush()
        return person

    def rate(self, voter, target, kind, month="2026-10", scores=(5, 4, 3), company_id=None):
        self.db.add(PeerReview(company_id=company_id or self.company_id, evaluator_id=voter.id,
            evaluatee_id=target.id, kind=kind, month=month, score_1=scores[0], score_2=scores[1], score_3=scores[2]))
        self.db.commit()

    def pending(self):
        from app.services.evaluation_completion import pending_evaluators
        return {person.id for person in pending_evaluators(self.db, self.company_id, "2026-10")}

    def test_requires_every_peer_and_both_categories_with_department_aliases(self):
        self.assertEqual(self.pending(), {self.admin.id, self.peer.id, self.ai.id})
        self.rate(self.admin, self.peer, "QUALITY")
        self.rate(self.admin, self.peer, "TEAM")
        self.assertIn(self.admin.id, self.pending())  # still missing TEAM for AI
        self.rate(self.admin, self.ai, "TEAM")
        self.assertNotIn(self.admin.id, self.pending())  # no QUALITY obligation to other department
        self.assertIn(self.peer.id, self.pending())  # receiving ratings is not casting them

    def test_multiple_departments_require_quality_for_each_matching_peer(self):
        self.admin.department = " Phòng Bản đồ , AI開発 "
        self.db.commit()
        self.rate(self.admin, self.peer, "QUALITY")
        for person in (self.peer, self.ai): self.rate(self.admin, person, "TEAM")
        self.assertIn(self.admin.id, self.pending())
        self.rate(self.admin, self.ai, "QUALITY")
        self.assertNotIn(self.admin.id, self.pending())

    def test_missing_department_matches_unrestricted_quality_form(self):
        self.admin.department = None; self.db.commit()
        for person in (self.peer, self.ai): self.rate(self.admin, person, "TEAM")
        self.rate(self.admin, self.peer, "QUALITY")
        self.assertIn(self.admin.id, self.pending())
        self.rate(self.admin, self.ai, "QUALITY")
        self.assertNotIn(self.admin.id, self.pending())

    def test_invalid_scores_wrong_month_company_self_or_director_do_not_complete(self):
        self.rate(self.admin, self.peer, "QUALITY", month="2026-09")
        self.rate(self.admin, self.peer, "TEAM", scores=(5, 0, 3))
        self.rate(self.admin, self.ai, "TEAM", company_id=self.outsider.company_id)
        self.rate(self.admin, self.admin, "TEAM")
        self.rate(self.admin, self.director, "QUALITY")
        self.assertIn(self.admin.id, self.pending())

    def test_no_required_peers_is_complete_and_withdrawal_makes_voter_pending_again(self):
        self.ai.is_active = False; self.db.commit()
        for kind in ("QUALITY", "TEAM"): self.rate(self.admin, self.peer, kind)
        self.assertNotIn(self.admin.id, self.pending())
        self.db.query(PeerReview).filter_by(evaluator_id=self.admin.id, kind="TEAM").delete(); self.db.commit()
        self.assertIn(self.admin.id, self.pending())
        self.peer.is_active = False; self.db.commit()
        self.assertEqual(self.pending(), set())
