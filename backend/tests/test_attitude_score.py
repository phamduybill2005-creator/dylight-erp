"""Automatic monthly attitude points: ordered grace events, source safety and live edits."""
from datetime import date, datetime
from unittest.mock import patch
import unittest

from tests import test_attendance_reconciliation as fixtures
from app.models import AttendanceSource, EvaluationMonthReview, UserRole
from app.routers.evaluations import router


class AttitudeScoreTests(unittest.TestCase):
    user = fixtures.ReconciliationTests.user
    punch = fixtures.ReconciliationTests.punch
    leave = fixtures.ReconciliationTests.leave
    override = fixtures.ReconciliationTests.override
    confirm = fixtures.ReconciliationTests.confirm

    def setUp(self):
        fixtures.ReconciliationTests.setUp(self)
        self.client.app.include_router(router)
        self.punch("08:00", "17:00", day=date(2026, 10, 1))

    def review(self, month="2026-11"):
        response = self.client.get("/evaluations/month-reviews", params={"from_month": month, "to_month": month})
        self.assertEqual(response.status_code, 200, response.text)
        return next((row for row in response.json() if row["user_id"] == self.staff.id), {})

    def assert_points(self, raw, weighted=None, month="2026-11"):
        row = self.review(month)
        self.assertEqual(row.get("attitude_points"), raw, row)
        self.assertEqual(row.get("score_attitude"), weighted if weighted is not None else (raw * 5 if raw is not None else None), row)

    def late(self, day, excused=False):
        day = date(2026, 11, day)
        self.punch("08:15", "17:00", day=day)
        if excused:
            self.assertEqual(self.override(day=day).status_code, 200)

    def forgot(self, day="2026-11-05", punch="OUT", reported_at=None, decision="FORGOT"):
        response = self.client.put("/attendance/reconciliation/forgot-punch", json={
            "user_id": self.staff.id, "work_date": day, "punch": punch,
            "decision": decision, "reported_at": reported_at,
            "reason": "Verified actual forgotten clock", "approved_by": "Director Nguyen"})
        self.assertEqual(response.status_code, 200, response.text)
        return response

    def test_starts_at_five_and_does_not_deduct_unknown_machine_gaps(self):
        self.assert_points(5)
        self.assertGreater(self.review()["attendance_pending_sessions"], 0)

    def test_both_first_two_events_are_free_even_if_unexcused(self):
        self.late(2)
        self.late(3, excused=True)
        self.assert_points(5)

    def test_third_unexcused_event_costs_point_seventy_five_only(self):
        self.late(2)
        self.late(3, excused=True)
        self.late(4)
        self.assert_points(4.25, 21.25)

    def test_third_excused_event_costs_point_twenty_five_and_updates_live(self):
        for day in (2, 3, 4):
            self.late(day)
        self.assert_points(4.25)
        self.override(day=date(2026, 11, 4))
        self.assert_points(4.75, 23.75)
        self.override(day=date(2026, 11, 4), decision=None)
        self.assert_points(4.25)

    def test_grace_counter_resets_each_calendar_month(self):
        for day in (28, 29, 30):
            self.punch("08:15", "17:00", day=date(2026, 10, day))
        self.late(2)
        self.assert_points(4.25, month="2026-10")
        self.assert_points(5)

    def test_absence_is_point_five_per_verified_session_and_excused_is_free(self):
        self.confirm(session="AM")
        self.assert_points(4.5)
        self.confirm(session="PM")
        self.assert_points(4)
        self.override(session="AM", decision="EXCUSED_ABSENCE")
        self.override(session="PM", decision="EXCUSED_ABSENCE")
        self.assert_points(5)

    def test_floor_is_zero(self):
        with patch("app.services.attendance_reconciliation.vn_now", return_value=datetime(2026, 11, 7, 18)):
            for day in range(2, 8):
                for session in ("AM", "PM"):
                    self.confirm(day=date(2026, 11, day), session=session)
            self.assert_points(0)  # six days of absence cannot make a negative score

    def test_old_manual_attitude_is_ignored_but_quality_and_team_are_preserved(self):
        self.db.add(EvaluationMonthReview(company_id=1, user_id=self.staff.id, month="2026-11",
            score_attitude=2, score_quality=41, score_team=20))
        self.db.commit()
        self.assert_points(5)
        row = self.review()
        self.assertEqual((row["score_quality"], row["score_team"]), (41, 20))
        self.assertEqual(float(self.db.query(EvaluationMonthReview).one().score_attitude), 2)

    def test_manual_attitude_writes_are_rejected_atomically_while_other_scores_remain_editable(self):
        self.admin.role = UserRole.DIRECTOR
        self.db.commit()
        path = f"/evaluations/month-reviews/{self.staff.id}/2026-11"
        response = self.client.put(path, json={"score_quality": 41})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual((response.json()["attitude_points"], response.json()["score_attitude"]), (5, 25))
        response = self.client.put(path, json={"score_attitude": 0, "score_quality": 1})
        self.assertEqual(response.status_code, 400, response.text)
        self.assertEqual(self.review()["score_quality"], 41)

    def test_never_started_and_future_months_do_not_receive_an_automatic_five(self):
        self.assert_points(None, month="2026-12")
        self.staff = self.user(4)
        self.db.commit()
        self.assert_points(None)

    def test_early_departures_share_the_same_two_free_events_as_lateness(self):
        self.late(2)
        self.punch("08:15", "16:00", day=date(2026, 11, 3))  # late second, early third
        self.assert_points(4.25)
        self.override(day=date(2026, 11, 3), session="PM", decision="EXCUSED_EARLY")
        self.assert_points(4.75)

    def test_late_permission_does_not_excuse_early_departure(self):
        self.late(2)
        self.late(3)
        self.punch("08:00", "16:00")
        self.override(session="PM", decision="EXCUSED_LATE")
        self.assert_points(4.25)

    def test_unpaired_machine_punch_is_not_early_or_forgotten(self):
        self.late(2)
        self.late(3)
        record = self.punch("08:30", None)
        record.source = AttendanceSource.MACHINE
        self.db.commit()
        self.assert_points(5)

    def test_reported_same_day_is_free_late_report_costs_point_one_and_reset_updates(self):
        self.punch("08:00", "17:00")
        self.forgot(reported_at="2026-11-05T20:00:00")
        self.assert_points(5)
        self.forgot(reported_at="2026-11-06T09:00:00")
        self.assert_points(4.9, 24.5)
        self.forgot(decision=None)
        self.assert_points(5)

    def test_two_confirmed_forgotten_punches_are_independent_and_not_thresholded(self):
        self.punch("08:00", "17:00")
        self.forgot()
        self.forgot(punch="IN")
        self.assert_points(4.8, 24)

    def test_forgotten_clock_on_off_duty_or_fully_excused_absence_is_not_a_penalty(self):
        self.forgot(day="2026-11-01")  # Sunday has no expected clock
        self.assert_points(5)
        self.leave("FULL")
        self.forgot()
        self.assert_points(5)

    def test_forgotten_history_keeps_retired_employee_visible_in_evaluation_and_attendance(self):
        self.forgot()
        self.staff.is_active = False
        self.db.commit()
        self.assert_points(4.9)
        response = self.client.get("/attendance/summary", params={"period": "2026-11"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIn(self.staff.id, {row["user_id"] for row in response.json()})
        self.staff.is_active = True
        self.db.commit()
        self.forgot(decision=None)
        self.staff.is_active = False
        self.db.commit()
        self.assert_points(5)  # keep historical visibility after the correction is reset

    def test_mixed_decimal_deductions_keep_exact_quarter_point_precision(self):
        self.late(2)
        self.late(3)
        self.late(4)
        self.punch("08:00", "17:00")
        self.forgot()
        self.assert_points(4.15, 20.75)

    def test_today_unreported_forgotten_clock_waits_until_day_has_ended(self):
        self.punch("08:00", "17:00", day=date(2026, 11, 6))
        self.forgot(day="2026-11-06")
        self.assert_points(5)
        with patch("app.services.attendance_reconciliation.vn_now", return_value=datetime(2026, 11, 7, 0, 1)):
            self.assert_points(4.9)

    def test_report_timezone_is_compared_in_vietnam(self):
        self.punch("08:00", "17:00")
        self.forgot(reported_at="2026-11-05T16:30:00Z")  # 23:30 same day
        self.assert_points(5)
        self.forgot(reported_at="2026-11-05T17:30:00Z")  # 00:30 next day
        self.assert_points(4.9)


if __name__ == "__main__":
    unittest.main()
