"""Evaluation totals must be the same read-only decisions as attendance days."""
from datetime import date, datetime
from unittest.mock import patch
import unittest

from tests import test_attendance_reconciliation as fixtures
from app.models import Attendance, AttendanceSource, EvaluationMonthReview, LeaveRequest, LeaveStatus, UserRole
from app.routers.evaluations import router


class EvaluationAttendanceLinkTests(unittest.TestCase):
    user = fixtures.ReconciliationTests.user
    punch = fixtures.ReconciliationTests.punch
    leave = fixtures.ReconciliationTests.leave
    override = fixtures.ReconciliationTests.override
    confirm = fixtures.ReconciliationTests.confirm

    def setUp(self):
        fixtures.ReconciliationTests.setUp(self)
        self.client.app.include_router(router)

    def reviews(self, first="2026-11", last="2026-11"):
        response = self.client.get("/evaluations/month-reviews", params={"from_month": first, "to_month": last})
        self.assertEqual(response.status_code, 200, response.text)
        return {(row["user_id"], row["month"]): row for row in response.json()}

    def counts(self, first="2026-11", last="2026-11", user=None, month="2026-11"):
        row = self.reviews(first, last)[((user or self.staff).id, month)]
        return tuple(row[key] for key in ("late_cp", "late_kp", "leave_cp", "leave_kp"))

    def test_approved_overlapping_absence_deduplicates_sessions(self):
        self.leave("FULL")
        self.leave("MORNING")
        self.assertEqual(self.counts(), (0, 0, 1, 0))
        row = self.reviews()[(self.staff.id, "2026-11")]
        self.assertEqual(row["leave_cp_auto"], 1)
        self.assertEqual(self.db.query(Attendance).count(), 0)

    def test_admin_external_permission_and_reset_recompute_without_saved_review(self):
        self.assertEqual(self.override(decision="EXCUSED_ABSENCE").status_code, 200)
        self.assertEqual(self.counts(), (0, 0, 0.5, 0))
        self.assertEqual(self.override(decision="EXCUSED_ABSENCE", session="PM").status_code, 200)
        self.assertEqual(self.counts(), (0, 0, 1, 0))
        self.assertEqual(self.override(decision=None).status_code, 200)
        self.assertEqual(self.counts(), (0, 0, 0.5, 0))
        self.assertEqual(self.db.query(EvaluationMonthReview).count(), 0)

    def test_verified_absence_only_and_half_day_units(self):
        self.confirm(session="AM")
        self.assertEqual(self.counts(), (0, 0, 0, 0.5))
        self.confirm(session="PM")
        self.assertEqual(self.counts(), (0, 0, 0, 1))

    def test_unknown_or_pending_does_not_count_violation(self):
        self.leave("MORNING", status=LeaveStatus.PENDING)
        record = self.punch("08:30", None)
        record.source = AttendanceSource.MACHINE
        self.db.commit()
        self.assertEqual(self.counts(), (0, 0, 0, 0))
        row = self.reviews()[(self.staff.id, "2026-11")]
        self.assertGreaterEqual(row["attendance_pending_sessions"], 2)

    def test_lateness_moves_between_kp_and_cp_after_admin_correction_and_reset(self):
        self.punch("08:15", "17:00")
        self.assertEqual(self.counts(), (0, 1, 0, 0))
        self.override()
        self.assertEqual(self.counts(), (1, 0, 0, 0))
        self.override(decision=None)
        self.assertEqual(self.counts(), (0, 1, 0, 0))

    def test_approved_late_arrival_boundary_and_full_day_no_afternoon_lateness(self):
        self.punch("08:15", "17:00")
        self.leave("LATE_MORNING", allowed_arrival_time="08:20")
        self.assertEqual(self.counts(), (1, 0, 0, 0))
        request = self.db.query(LeaveRequest).one()
        request.allowed_arrival_time = "08:10"
        self.db.commit()
        self.assertEqual(self.counts(), (0, 1, 0, 0))

    def test_afternoon_only_late_counts_once_with_excused_morning_absence(self):
        self.leave("MORNING")
        self.punch("13:45", "17:00")
        self.assertEqual(self.counts(), (0, 1, 0.5, 0))
        self.override(session="PM")
        self.assertEqual(self.counts(), (1, 0, 0.5, 0))

    def test_pending_late_application_moves_with_approval_and_rejection(self):
        self.punch("08:15", "17:00")
        request = self.leave("LATE_MORNING", status=LeaveStatus.PENDING)
        self.assertEqual(self.counts(), (0, 0, 0, 0))
        request.status = LeaveStatus.APPROVED
        self.db.commit()
        self.assertEqual(self.counts(), (1, 0, 0, 0))
        request.status = LeaveStatus.REJECTED
        self.db.commit()
        self.assertEqual(self.counts(), (0, 1, 0, 0))

    def test_punch_conflicting_with_approved_absence_is_review_not_violation(self):
        self.leave("FULL")
        self.punch("08:15", "17:00")
        self.assertEqual(self.counts(), (0, 0, 0, 0))
        self.assertGreaterEqual(self.reviews()[(self.staff.id, "2026-11")]["attendance_pending_sessions"], 2)

    def test_past_sunday_and_off_duty_sessions_are_not_excused_absence(self):
        self.leave("FULL", day=date(2026, 11, 1))
        self.leave("FULL", source="SCHEDULE")
        self.leave("FULL")
        self.assertEqual(self.counts(), (0, 0, 0, 0))

    def test_schedule_sunday_future_and_future_punch_never_penalize(self):
        self.leave("FULL", source="SCHEDULE")
        self.leave("FULL", day=date(2026, 11, 8))  # Sunday, future
        self.leave("FULL", day=date(2026, 11, 9))  # future approved absence
        self.punch("09:00", "17:00", day=date(2026, 11, 9))
        self.assertEqual(self.counts(), (0, 0, 0, 0))

    def test_old_manual_counts_cannot_mask_live_results_and_scores_are_preserved(self):
        saved = EvaluationMonthReview(company_id=1, user_id=self.staff.id, month="2026-11",
            late_cp=9, late_kp=8, leave_cp=7, leave_kp=6, score_quality=42)
        self.db.add(saved)
        self.db.commit()
        self.punch("08:15", "17:00")
        self.assertEqual(self.counts(), (0, 1, 0, 0))
        self.override()
        row = self.reviews()[(self.staff.id, "2026-11")]
        self.assertEqual((row["late_cp"], row["late_kp"], row["score_quality"]), (1, 0, 42))
        self.db.expire_all()
        self.assertEqual((saved.late_cp, saved.leave_cp), (9, 7))

    def test_score_updates_return_derived_totals_and_reject_manual_attendance_writes(self):
        self.current = self.admin
        self.current.role = UserRole.DIRECTOR
        self.db.commit()
        self.leave("FULL")
        path = f"/evaluations/month-reviews/{self.staff.id}/2026-11"
        response = self.client.put(path, json={"score_quality": 41})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual((response.json()["leave_cp"], response.json()["score_quality"]), (1, 41))
        for field in ("late_cp", "late_kp", "leave_cp", "leave_kp"):
            response = self.client.put(path, json={field: 5, "score_quality": 12})
            self.assertEqual(response.status_code, 400, response.text)
        self.assertEqual(self.reviews()[(self.staff.id, "2026-11")]["score_quality"], 41)

    def test_historical_leave_cross_month_and_tenant_roster(self):
        self.staff.is_active = False
        self.db.commit()
        self.leave("FULL", day=date(2026, 10, 31))
        self.leave("FULL")
        self.leave("FULL", user=self.other)
        rows = self.reviews("2026-10", "2026-11")
        self.assertEqual(rows[(self.staff.id, "2026-10")]["leave_cp"], 1)
        self.assertEqual(rows[(self.staff.id, "2026-11")]["leave_cp"], 1)
        self.assertFalse(any(uid == self.other.id for uid, month in rows))
        self.current = self.staff
        self.assertEqual(self.client.get("/evaluations/month-reviews", params={
            "from_month": "2026-11", "to_month": "2026-11"}).status_code, 403)

    def test_overview_retains_historical_evidence_holders_but_not_empty_inactive_accounts(self):
        self.staff.is_active = False
        inactive = self.user(4, is_active=False)
        unapproved = self.user(5, is_approved=False)
        score_only = self.user(6, is_active=False)
        self.db.commit()
        self.leave("FULL")
        self.punch("08:15", "17:00", user=unapproved)
        self.db.add(EvaluationMonthReview(company_id=1, user_id=score_only.id, month="2026-11", score_quality=40))
        self.db.commit()
        response = self.client.get("/evaluations/overview", params={
            "from_date": "2026-11-01", "to_date": "2026-11-30"})
        self.assertEqual(response.status_code, 200, response.text)
        rows = {row["user_id"]: row for row in response.json()}
        self.assertTrue({self.staff.id, unapproved.id, score_only.id} <= rows.keys())
        self.assertNotIn(inactive.id, rows)
        self.assertNotIn(self.other.id, rows)
        self.assertEqual(rows[unapproved.id]["late_days"], 1)

    def test_overview_uses_session_lateness_not_legacy_clock_flag(self):
        self.punch("08:15", "17:00")
        self.override()
        def late():
            response = self.client.get("/evaluations/overview", params={
                "from_date": "2026-11-05", "to_date": "2026-11-05"})
            self.assertEqual(response.status_code, 200, response.text)
            return next(row for row in response.json() if row["user_id"] == self.staff.id)
        self.assertEqual(late()["late_days"], 0)
        self.override(decision=None)
        self.assertEqual(late()["late_days"], 1)

    def test_invalid_year_and_excessive_range_fail_cleanly(self):
        for first, last in (("0000-01", "0000-02"), ("2024-01", "2026-11")):
            response = self.client.get("/evaluations/month-reviews", params={"from_month": first, "to_month": last})
            self.assertEqual(response.status_code, 400, response.text)


if __name__ == "__main__":
    unittest.main()
