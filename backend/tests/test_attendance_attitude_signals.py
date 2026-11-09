"""Real reconciliation/API regression coverage for attitude input signals."""
import importlib.util
from pathlib import Path
import unittest
from datetime import datetime
from unittest.mock import patch

from sqlalchemy import event, inspect, text
from alembic.migration import MigrationContext
from alembic.operations import Operations

from tests import test_attendance_reconciliation as fixtures
from app.models import ActivityLog, Attendance, AttendanceDataConfirmation, LeaveStatus, UserRole

DAY = fixtures.DAY


class AttitudeSignalTests(unittest.TestCase):
    setUp = fixtures.ReconciliationTests.setUp
    user = fixtures.ReconciliationTests.user
    punch = fixtures.ReconciliationTests.punch
    leave = fixtures.ReconciliationTests.leave
    get = fixtures.ReconciliationTests.get
    row = fixtures.ReconciliationTests.row
    override = fixtures.ReconciliationTests.override

    def forgot(self, **changes):
        payload = dict(user_id=self.staff.id, work_date=DAY.isoformat(), punch="IN", decision="FORGOT",
                       reported_at=None, reason="Employee confirmed forgotten punch", approved_by="Director Nguyen")
        payload.update(changes)
        return self.client.put("/attendance/reconciliation/forgot-punch", json=payload)

    def test_paired_checkout_derives_one_early_event_without_lunch_check(self):
        record = self.punch("08:00", "16:30")
        row = self.row()
        self.assertIsNone(row["morning"].get("early_status"))
        self.assertEqual(row["afternoon"].get("early_status"), "UNEXCUSED_EARLY")
        self.assertEqual(row["afternoon"].get("early_minutes"), 30)
        record.check_out = datetime(2026, 11, 5, 17)
        self.db.commit()
        self.assertIsNone(self.row()["afternoon"]["early_status"])

    def test_early_permission_excuses_only_early_and_late_permission_only_late(self):
        self.punch("13:45", "16:30")
        response = self.override(session="PM", decision="EXCUSED_EARLY")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["afternoon"]["status"], "UNEXCUSED_LATE")
        self.assertEqual(response.json()["afternoon"]["early_status"], "EXCUSED_EARLY")
        response = self.override(session="PM", decision="EXCUSED_LATE")
        self.assertEqual(response.json()["afternoon"]["status"], "EXCUSED_LATE")
        self.assertEqual(response.json()["afternoon"]["early_status"], "UNEXCUSED_EARLY")

    def test_morning_checkout_uses_personal_end_and_never_counts_pm_early(self):
        self.staff.work_end = "11:00"
        self.punch("08:00", "10:30")
        row = self.row()
        self.assertEqual(row["morning"].get("early_minutes"), 30)
        self.assertEqual(row["morning"].get("early_status"), "UNEXCUSED_EARLY")
        self.assertEqual(row["afternoon"]["status"], "NOT_SCHEDULED")
        self.assertIsNone(row["afternoon"].get("early_status"))

    def test_current_shift_waits_until_end_before_assessing_early_checkout(self):
        self.punch("08:00", "16:00")
        with patch("app.services.attendance_reconciliation.vn_now", return_value=datetime(2026, 11, 5, 16, 15)):
            self.assertIsNone(self.row()["afternoon"].get("early_status"))
        with patch("app.services.attendance_reconciliation.vn_now", return_value=datetime(2026, 11, 5, 17)):
            self.assertEqual(self.row()["afternoon"]["early_status"], "UNEXCUSED_EARLY")

    def test_personal_afternoon_start_determines_checkout_session(self):
        self.staff.work_start = "13:00"
        self.staff.work_end = "17:00"
        self.punch("13:00", "13:15")
        row = self.row()
        self.assertEqual(row["morning"]["status"], "NOT_SCHEDULED")
        self.assertEqual(row["afternoon"]["status"], "PRESENT")
        self.assertEqual(row["afternoon"].get("early_minutes"), 225)
        self.assertEqual(row["afternoon"].get("early_status"), "UNEXCUSED_EARLY")

    def test_combined_permission_preserves_both_late_and_early_permissions(self):
        self.staff.work_end = "11:00"
        self.punch("08:15", "10:30")
        response = self.override(decision="EXCUSED_LATE_EARLY")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["morning"]["status"], "EXCUSED_LATE")
        self.assertEqual(response.json()["morning"]["early_status"], "EXCUSED_EARLY")

    def test_confirmed_forgotten_gap_is_unknown_even_when_machine_coverage_complete(self):
        for session in ("AM", "PM"):
            response = self.client.post("/attendance/reconciliation/confirm-data", json={
                "work_date": DAY.isoformat(), "session": session, "reason": "Complete machine upload"})
            self.assertEqual(response.status_code, 200, response.text)
        response = self.forgot()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["morning"]["status"], "NEEDS_REVIEW")
        self.assertEqual(response.json()["afternoon"]["status"], "NEEDS_REVIEW")
        self.assertEqual(self.override(decision="EXCUSED_ABSENCE").json()["morning"]["status"], "EXCUSED_ABSENCE")
        self.override(decision=None)
        self.punch("08:00", "17:00")
        self.assertEqual(self.row()["morning"]["status"], "PRESENT")
        self.assertEqual(self.row()["afternoon"]["status"], "PRESENT")
        self.assertEqual(len(self.row()["forgot_punches"]), 1)

    def test_no_early_without_paired_valid_session_evidence(self):
        record = self.punch("08:00")
        for ci, co in (("08:00", None), (None, "16:30"), ("16:30", "08:00"), ("12:00", "13:00")):
            with self.subTest(ci=ci, co=co):
                record.check_in = datetime.fromisoformat(f"2026-11-05T{ci}") if ci else None
                record.check_out = datetime.fromisoformat(f"2026-11-05T{co}") if co else None
                self.db.commit()
                row = self.row()
                for session in ("morning", "afternoon"):
                    self.assertEqual(row[session].get("early_minutes"), 0)
                    self.assertIsNone(row[session].get("early_status"))

    def test_conflicting_absence_and_pending_late_never_create_early(self):
        self.punch("13:45", "16:30")
        request = self.leave("LATE_AFTERNOON", LeaveStatus.PENDING)
        self.assertIsNone(self.row()["afternoon"].get("early_status"))
        request.leave_type = "AFTERNOON"
        request.status = LeaveStatus.APPROVED
        self.db.commit()
        self.assertEqual(self.row()["afternoon"]["status"], "NEEDS_REVIEW")
        self.assertIsNone(self.row()["afternoon"].get("early_status"))

    def test_confirm_forgot_is_separate_persisted_and_audited_after_clock_correction(self):
        response = self.forgot(reported_at="2026-11-05T01:00:00Z")
        self.assertEqual(response.status_code, 200, response.text)
        row = response.json()
        self.assertIsNone(row["attendance_id"])
        confirmation = row["forgot_punches"][0]
        self.assertEqual(confirmation["reported_at"], "2026-11-05T08:00:00")
        self.assertEqual(confirmation["punch"], "IN")
        self.assertEqual(confirmation["decision"], "FORGOT")
        self.assertEqual(confirmation["recorded_by"], self.admin.full_name)
        self.assertEqual(self.db.query(AttendanceDataConfirmation).count(), 0)
        self.assertEqual(self.db.query(Attendance).count(), 0)
        self.punch("08:00", "17:00")
        self.assertEqual(len(self.row()["forgot_punches"]), 1)
        response = self.forgot(decision=None, reason="Correction of mistaken confirmation")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["forgot_punches"], [])
        from app.models import AttendanceForgotPunch
        record = self.db.query(AttendanceForgotPunch).one()
        self.assertIsNone(record.decision)
        self.assertEqual(record.recorded_by_id, self.admin.id)
        logs = self.db.query(ActivityLog).order_by(ActivityLog.id).all()
        self.assertEqual(len(logs), 2)
        self.assertIn("2026-11-05T08:00:00", logs[0].detail)
        self.assertIn("Director Nguyen", logs[0].detail)
        self.assertIn("Employee confirmed", logs[1].detail)

    def test_forgot_updates_unique_record_and_preserves_independent_out(self):
        self.assertEqual(self.forgot().status_code, 200)
        self.assertEqual(self.forgot(reason="Later evidence").status_code, 200)
        self.assertEqual(self.forgot(punch="OUT").status_code, 200)
        self.assertEqual([p["punch"] for p in self.row()["forgot_punches"]], ["IN", "OUT"])
        from app.models import AttendanceForgotPunch
        self.assertEqual(self.db.query(AttendanceForgotPunch).count(), 2)

    def test_forgot_validates_target_admin_dates_and_required_basis_for_grant_and_reset(self):
        for changes in (dict(user_id=self.other.id), dict(work_date="2026-11-07"),
                        dict(reported_at="2026-11-04T23:59:00+07:00"),
                        dict(reported_at="2026-11-06T19:00:00+07:00"), dict(punch="AM"),
                        dict(decision="PRESENT"), dict(reason=" "), dict(approved_by=" "),
                        dict(decision=None, approved_by=" ")):
            with self.subTest(changes=changes):
                self.assertIn(self.forgot(**changes).status_code, (400, 404, 422))
        self.staff.is_active = False
        self.db.commit()
        self.assertEqual(self.forgot().status_code, 404)
        self.staff.is_active = True
        self.staff.is_approved = False
        self.db.commit()
        self.assertEqual(self.forgot().status_code, 404)
        self.staff.is_approved = True
        for role in (UserRole.FIELD_STAFF, UserRole.MANAGER, UserRole.DIRECTOR):
            self.staff.role = role
            self.current = self.staff
            self.db.commit()
            self.assertEqual(self.forgot().status_code, 403)
        self.assertEqual(self.db.query(ActivityLog).count(), 0)

    def test_forgot_and_audit_rollback_together(self):
        def fail_audit(*args):
            raise RuntimeError("Injected forgot audit failure")
        event.listen(ActivityLog, "before_insert", fail_audit)
        try:
            with self.assertRaises(RuntimeError):
                self.forgot()
        finally:
            event.remove(ActivityLog, "before_insert", fail_audit)
        from app.models import AttendanceForgotPunch
        self.assertEqual(self.db.query(AttendanceForgotPunch).count(), 0)
        self.assertEqual(self.db.query(ActivityLog).count(), 0)

    def test_forgot_migration_is_idempotent_and_preserves_startup_data(self):
        response = self.forgot()
        self.assertEqual(response.status_code, 200, response.text)
        migration_path = Path(__file__).parents[1] / "alembic/versions/g59b22c7d031_add_forgot_punches.py"
        spec = importlib.util.spec_from_file_location("forgot_migration", migration_path)
        migration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(migration)
        with self.engine.begin() as connection:
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
                migration.upgrade()
            self.assertEqual(connection.execute(text("select count(*) from attendance_forgot_punches")).scalar(), 1)
            connection.execute(text("drop table attendance_forgot_punches"))
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
                migration.upgrade()
            self.assertIn("attendance_forgot_punches", inspect(connection).get_table_names())
            names = {c["name"] for c in inspect(connection).get_columns("attendance_forgot_punches")}
            self.assertTrue({"reported_at", "recorded_by_id", "recorded_by_name"} <= names)
