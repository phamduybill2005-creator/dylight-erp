"""API eligibility, reviewed-month aggregation and simultaneous initial saves."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import Query, sessionmaker

from app.database import Base
from app.models import Company, PeerReview, User, UserRole
from app.routers import evaluations, peer_reviews
from app.schemas import PeerReviewIn
from tests import test_peer_reviews as fixtures


class PeerReviewAuditTests(unittest.TestCase):
    def setUp(self):
        fixtures.PeerReviewTests.setUp(self)
        self.app.include_router(evaluations.router)
        clock = patch.object(peer_reviews, "vn_now", return_value=datetime(2026, 11, 2, 10))
        clock.start(); self.addCleanup(clock.stop)
        with self.sessions() as db:
            db.get(User, self.staff.id).department = "Phòng AI"
            db.get(User, self.peer.id).department = "Phòng BIM"
            db.get(User, self.admin.id).department = "Phòng AI"
            db.commit()

    tearDown = fixtures.PeerReviewTests.tearDown
    _override_db = fixtures.PeerReviewTests._override_db
    _reload = fixtures.PeerReviewTests._reload

    def put(self, target=None, kind="QUALITY", scores=(5, 4, 3)):
        return self.client.put("/peer-reviews", json={"evaluatee_id": (target or self.peer).id,
            "month": "2026-10", "kind": kind, "scores": list(scores)})

    def test_quality_cross_department_rejected_while_team_remains_company_wide(self):
        response = self.put()
        self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(self.put(kind="TEAM").status_code, 200)
        with self.sessions() as db:
            self.assertEqual([row.kind for row in db.query(PeerReview).all()], ["TEAM"])

    def test_quality_accepts_department_aliases_multiple_memberships_and_empty_department(self):
        for voter_dept, peer_dept in (("AI開発", "Phòng AI"), ("Phòng AI, 測量解析", "Phòng Bản đồ"),
                                     (None, "Phòng BIM")):
            with self.subTest(voter_dept=voter_dept), self.sessions() as db:
                db.get(User, self.staff.id).department = voter_dept
                db.get(User, self.peer.id).department = peer_dept
                db.commit()
            response = self.put()
            self.assertEqual(response.status_code, 200, response.text)

    def test_unapproved_target_cannot_receive_new_or_updated_ballots(self):
        self.assertEqual(self.put(kind="TEAM").status_code, 200)
        with self.sessions() as db:
            db.get(User, self.peer.id).is_approved = False; db.commit()
        for kind in ("QUALITY", "TEAM"):
            self.assertEqual(self.put(kind=kind, scores=(1, 1, 1)).status_code, 404)
        with self.sessions() as db:
            row = db.query(PeerReview).one()
            self.assertEqual([row.score_1, row.score_2, row.score_3], [5, 4, 3])

    def test_quality_rechecks_department_on_updates_without_mutating_saved_scores(self):
        self.assertEqual(self.put(self.admin).status_code, 200)
        with self.sessions() as db:
            db.get(User, self.admin.id).department = "Phòng BIM"; db.commit()
        self.assertEqual(self.put(self.admin, scores=(1, 1, 1)).status_code, 403)
        with self.sessions() as db:
            self.assertEqual(db.query(PeerReview).one().score_1, 5)

    def test_october_votes_submitted_in_november_only_feed_october_summary(self):
        quality = self.put(self.admin)
        self.assertEqual(quality.status_code, 200, quality.text)
        self.assertEqual(quality.json()["month"], "2026-10")
        self.assertTrue(quality.json()["updated_at"].startswith("2026-11-02"))
        self.assertEqual(self.put(self.admin, kind="TEAM", scores=(5, 5, 5)).status_code, 200)
        self.current = self.director
        for month, expected_quality, expected_team in (("2026-10", 4.0, 5.0), ("2026-11", None, None)):
            response = self.client.get("/evaluations/month-reviews", params={"from_month": month, "to_month": month})
            self.assertEqual(response.status_code, 200, response.text)
            row = next((row for row in response.json() if row["user_id"] == self.admin.id), {})
            self.assertEqual(row.get("peer_quality"), expected_quality)
            self.assertEqual(row.get("peer_team"), expected_team)

    def test_mine_and_withdraw_do_not_expose_or_delete_another_company_record(self):
        with self.sessions() as db:
            row = PeerReview(company_id=self.outsider.company_id, evaluator_id=self.staff.id,
                evaluatee_id=self.peer.id, month="2026-10", kind="TEAM", score_1=5, score_2=4, score_3=3)
            db.add(row); db.commit(); rid = row.id
        response = self.client.get("/peer-reviews/mine", params={"month": "2026-10"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])
        self.assertEqual(self.client.delete(f"/peer-reviews/{rid}").status_code, 404)
        with self.sessions() as db:
            self.assertIsNotNone(db.get(PeerReview, rid))

    def test_insert_collision_crossing_deadline_preserves_the_committed_ballot(self):
        self.assertEqual(self.put(kind="TEAM").status_code, 200)
        original_first, missed = Query.first, []
        def first(query):
            result = original_first(query)
            if query.column_descriptions[0].get("entity") is PeerReview and not missed:
                missed.append(True)
                return None  # this request observed the key before the winning insert
            return result
        times = iter([datetime(2026, 11, 5, 23, 59, 59)] * 3 + [datetime(2026, 11, 6)])
        with patch.object(Query, "first", first), patch.object(peer_reviews, "vn_now", side_effect=lambda: next(times)):
            response = self.put(kind="TEAM", scores=(1, 1, 1))
        self.assertEqual(response.status_code, 403, response.text)
        with self.sessions() as db:
            row = db.query(PeerReview).one()
            self.assertEqual([row.score_1, row.score_2, row.score_3], [5, 4, 3])


class ConcurrentPeerReviewSaveTests(unittest.TestCase):
    def test_two_initial_saves_for_same_key_both_succeed_and_leave_one_ballot(self):
        with tempfile.TemporaryDirectory() as directory:
            engine = create_engine("sqlite:///" + str(Path(directory) / "review.db"),
                                   connect_args={"check_same_thread": False, "timeout": 15})
            sessions = sessionmaker(bind=engine, expire_on_commit=False)
            Base.metadata.create_all(engine)
            try:
                with sessions() as db:
                    company = Company(name="Concurrent", code="CONCURRENT-PEER"); db.add(company); db.flush()
                    voter = User(company_id=company.id, email="voter@concurrent.invalid", full_name="Voter",
                        hashed_password="unused", role=UserRole.FIELD_STAFF)
                    target = User(company_id=company.id, email="target@concurrent.invalid", full_name="Target",
                        hashed_password="unused", role=UserRole.FIELD_STAFF)
                    db.add_all([voter, target]); db.commit()
                    voter_id, target_id = voter.id, target.id
                barrier, local = threading.Barrier(2), threading.local()
                original_first = Query.first
                def synchronized_first(query):
                    result = original_first(query)
                    if (query.column_descriptions[0].get("entity") is PeerReview
                            and not getattr(local, "checked", False)):
                        local.checked = True
                        barrier.wait(timeout=10)  # both requests observed the initially missing key
                    return result
                def save(scores):
                    with sessions() as db:
                        try:
                            result = peer_reviews.save_peer_review(PeerReviewIn(evaluatee_id=target_id,
                                month="2026-10", kind="TEAM", scores=scores), db, db.get(User, voter_id))
                            return ("ok", result.id)
                        except Exception as exc:
                            return (type(exc).__name__, None)
                with patch.object(Query, "first", synchronized_first), \
                     patch.object(peer_reviews, "vn_now", return_value=datetime(2026, 11, 2, 10)), \
                     patch.object(peer_reviews, "publish"), ThreadPoolExecutor(max_workers=2) as workers:
                    results = list(workers.map(save, ([5, 4, 3], [1, 2, 3])))
                self.assertEqual([result[0] for result in results], ["ok", "ok"], results)
                self.assertEqual(len({result[1] for result in results}), 1)
                with sessions() as db:
                    row = db.query(PeerReview).one()
                    self.assertIn([row.score_1, row.score_2, row.score_3], ([5, 4, 3], [1, 2, 3]))
            finally:
                engine.dispose()
