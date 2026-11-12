"""The voting deadline is enforced by the API, including administrator writes."""
from datetime import datetime, timezone
import unittest
from unittest.mock import patch

from tests import test_peer_reviews as fixtures
from app.models import PeerReview


class PeerReviewDeadlineTests(unittest.TestCase):
    setUp = fixtures.PeerReviewTests.setUp
    tearDown = fixtures.PeerReviewTests.tearDown
    _override_db = fixtures.PeerReviewTests._override_db
    _reload = fixtures.PeerReviewTests._reload

    def put(self, month="2026-10", scores=(5, 4, 3)):
        return self.client.put("/peer-reviews", json={"evaluatee_id": self.peer.id,
            "month": month, "kind": "QUALITY", "scores": list(scores)})

    def test_entire_days_one_to_five_are_open_including_before_reminder_time(self):
        for now in (datetime(2026, 11, 1), datetime(2026, 11, 5, 23, 59, 59)):
            with self.subTest(now=now), patch("app.routers.peer_reviews.vn_now", return_value=now):
                response = self.put()
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(self.client.delete(f"/peer-reviews/{response.json()['id']}").status_code, 204)

    def test_midnight_day_six_blocks_create_update_delete_without_changing_data(self):
        with patch("app.routers.peer_reviews.vn_now", return_value=datetime(2026, 11, 5, 23, 59, 59)):
            ballot = self.put().json()
        with patch("app.routers.peer_reviews.vn_now", return_value=datetime(2026, 11, 6)), \
                patch("app.routers.peer_reviews.publish") as publish:
            self.assertEqual(self.put(scores=(1, 1, 1)).status_code, 403)
            self.assertEqual(self.client.delete(f"/peer-reviews/{ballot['id']}").status_code, 403)
            self.current = self.admin
            self.assertEqual(self.put().status_code, 403)
            publish.assert_not_called()
        with self.sessions() as db:
            row = db.query(PeerReview).one()
            self.assertEqual([row.score_1, row.score_2, row.score_3], [5, 4, 3])
            self.assertEqual(row.updated_at.isoformat(), ballot["updated_at"])

    def test_admin_and_managers_have_no_deadline_bypass(self):
        for person in (self.staff, self.admin, self.peer):
            self.current = person
            for now in (datetime(2026, 11, 6), datetime(2026, 11, 27, 8), datetime(2026, 11, 30, 23, 59)):
                with self.subTest(person=person.id, now=now), patch("app.routers.peer_reviews.vn_now", return_value=now):
                    self.assertEqual(self.put().status_code, 403)

    def test_next_cycle_does_not_reopen_old_ballots_or_allow_current_month(self):
        with patch("app.routers.peer_reviews.vn_now", return_value=datetime(2026, 11, 1)):
            rid = self.put().json()["id"]
            self.assertEqual(self.put(month="2026-11").status_code, 403)
            self.assertEqual(self.put(month="2026-09").status_code, 403)
        with patch("app.routers.peer_reviews.vn_now", return_value=datetime(2026, 12, 1)):
            self.assertEqual(self.put().status_code, 403)
            self.assertEqual(self.client.delete(f"/peer-reviews/{rid}").status_code, 403)
            response = self.put(month="2026-11")
            self.assertEqual(response.status_code, 200, response.text)

    def test_january_opens_previous_december_and_utc_deadline_uses_vietnam(self):
        with patch("app.routers.peer_reviews.vn_now", return_value=datetime(2027, 1, 1)):
            self.assertEqual(self.put(month="2026-12").status_code, 200)
        for instant, expected in ((datetime(2027, 1, 5, 16, 59, 59, tzinfo=timezone.utc), 200),
                                  (datetime(2027, 1, 5, 17, tzinfo=timezone.utc), 403)):
            with patch("app.routers.peer_reviews.vn_now", return_value=instant):
                self.assertEqual(self.put(month="2026-12").status_code, expected)

    def test_reads_remain_available_after_close(self):
        with patch("app.routers.peer_reviews.vn_now", return_value=datetime(2026, 11, 1)):
            self.assertEqual(self.put().status_code, 200)
        with patch("app.routers.peer_reviews.vn_now", return_value=datetime(2026, 11, 6)):
            response = self.client.get("/peer-reviews/mine", params={"month": "2026-10"})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(len(response.json()), 1)
            self.current = self.admin
            for endpoint, params in (("summary", {"from_month": "2026-10", "to_month": "2026-10"}),
                                     ("details", {"from_month": "2026-10", "to_month": "2026-10", "evaluatee_id": self.peer.id, "kind": "QUALITY"})):
                response = self.client.get(f"/peer-reviews/{endpoint}", params=params)
                self.assertEqual(response.status_code, 200, response.text)
