"""Named peer ballot details are leadership-only and match their selected category/period."""
import unittest

from tests import test_peer_reviews as fixtures
from app.models import PeerReview, UserRole


class PeerReviewDetailTests(unittest.TestCase):
    setUp = fixtures.PeerReviewTests.setUp
    tearDown = fixtures.PeerReviewTests.tearDown
    _override_db = fixtures.PeerReviewTests._override_db
    _reload = fixtures.PeerReviewTests._reload
    _put = fixtures.PeerReviewTests._put

    def details(self, **changes):
        return self.client.get("/peer-reviews/details", params={
            "evaluatee_id": self.peer.id, "kind": "QUALITY",
            "from_month": "2026-11", "to_month": "2026-11", **changes})

    def read(self, **changes):
        response = self.details(**changes)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_director_and_admin_see_rater_average_and_exact_three_criteria(self):
        self._put(self.peer, scores=(5, 4, 5))
        self._put(self.peer, kind="TEAM", scores=(1, 1, 1))
        self._put(self.peer, month="2026-10", scores=(2, 2, 2))
        for viewer in (self.director, self.admin):
            self.current = viewer
            result = self.read()
            self.assertEqual((result["evaluatee_name"], result["kind"], result["count"]), ("Dong nghiep", "QUALITY", 1))
            evaluator, = result["evaluators"]
            self.assertEqual((evaluator["evaluator_id"], evaluator["evaluator_name"], evaluator["count"]),
                             (self.staff.id, "Nhan vien", 1))
            self.assertAlmostEqual(evaluator["avg"], 14 / 3)
            ballot, = evaluator["reviews"]
            self.assertEqual((ballot["month"], ballot["scores"]), ("2026-11", [5, 4, 5]))
            self.assertAlmostEqual(ballot["avg"], 14 / 3)

    def test_quarter_groups_one_evaluator_across_months_with_individual_ballots(self):
        self._put(self.peer, month="2026-10", scores=(5, 4, 3))
        self._put(self.peer, month="2026-11", scores=(2, 2, 2))
        self.current = self.admin
        self._put(self.peer, scores=(4, 4, 5))
        self.current = self.director
        result = self.read(from_month="2026-10", to_month="2026-12")
        self.assertEqual(result["count"], 3)
        raters = {row["evaluator_id"]: row for row in result["evaluators"]}
        self.assertEqual(len(raters), 2)
        self.assertEqual((raters[self.staff.id]["avg"], raters[self.staff.id]["count"]), (3, 2))
        self.assertEqual([row["month"] for row in raters[self.staff.id]["reviews"]], ["2026-10", "2026-11"])
        self.assertAlmostEqual(raters[self.admin.id]["avg"], 13 / 3)

    def test_team_uses_only_team_ballots_and_target_filter(self):
        self._put(self.peer, scores=(1, 1, 1))
        self._put(self.peer, kind="TEAM", scores=(5, 3, 4))
        self.current = self.peer
        self._put(self.staff, kind="TEAM", scores=(2, 2, 2))
        self.current = self.director
        result = self.read(kind="TEAM")
        self.assertEqual(result["count"], 1)
        self.assertEqual(result["evaluators"][0]["avg"], 4)
        self.assertEqual(result["evaluators"][0]["reviews"][0]["scores"], [5, 3, 4])

    def test_non_leadership_cannot_read_even_when_they_are_target_or_evaluator(self):
        self._put(self.peer)
        for viewer in (self.staff, self.peer):
            self.current = viewer
            self.assertEqual(self.details().status_code, 403)
        for role in (UserRole.MANAGER, UserRole.MANAGER_MID):
            with self.sessions() as db:
                db.get(type(self.staff), self.staff.id).role = role
                db.commit()
            self.current = self.staff
            self.assertEqual(self.details().status_code, 403)

    def test_tenant_target_and_evaluator_scope_prevent_named_data_leaks(self):
        self._put(self.peer)
        with self.sessions() as db:
            for company_id, evaluator_id in ((self.outsider.company_id, self.staff.id),
                                              (self.staff.company_id, self.outsider.id)):
                db.add(PeerReview(company_id=company_id, evaluator_id=evaluator_id,
                    evaluatee_id=self.peer.id, month="2026-10", kind="QUALITY",
                    score_1=1, score_2=1, score_3=1))
            db.commit()
        self.current = self.director
        self.assertEqual(self.details(evaluatee_id=self.outsider.id).status_code, 404)
        self.assertEqual(self.details(evaluatee_id=999999).status_code, 404)
        result = self.read(from_month="2026-10")
        self.assertEqual(result["count"], 1)
        self.assertEqual([r["evaluator_id"] for r in result["evaluators"]], [self.staff.id])
        self.assertNotIn("Ngoai cong ty", str(result))

    def test_invalid_kind_month_year_and_excessive_range_fail_cleanly(self):
        self.current = self.director
        for changes in ({"from_month": "bad"}, {"to_month": "2026-13"},
                        {"from_month": "0000-01"}, {"from_month": "2026-12"},
                        {"from_month": "2024-10"}, {"kind": "OTHER"}):
            with self.subTest(changes=changes):
                self.assertIn(self.details(**changes).status_code, (400, 422))

    def test_empty_period_keeps_selected_target_and_kind(self):
        self.current = self.director
        result = self.read(kind="TEAM")
        self.assertEqual((result["count"], result["evaluators"], result["evaluatee_id"], result["kind"]),
                         (0, [], self.peer.id, "TEAM"))

    def test_inactive_historical_people_are_retained(self):
        self._put(self.peer)
        with self.sessions() as db:
            db.get(type(self.staff), self.staff.id).is_active = False
            db.get(type(self.peer), self.peer.id).is_active = False
            db.commit()
        self.current = self.director
        result = self.read()
        self.assertEqual(result["count"], 1)
        self.assertEqual(result["evaluators"][0]["evaluator_name"], "Nhan vien")

    def test_overwrite_and_withdraw_are_reflected_without_changing_other_read_contracts(self):
        first = self._put(self.peer).json()
        self._put(self.peer, scores=(1, 2, 3))
        self.current = self.director
        result = self.read()
        self.assertEqual(result["count"], 1)
        self.assertEqual(result["evaluators"][0]["avg"], 2)
        self.current = self.staff
        mine = self.client.get("/peer-reviews/mine", params={"month": "2026-11"}).json()
        self.assertNotIn("evaluator_name", mine[0])
        self.assertEqual(self.client.delete(f"/peer-reviews/{first['id']}").status_code, 204)
        self.current = self.director
        self.assertEqual(self.read()["evaluators"], [])


if __name__ == "__main__":
    unittest.main()
