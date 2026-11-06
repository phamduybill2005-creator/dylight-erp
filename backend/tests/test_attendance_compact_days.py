"""Compact monthly attendance: atomic day permissions and complete summary roster."""
from datetime import date, datetime
import unittest

from tests import test_attendance_reconciliation as fixtures
from sqlalchemy import event
from app.models import (
    ActivityLog, Attendance, AttendanceDataConfirmation, AttendanceSessionOverride,
    LeaveStatus, UserRole,
)


class CompactAttendanceDaysTests(unittest.TestCase):
    # Alias only fixture helpers; existing tests are not inherited or rerun.
    setUp = fixtures.ReconciliationTests.setUp
    user = fixtures.ReconciliationTests.user
    punch = fixtures.ReconciliationTests.punch
    leave = fixtures.ReconciliationTests.leave
    get = fixtures.ReconciliationTests.get
    row = fixtures.ReconciliationTests.row
    override = fixtures.ReconciliationTests.override
    assert_status = fixtures.ReconciliationTests.assert_status

    def override_day(self, **kw):
        return self.client.put("/attendance/reconciliation/override-day", json={
            "user_id": self.staff.id, "work_date": "2026-11-05", "sessions": ["AM", "PM"],
            "decision": "EXCUSED_ABSENCE", "reason": "External work approved",
            "approved_by": "Director Nguyen", **kw})

    def summary(self, period="2026-11"):
        response = self.client.get("/attendance/summary", params={"period": period})
        self.assertEqual(response.status_code, 200, response.text)
        return {row["user_id"]: row for row in response.json()}

    def assert_zero_work(self, summary):
        self.assertEqual(summary["present_days"], 0)
        self.assertEqual(summary["total_hours"], 0)
        self.assertEqual(summary["late_days"], 0)

    def test_full_day_permission_is_audited_without_fabricating_attendance_or_coverage(self):
        response = self.override_day()
        self.assertEqual(response.status_code, 200, response.text)
        self.assert_status(response.json(), "EXCUSED_ABSENCE", "EXCUSED_ABSENCE")
        self.assertIsNone(response.json()["attendance_id"])
        self.assertIsNone(response.json()["check_in"])
        self.assertIsNone(response.json()["check_out"])
        for session in ("morning", "afternoon"):
            self.assertEqual(response.json()[session]["permission_source"], "ADMIN")
            self.assertFalse(response.json()[session]["data_confirmed"])
        self.assertEqual(self.db.query(Attendance).count(), 0)
        self.assertEqual(self.db.query(AttendanceDataConfirmation).count(), 0)
        self.assertEqual(self.db.query(AttendanceSessionOverride).count(), 2)
        logs = self.db.query(ActivityLog).order_by(ActivityLog.id).all()
        self.assertEqual(len(logs), 2)
        self.assertEqual({log.entity_id for log in logs},
                         {row.id for row in self.db.query(AttendanceSessionOverride).all()})
        for log in logs:
            self.assertEqual(log.company_id, self.admin.company_id)
            self.assertEqual(log.user_id, self.admin.id)
            self.assertIn(self.admin.full_name, log.detail)
            self.assertIn("Director Nguyen", log.detail)
            self.assertIn("External work approved", log.detail)

    def test_single_session_batch_leaves_other_session_automatic(self):
        response = self.override_day(sessions=["AM"])
        self.assertEqual(response.status_code, 200, response.text)
        self.assert_status(response.json(), "EXCUSED_ABSENCE", "WAITING_DATA")
        self.assertEqual(self.db.query(AttendanceSessionOverride).count(), 1)
        response = self.override_day(sessions=["PM"])
        self.assertEqual(response.status_code, 200, response.text)
        self.assert_status(response.json(), "EXCUSED_ABSENCE", "EXCUSED_ABSENCE")

    def test_batch_reset_reuses_records_and_preserves_original_punches(self):
        record = self.punch("08:15", "17:00")
        self.assertEqual(self.override_day(decision="EXCUSED_LATE").status_code, 200)
        response = self.override_day(decision=None, reason="Return both sessions to automatic")
        self.assertEqual(response.status_code, 200, response.text)
        self.assert_status(response.json(), "UNEXCUSED_LATE", "PRESENT")
        self.assertEqual(self.db.query(AttendanceSessionOverride).count(), 2)
        self.assertTrue(all(row.decision is None for row in self.db.query(AttendanceSessionOverride).all()))
        self.assertEqual(self.db.query(ActivityLog).count(), 4)
        self.db.expire_all()
        record = self.db.get(Attendance, record.id)
        self.assertEqual(record.check_in, datetime(2026, 11, 5, 8, 15))
        self.assertEqual(record.check_out, datetime(2026, 11, 5, 17, 0))
        self.assertIsNone(record.is_late_override)

    def test_second_audit_failure_rolls_back_both_new_session_permissions(self):
        inserts = []

        def fail_second_audit(mapper, connection, target):
            inserts.append(target)
            if len(inserts) == 2:
                raise RuntimeError("Injected second session audit failure")

        event.listen(ActivityLog, "before_insert", fail_second_audit)
        try:
            with self.assertRaises(RuntimeError):
                self.override_day()
        finally:
            event.remove(ActivityLog, "before_insert", fail_second_audit)
        self.db.rollback()
        self.assertEqual(len(inserts), 2)
        self.assertEqual(self.db.query(AttendanceSessionOverride).count(), 0)
        self.assertEqual(self.db.query(ActivityLog).count(), 0)
        self.assertEqual(self.db.query(Attendance).count(), 0)

    def test_failed_second_audit_preserves_prior_session_permission(self):
        self.assertEqual(self.override(decision="EXCUSED_ABSENCE", reason="Original AM permission").status_code, 200)
        inserts = []

        def fail_second_audit(mapper, connection, target):
            inserts.append(target)
            if len(inserts) == 2:
                raise RuntimeError("Injected second audit while editing permission")

        event.listen(ActivityLog, "before_insert", fail_second_audit)
        try:
            with self.assertRaises(RuntimeError):
                self.override_day(reason="Replacement permission")
        finally:
            event.remove(ActivityLog, "before_insert", fail_second_audit)
        self.db.rollback()
        saved = self.db.query(AttendanceSessionOverride).all()
        self.assertEqual(len(saved), 1)
        self.assertEqual(saved[0].session, "AM")
        self.assertEqual(saved[0].reason, "Original AM permission")
        self.assertEqual(self.db.query(ActivityLog).count(), 1)

    def test_day_permissions_are_admin_only(self):
        for role in (UserRole.DIRECTOR, UserRole.MANAGER, UserRole.MANAGER_MID, UserRole.FIELD_STAFF):
            with self.subTest(role=role):
                self.staff.role = role
                self.db.commit()
                self.current = self.staff
                self.assertEqual(self.override_day().status_code, 403)
        self.assertEqual(self.db.query(AttendanceSessionOverride).count(), 0)

    def test_day_permission_rejects_foreign_user_and_future_date_without_writes(self):
        self.assertEqual(self.override_day(user_id=self.other.id).status_code, 404)
        self.assertIn(self.override_day(work_date="2026-11-07").status_code, (400, 422))
        self.assertEqual(self.db.query(AttendanceSessionOverride).count(), 0)
        self.assertEqual(self.db.query(ActivityLog).count(), 0)

    def test_day_permission_validates_sessions_reason_and_authorizer(self):
        for sessions in ([], ["AM", "AM"], ["PM", "PM"], ["AM", "PM", "AM"], ["FULL"], ["AM", "X"]):
            with self.subTest(sessions=sessions):
                self.assertEqual(self.override_day(sessions=sessions).status_code, 422)
        for payload in ({"reason": ""}, {"reason": "   "}, {"approved_by": ""},
                        {"approved_by": "   "}, {"decision": "PRESENT"}, {"work_date": "bad-date"}):
            with self.subTest(payload=payload):
                self.assertIn(self.override_day(**payload).status_code, (400, 422))
        self.assertEqual(self.db.query(AttendanceSessionOverride).count(), 0)
        self.assertEqual(self.db.query(ActivityLog).count(), 0)

    def test_existing_single_session_endpoint_remains_compatible(self):
        response = self.override(decision="EXCUSED_ABSENCE")
        self.assertEqual(response.status_code, 200, response.text)
        self.assert_status(response.json(), "EXCUSED_ABSENCE", "WAITING_DATA")
        self.assertEqual(self.db.query(AttendanceSessionOverride).count(), 1)
        self.assertEqual(self.db.query(ActivityLog).count(), 1)

    def test_monthly_summary_includes_active_approved_roster_without_punches(self):
        self.user(4, is_active=False)
        self.user(5, is_approved=False)
        self.db.commit()
        rows = self.summary()
        self.assertEqual(set(rows), {self.admin.id, self.staff.id})
        for row in rows.values():
            self.assert_zero_work(row)

    def test_leave_only_employee_has_summary_card_but_no_actual_work_credit(self):
        self.leave("FULL")
        rows = self.summary()
        self.assertIn(self.staff.id, rows)
        self.assert_zero_work(rows[self.staff.id])
        self.assertEqual(self.db.query(Attendance).count(), 0)

    def test_monthly_summary_keeps_actual_work_totals_while_adding_empty_cards(self):
        self.punch("08:00", "17:00")
        rows = self.summary()
        self.assertIn(self.admin.id, rows)
        self.assertEqual(rows[self.staff.id]["present_days"], 1)
        self.assertEqual(rows[self.staff.id]["total_hours"], 7.25)
        self.assert_zero_work(rows[self.admin.id])

    def test_monthly_summary_for_regular_employee_includes_only_self_without_punches(self):
        self.current = self.staff
        rows = self.summary()
        self.assertEqual(set(rows), {self.staff.id})
        self.assert_zero_work(rows[self.staff.id])

    def test_monthly_summary_preserves_inactive_historical_record_holders(self):
        self.punch("08:00", "17:00")
        self.staff.is_active = False
        self.db.commit()
        rows = self.summary()
        self.assertIn(self.staff.id, rows)
        self.assertEqual(rows[self.staff.id]["total_hours"], 7.25)

    def test_past_month_excludes_new_accounts_without_matching_evidence(self):
        self.staff.created_at = datetime(2026, 11, 6)
        self.db.commit()
        self.leave("FULL", LeaveStatus.PENDING, day=date(2026, 10, 5))
        self.assertNotIn(self.staff.id, self.summary("2026-10"))

    def test_past_month_retains_actual_records_before_account_creation(self):
        self.staff.created_at = datetime(2026, 11, 6)
        self.punch("08:00", "17:00", day=date(2026, 10, 5))
        rows = self.summary("2026-10")
        self.assertIn(self.staff.id, rows)
        self.assertEqual(rows[self.staff.id]["total_hours"], 7.25)

    def test_past_month_retains_approved_leave_before_account_creation_without_work_credit(self):
        self.staff.created_at = datetime(2026, 11, 6)
        self.leave("FULL", day=date(2026, 10, 5))
        rows = self.summary("2026-10")
        self.assertIn(self.staff.id, rows)
        self.assert_zero_work(rows[self.staff.id])

    def test_past_month_retains_matching_admin_permission_evidence_without_work_credit(self):
        self.staff.created_at = datetime(2026, 11, 6)
        self.db.commit()
        response = self.override(day=date(2026, 10, 5), decision="EXCUSED_ABSENCE")
        self.assertEqual(response.status_code, 200, response.text)
        rows = self.summary("2026-10")
        self.assertIn(self.staff.id, rows)
        self.assert_zero_work(rows[self.staff.id])

    def test_summary_period_validation_rejects_invalid_year_month(self):
        for period in ("bad", "2026-13", "2026-00", "2026-11-05", "2026-1"):
            with self.subTest(period=period):
                response = self.client.get("/attendance/summary", params={"period": period})
                self.assertIn(response.status_code, (400, 422), response.text)

    def test_explicit_historical_detail_includes_inactive_or_unapproved_leave_holders(self):
        historical_day = date(2026, 10, 5)
        self.leave("FULL", day=historical_day)
        for is_active, is_approved in ((False, True), (True, False)):
            with self.subTest(is_active=is_active, is_approved=is_approved):
                self.staff.is_active = is_active
                self.staff.is_approved = is_approved
                self.db.commit()
                self.assertIn(self.staff.id, self.summary("2026-10"))
                historical = self.get(day=historical_day, user=self.staff)["rows"]
                self.assertEqual(len(historical), 1)
                self.assert_status(historical[0], "EXCUSED_ABSENCE", "EXCUSED_ABSENCE")
                self.assertFalse(historical[0]["can_edit_permission"])
                self.assertNotIn(self.staff.id, {row["user_id"] for row in self.get(day=historical_day)["rows"]})
                self.assertEqual(self.override_day(work_date=historical_day.isoformat()).status_code, 404)

    def test_active_approved_detail_reports_permission_editability(self):
        row = self.get(user=self.staff)["rows"][0]
        self.assertTrue(row["can_edit_permission"])

    def test_explicit_historical_reads_remain_self_and_company_scoped(self):
        historical_user = self.user(4, is_active=False)
        self.leave("FULL", user=historical_user)
        self.current = self.staff
        self.assertEqual({row["user_id"] for row in self.get(user=historical_user)["rows"]}, {self.staff.id})
        self.current = self.admin
        self.assertEqual(self.get(user=self.other)["rows"], [])


if __name__ == "__main__":
    unittest.main()
