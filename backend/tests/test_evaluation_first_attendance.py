"""A new hire's evaluation starts at their first actual punch across all history."""
from datetime import date
import unittest

from tests import test_attendance_reconciliation as fixtures
from app.models import Attendance
from app.routers.evaluations import router


class FirstAttendanceEvaluationTests(unittest.TestCase):
    user = fixtures.ReconciliationTests.user
    punch = fixtures.ReconciliationTests.punch
    leave = fixtures.ReconciliationTests.leave
    confirm = fixtures.ReconciliationTests.confirm

    def setUp(self):
        fixtures.ReconciliationTests.setUp(self)
        self.client.app.include_router(router)

    def row(self, month="2026-11"):
        response = self.client.get("/evaluations/month-reviews", params={"from_month": month, "to_month": month})
        self.assertEqual(response.status_code, 200, response.text)
        return next((row for row in response.json() if row["user_id"] == self.staff.id), {})

    def test_new_hire_excludes_all_sessions_before_first_punch(self):
        self.punch("08:00", "17:00")  # first punch 05/11; only 06/11 remains unknown
        self.assertEqual(self.row()["attendance_pending_sessions"], 2)

    def test_no_punch_employee_has_no_pending_or_absence_even_with_source_confirmation(self):
        self.confirm(session="AM")
        self.confirm(session="PM")
        row = self.row()
        self.assertEqual(tuple(row.get(k, 0) for k in ("attendance_pending_sessions", "leave_kp", "late_kp")), (0, 0, 0))

    def test_first_punch_is_looked_up_outside_selected_month(self):
        self.punch("08:00", "17:00", day=date(2026, 10, 31))
        self.assertEqual(self.row()["attendance_pending_sessions"], 10)  # 2-6 Nov, Sunday excluded

    def test_month_before_first_punch_has_no_pending_or_penalties(self):
        self.punch("08:00", "17:00")
        row = self.row("2026-10")
        self.assertEqual(tuple(row.get(k, 0) for k in ("attendance_pending_sessions", "leave_kp", "late_kp")), (0, 0, 0))

    def test_empty_record_is_not_a_start_and_other_people_do_not_set_the_start(self):
        self.punch(day=date(2026, 11, 2))
        self.punch("08:00", "17:00", user=self.admin, day=date(2026, 10, 31))
        self.punch("08:00", "17:00", user=self.other, day=date(2026, 10, 31))
        self.punch("08:00", "17:00")
        self.assertEqual(self.row()["attendance_pending_sessions"], 2)

    def test_future_punch_does_not_start_assessment_early(self):
        self.punch("08:00", "17:00", day=date(2026, 11, 9))
        self.assertEqual(self.row().get("attendance_pending_sessions", 0), 0)

    def test_leave_before_employment_is_not_counted_in_evaluation(self):
        self.leave("FULL", day=date(2026, 11, 4))
        self.punch("08:00", "17:00")
        self.assertEqual(self.row()["leave_cp"], 0)

    def test_future_clock_with_past_work_date_does_not_establish_start(self):
        from datetime import datetime
        record = self.punch("08:00", "17:00", day=date(2026, 11, 2))
        record.check_in = datetime(2026, 11, 9, 8)
        record.check_out = datetime(2026, 11, 9, 17)
        self.db.commit()
        self.assertEqual(self.row()["attendance_pending_sessions"], 0)

    def test_checkout_only_is_actual_evidence_on_its_day(self):
        self.punch(None, "17:00")
        self.assertEqual(self.row()["attendance_pending_sessions"], 4)  # review 05/11 + missing 06/11

    def test_syncing_older_punches_recomputes_the_start_without_saved_state(self):
        self.punch("08:00", "17:00")
        self.assertEqual(self.row()["attendance_pending_sessions"], 2)
        self.punch("08:00", "17:00", day=date(2026, 11, 3))
        self.assertEqual(self.row()["attendance_pending_sessions"], 4)  # missing 04/11 + 06/11

    def test_first_day_is_included_and_later_approved_leave_still_counts(self):
        self.punch("08:15", "17:00")
        self.leave("FULL", day=date(2026, 11, 6))
        self.confirm(day=date(2026, 11, 4), session="AM")
        row = self.row()
        self.assertEqual((row["late_kp"], row["leave_cp"], row["leave_kp"], row["attendance_pending_sessions"]), (1, 1, 0, 0))

    def test_foreign_company_record_for_same_user_does_not_set_start(self):
        from datetime import datetime
        self.db.add(Attendance(company_id=self.other.company_id, user_id=self.staff.id,
            work_date=date(2026, 10, 31), check_in=datetime(2026, 10, 31, 8)))
        self.db.commit()
        self.punch("08:00", "17:00")
        self.assertEqual(self.row()["attendance_pending_sessions"], 2)


if __name__ == "__main__":
    unittest.main()
