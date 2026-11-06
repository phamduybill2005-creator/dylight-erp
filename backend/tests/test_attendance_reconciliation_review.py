"""Regression cases from independent attendance reconciliation review."""
from datetime import datetime
import unittest
from unittest.mock import patch

from tests import test_attendance_reconciliation as fixtures
from app.models import ActivityLog, Attendance, AttendanceDataConfirmation, AttendanceSource, UserRole
from app.services.attendance_reconciliation import assess_day


class ReconciliationReviewTests(unittest.TestCase):
    # Reuse the disposable database/API fixtures without inheriting their tests.
    setUp = fixtures.ReconciliationTests.setUp
    user = fixtures.ReconciliationTests.user
    punch = fixtures.ReconciliationTests.punch
    leave = fixtures.ReconciliationTests.leave
    get = fixtures.ReconciliationTests.get
    row = fixtures.ReconciliationTests.row
    confirm = fixtures.ReconciliationTests.confirm
    override = fixtures.ReconciliationTests.override
    assert_status = fixtures.ReconciliationTests.assert_status

    def test_historical_punches_before_account_creation_are_still_assessed(self):
        self.staff.created_at = datetime(2026, 11, 6)
        self.punch("08:00", "17:00")
        self.assert_status(self.row(), "PRESENT", "PRESENT")

    def test_historical_approved_absence_before_account_creation_is_still_assessed(self):
        self.staff.created_at = datetime(2026, 11, 6)
        self.leave("FULL")
        self.assert_status(self.row(), "EXCUSED_ABSENCE", "EXCUSED_ABSENCE")

    def test_historical_no_evidence_does_not_use_account_creation_as_employment_schedule(self):
        self.staff.created_at = datetime(2026, 11, 6)
        self.db.commit()
        self.assertEqual(self.confirm().status_code, 200)
        self.assertEqual(self.confirm(session="PM").status_code, 200)
        self.assert_status(self.row(), "NEEDS_REVIEW", "NEEDS_REVIEW")

    def undirected_machine_punch(self):
        record = self.punch("17:00")
        record.source = AttendanceSource.MACHINE
        record.device_id = "yunatt"
        self.db.commit()
        return record

    def test_single_undirected_machine_punch_cannot_prove_arrival_or_morning_absence(self):
        self.undirected_machine_punch()
        self.assertEqual(self.confirm().status_code, 200)
        self.assertEqual(self.confirm(session="PM").status_code, 200)
        self.assert_status(self.row(), "NEEDS_REVIEW", "NEEDS_REVIEW")

    def test_valid_approved_absence_survives_undirected_machine_punch_uncertainty(self):
        self.undirected_machine_punch()
        self.leave("MORNING")
        self.assert_status(self.row(), "EXCUSED_ABSENCE", "NEEDS_REVIEW")

    def test_admin_corrected_checkin_can_be_trusted_as_explicit_arrival(self):
        record = self.undirected_machine_punch()
        record.check_in_corrected = True
        self.db.commit()
        self.assertEqual(self.confirm().status_code, 200)
        self.assertEqual(self.confirm(session="PM").status_code, 200)
        self.assert_status(self.row(), "UNEXCUSED_ABSENCE", "UNEXCUSED_LATE")

    def test_lunch_gap_personal_work_end_means_morning_only(self):
        self.punch("08:00", "12:00")
        for work_end in ("12:00", "13:00"):
            with self.subTest(work_end=work_end):
                self.staff.work_end = work_end
                self.db.commit()
                self.assert_status(self.row(), "PRESENT", "NOT_SCHEDULED")

    def test_lunch_gap_morning_closure_respects_actual_personal_work_end(self):
        self.staff.work_end = "12:00"
        self.db.commit()
        with patch("app.services.attendance_reconciliation.vn_now", return_value=datetime(2026, 11, 5, 11, 50)):
            self.assertFalse(self.get()["confirmation_available"]["AM"])
            self.assertIn(self.confirm().status_code, (400, 422))
            self.assert_status(self.row(), "NOT_FINISHED", "NOT_SCHEDULED")
        with patch("app.services.attendance_reconciliation.vn_now", return_value=datetime(2026, 11, 5, 12, 0)):
            self.assertTrue(self.get()["confirmation_available"]["AM"])
            self.assertEqual(self.confirm().status_code, 200)

    def test_legacy_endpoint_rejects_new_late_flag_for_non_admin(self):
        record = self.punch("08:15", "17:00")
        for role in (UserRole.DIRECTOR, UserRole.MANAGER, UserRole.MANAGER_MID, UserRole.FIELD_STAFF):
            self.staff.role = role
            self.db.commit()
            self.current = self.staff
            for value in (False, True, None):
                with self.subTest(role=role, value=value):
                    response = self.client.put(f"/attendance/{record.id}", json={"is_late_override": value})
                    self.assertEqual(response.status_code, 403, response.text)
        self.db.expire_all()
        self.assertIsNone(self.db.get(Attendance, record.id).is_late_override)
        self.assertEqual(self.db.query(ActivityLog).count(), 0)

    def test_legacy_endpoint_directs_admin_new_late_flag_to_audited_session_route(self):
        record = self.punch("08:15", "17:00")
        for value in (False, True, None):
            with self.subTest(value=value):
                response = self.client.put(f"/attendance/{record.id}", json={"is_late_override": value})
                self.assertEqual(response.status_code, 400, response.text)
                self.assertIn("Xác nhận phép", response.json()["detail"])
        self.db.expire_all()
        self.assertIsNone(self.db.get(Attendance, record.id).is_late_override)
        self.assertEqual(self.db.query(ActivityLog).count(), 0)

    def test_legacy_stored_flags_remain_readable_and_note_edit_preserves_them(self):
        record = self.punch("08:15", "17:00")
        record.is_late_override = False
        self.db.commit()
        self.assertEqual(self.row()["morning"]["status"], "EXCUSED_LATE")
        response = self.client.put(f"/attendance/{record.id}", json={"note": "Clarifying existing record"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(response.json()["is_late"])
        self.db.expire_all()
        self.assertIs(self.db.get(Attendance, record.id).is_late_override, False)

    def test_any_valid_approved_late_permission_qualifies_when_requests_overlap(self):
        self.punch("08:45", "17:00")
        older = self.leave("LATE_MORNING", allowed_arrival_time="09:00",
                           decided_at=datetime(2026, 11, 3, 10, 0))
        self.leave("LATE_MORNING", allowed_arrival_time="08:30",
                   decided_at=datetime(2026, 11, 4, 10, 0))
        row = self.row()
        self.assert_status(row, "EXCUSED_LATE", "PRESENT")
        self.assertEqual(row["morning"]["leave_id"], older.id)

    def test_permission_audit_keeps_each_original_actor_name_after_actor_rename(self):
        self.punch("08:15", "17:00")
        self.admin.full_name = "Original Administrator A"
        second_admin = self.user(4, UserRole.ADMIN)
        second_admin.full_name = "Original Administrator B"
        self.db.commit()
        self.assertEqual(self.override().status_code, 200)
        self.current = second_admin
        self.assertEqual(self.override(reason="Second actor correction").status_code, 200)
        self.admin.full_name = "Renamed Administrator A"
        second_admin.full_name = "Renamed Administrator B"
        self.db.commit()
        logs = self.db.query(ActivityLog).filter_by(action="attendance.permission").order_by(ActivityLog.id).all()
        self.assertEqual(len(logs), 2)
        self.assertEqual(logs[0].user_id, self.admin.id)
        self.assertEqual(logs[1].user_id, second_admin.id)
        self.assertIn("Original Administrator A", logs[0].detail)
        self.assertIn("Original Administrator B", logs[1].detail)

    def test_coverage_audit_keeps_each_original_actor_name_after_actor_rename(self):
        self.admin.full_name = "Original Coverage Administrator A"
        second_admin = self.user(4, UserRole.ADMIN)
        second_admin.full_name = "Original Coverage Administrator B"
        self.db.commit()
        self.assertEqual(self.confirm().status_code, 200)
        self.current = second_admin
        self.assertEqual(self.confirm(reason="Coverage rechecked by second actor").status_code, 200)
        self.admin.full_name = "Renamed Coverage Administrator A"
        second_admin.full_name = "Renamed Coverage Administrator B"
        self.db.commit()
        logs = self.db.query(ActivityLog).filter_by(action="attendance.data_confirmation").order_by(ActivityLog.id).all()
        self.assertEqual(len(logs), 2)
        self.assertEqual(logs[0].user_id, self.admin.id)
        self.assertEqual(logs[1].user_id, second_admin.id)
        self.assertIn("Original Coverage Administrator A", logs[0].detail)
        self.assertIn("Original Coverage Administrator B", logs[1].detail)

    def test_unpaired_machine_punch_needs_review_as_soon_as_morning_session_closes(self):
        record = self.punch("12:00")
        record.source = AttendanceSource.MACHINE
        record.device_id = "yunatt"
        self.db.commit()
        confirmation = AttendanceDataConfirmation(company_id=1, work_date=fixtures.DAY, session="AM",
            reason="Morning upload checked", confirmed_by_id=self.admin.id,
            confirmed_at=datetime(2026, 11, 5, 12, 5))
        for work_end in (None, "12:00"):
            with self.subTest(work_end=work_end):
                self.staff.work_end = work_end
                result = assess_day(self.staff, fixtures.DAY, record, [], [], [confirmation],
                                    datetime(2026, 11, 5, 12, 10))
                self.assertEqual(result["morning"]["status"], "NEEDS_REVIEW")

    def test_paired_lunch_gap_punches_prove_presence_in_personal_morning_shift(self):
        self.staff.work_end = "12:00"
        record = self.punch("11:50", "12:00")
        record.source = AttendanceSource.MACHINE
        record.device_id = "yunatt"
        self.db.commit()
        confirmation = AttendanceDataConfirmation(company_id=1, work_date=fixtures.DAY, session="AM",
            reason="Morning upload checked", confirmed_by_id=self.admin.id,
            confirmed_at=datetime(2026, 11, 5, 12, 5))
        result = assess_day(self.staff, fixtures.DAY, record, [], [], [confirmation],
                            datetime(2026, 11, 5, 12, 10))
        self.assert_status(result, "UNEXCUSED_LATE", "NOT_SCHEDULED")
        self.assertEqual(result["morning"]["late_minutes"], 230)

    def test_future_raw_timestamps_on_current_work_date_need_review(self):
        record = self.punch("17:00", "18:00")
        result = assess_day(self.staff, fixtures.DAY, record, [], [], [],
                            datetime(2026, 11, 5, 12, 10))
        self.assert_status(result, "NEEDS_REVIEW", "NEEDS_REVIEW")


if __name__ == "__main__":
    unittest.main()
