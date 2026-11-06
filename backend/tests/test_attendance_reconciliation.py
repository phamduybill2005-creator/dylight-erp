"""Attendance reconciliation regression tests: isolated DB and no external services."""
import os
import unittest
from datetime import date, datetime
from unittest.mock import Mock, patch

os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")
os.environ.setdefault("DEBUG", "true")

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.deps import get_current_user
from app.models import ActivityLog, Attendance, Company, LeaveRequest, LeaveStatus, User, UserRole
from app.routers import attendance, leave
from app.services.leave_zalo_service import get_leave_zalo_service

DAY = date(2026, 11, 5)
NOW = datetime(2026, 11, 6, 18, 0)


class ReconciliationTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite+pysqlite:///:memory:",
                                    connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine, expire_on_commit=False)()
        self.db.add_all([Company(id=1, name="Company A", code="A"),
                         Company(id=2, name="Company B", code="B")])
        self.admin = self.user(1, UserRole.ADMIN)
        self.staff = self.user(2)
        self.other = self.user(3, company_id=2)
        self.current = self.admin
        self.db.commit()
        app = FastAPI()
        app.include_router(attendance.router)
        app.include_router(leave.router)

        def database():
            try:
                yield self.db
            except Exception:
                self.db.rollback()
                raise

        app.dependency_overrides[get_db] = database
        app.dependency_overrides[get_current_user] = lambda: self.current
        self.zalo = Mock()
        self.zalo.send_request.return_value = {"status": "skipped", "reason": "isolated_test"}
        app.dependency_overrides[get_leave_zalo_service] = lambda: self.zalo
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.addCleanup(self.engine.dispose)
        self.addCleanup(self.db.close)
        for target in ("app.services.attendance_reconciliation.vn_now", "app.routers.attendance.vn_now",
                       "app.routers.leave.vn_now"):
            clock = patch(target, return_value=NOW)
            clock.start()
            self.addCleanup(clock.stop)

    def user(self, uid, role=UserRole.FIELD_STAFF, company_id=1, **kw):
        options = {"is_active": True, "is_approved": True, "created_at": datetime(2026, 1, 1), **kw}
        user = User(id=uid, company_id=company_id, email=f"user{uid}@test.example",
                    full_name=f"User {uid}", hashed_password="unused", role=role,
                    **options)
        self.db.add(user)
        return user

    def punch(self, check_in=None, check_out=None, user=None, day=DAY):
        user = user or self.staff
        record = Attendance(company_id=user.company_id, user_id=user.id, work_date=day,
                            check_in=datetime.combine(day, datetime.strptime(check_in, "%H:%M").time()) if check_in else None,
                            check_out=datetime.combine(day, datetime.strptime(check_out, "%H:%M").time()) if check_out else None)
        self.db.add(record)
        self.db.commit()
        return record

    def leave(self, kind, status=LeaveStatus.APPROVED, user=None, day=DAY, **kw):
        user = user or self.staff
        request = LeaveRequest(company_id=user.company_id, user_id=user.id,
                               from_date=day, to_date=day, leave_type=kind, status=status,
                               reason="Fixture permission", source=kw.pop("source", "LEAVE"), **kw)
        self.db.add(request)
        self.db.commit()
        return request

    def get(self, day=DAY, user=None, **params):
        params = {"from_date": day.isoformat(), "to_date": day.isoformat(), **params}
        if user:
            params["user_id"] = user.id
        response = self.client.get("/attendance/reconciliation", params=params)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def row(self, day=DAY, user=None):
        user = user or self.staff
        return next(row for row in self.get(day, user)["rows"] if row["user_id"] == user.id)

    def assert_status(self, row, morning, afternoon):
        self.assertEqual(row["morning"]["status"], morning)
        self.assertEqual(row["afternoon"]["status"], afternoon)

    def override(self, user=None, day=DAY, session="AM", decision="EXCUSED_LATE", **kw):
        return self.client.put("/attendance/reconciliation/override", json={
            "user_id": (user or self.staff).id, "work_date": day.isoformat(),
            "session": session, "decision": decision, "reason": "Client visit approved",
            "approved_by": "Director Nguyen", **kw})

    def confirm(self, day=DAY, session="AM", **kw):
        return self.client.post("/attendance/reconciliation/confirm-data", json={
            "work_date": day.isoformat(), "session": session,
            "reason": "Machine upload checked complete", **kw})

    def test_roster_includes_employee_without_punches_and_waits_for_source_coverage(self):
        row = self.row()
        self.assertIsNone(row["attendance_id"])
        self.assert_status(row, "WAITING_DATA", "WAITING_DATA")

    def test_pure_assessor_preserves_attendance_and_respects_explicit_now(self):
        from app.services.attendance_reconciliation import assess_day

        record = self.punch("08:15", "17:00")
        leave = self.leave("LATE_MORNING")
        result = assess_day(self.staff, DAY, record, [leave], [], [], NOW)
        self.assert_status(result, "EXCUSED_LATE", "PRESENT")
        self.assertIsNone(record.is_late_override)
        self.assertFalse(self.db.is_modified(record))

    def test_pure_assessor_does_not_infer_absence_before_session_closes(self):
        from app.services.attendance_reconciliation import assess_day

        result = assess_day(self.staff, DAY, None, [], [], [], datetime(2026, 11, 5, 10, 0))
        self.assert_status(result, "NOT_FINISHED", "NOT_FINISHED")

    def test_service_reconcile_is_tenant_scoped_and_includes_no_row_staff(self):
        from app.services.attendance_reconciliation import reconcile

        result = reconcile(self.db, 1, DAY, DAY, user_id=self.staff.id, now=NOW)
        self.assertEqual(len(result["rows"]), 1)
        self.assertEqual(result["rows"][0]["user_id"], self.staff.id)
        self.assert_status(result["rows"][0], "WAITING_DATA", "WAITING_DATA")
        self.assertEqual(reconcile(self.db, 1, DAY, DAY, user_id=self.other.id, now=NOW)["rows"], [])

    def test_full_day_arrival_is_only_assessed_for_morning_lateness(self):
        self.punch("08:15", "17:00")
        row = self.row()
        self.assert_status(row, "UNEXCUSED_LATE", "PRESENT")
        self.assertEqual(row["morning"]["late_minutes"], 15)
        self.assertEqual(row["afternoon"]["late_minutes"], 0)

    def test_morning_late_permission_does_not_excuse_afternoon_only_lateness(self):
        self.punch("13:45", "17:00")
        self.leave("LATE_MORNING")
        self.assertEqual(self.row()["afternoon"]["status"], "UNEXCUSED_LATE")

    def test_afternoon_late_permission_does_not_excuse_morning_lateness(self):
        self.punch("08:15", "17:00")
        self.leave("LATE_AFTERNOON")
        self.assert_status(self.row(), "UNEXCUSED_LATE", "PRESENT")

    def test_approved_morning_absence_and_afternoon_lateness_are_separate(self):
        self.punch("13:45", "17:00")
        leave = self.leave("MORNING")
        row = self.row()
        self.assert_status(row, "EXCUSED_ABSENCE", "UNEXCUSED_LATE")
        self.assertEqual(row["morning"]["leave_id"], leave.id)
        self.assertEqual(row["morning"]["permission_source"], "LEAVE")
        self.assertEqual(row["afternoon"]["late_minutes"], 15)

    def test_matching_legacy_late_permission_without_arrival_time_remains_valid(self):
        self.punch("13:45", "17:00")
        self.leave("LATE_AFTERNOON")
        row = self.row()
        self.assertEqual(row["afternoon"]["status"], "EXCUSED_LATE")
        self.assertEqual(row["afternoon"]["permission_source"], "LEAVE")

    def test_allowed_arrival_time_has_a_real_boundary(self):
        record = self.punch("08:30", "17:00")
        self.leave("LATE_MORNING", allowed_arrival_time="08:30")
        self.assertEqual(self.row()["morning"]["status"], "EXCUSED_LATE")
        record.check_in = datetime(2026, 11, 5, 8, 31)
        self.db.commit()
        self.assertEqual(self.row()["morning"]["status"], "UNEXCUSED_LATE")

    def test_custom_morning_start_does_not_leak_into_afternoon_threshold(self):
        self.staff.work_start = "08:30"
        record = self.punch("13:30", "17:00")
        self.assertEqual(self.row()["afternoon"]["status"], "PRESENT")
        record.check_in = datetime(2026, 11, 5, 13, 31)
        self.db.commit()
        row = self.row()
        self.assertEqual(row["afternoon"]["status"], "UNEXCUSED_LATE")
        self.assertEqual(row["afternoon"]["late_minutes"], 1)

    def test_custom_afternoon_start_is_used_for_afternoon_only_arrival(self):
        self.staff.work_start = "14:00"
        record = self.punch("14:00", "17:00")
        self.assertEqual(self.row()["afternoon"]["status"], "PRESENT")
        record.check_in = datetime(2026, 11, 5, 14, 1)
        self.db.commit()
        self.assertEqual(self.row()["afternoon"]["late_minutes"], 1)

    def test_pending_rejected_and_canceled_late_requests_do_not_excuse(self):
        self.punch("08:15", "17:00")
        request = self.leave("LATE_MORNING", LeaveStatus.PENDING)
        self.assertEqual(self.row()["morning"]["status"], "PENDING_APPROVAL")
        for state in (LeaveStatus.REJECTED, LeaveStatus.CANCELED):
            with self.subTest(state=state):
                request.status = state
                self.db.commit()
                row = self.row()
                self.assertEqual(row["morning"]["status"], "UNEXCUSED_LATE")
                self.assertIsNone(row["morning"]["permission_source"])

    def test_late_permission_never_excuses_a_whole_missing_session(self):
        self.leave("LATE_MORNING")
        self.assertEqual(self.confirm().status_code, 200)
        self.assertEqual(self.row()["morning"]["status"], "UNEXCUSED_ABSENCE")

    def test_explicit_coverage_changes_only_the_confirmed_session(self):
        response = self.confirm()
        self.assertEqual(response.status_code, 200, response.text)
        row = self.row()
        self.assert_status(row, "UNEXCUSED_ABSENCE", "WAITING_DATA")
        self.assertTrue(row["morning"]["data_confirmed"])
        self.assertFalse(row["afternoon"]["data_confirmed"])
        confirmations = self.get()["confirmations"]
        self.assertEqual(len(confirmations), 1)
        self.assertEqual(confirmations[0]["work_date"], "2026-11-05")
        self.assertEqual(confirmations[0]["session"], "AM")
        self.assertTrue(confirmations[0]["confirmed_by"])

    def test_morning_checkin_without_checkout_needs_review_for_afternoon_even_with_coverage(self):
        self.punch("08:00")
        self.assertEqual(self.confirm(session="PM").status_code, 200)
        self.assert_status(self.row(), "PRESENT", "NEEDS_REVIEW")

    def test_checkout_without_checkin_is_unknown_even_with_coverage(self):
        self.punch(check_out="17:00")
        self.confirm()
        self.confirm(session="PM")
        self.assert_status(self.row(), "NEEDS_REVIEW", "NEEDS_REVIEW")

    def test_sunday_and_future_are_never_unexcused_absence(self):
        self.assert_status(self.row(date(2026, 11, 8)), "NOT_SCHEDULED", "NOT_SCHEDULED")
        self.assert_status(self.row(date(2026, 11, 7)), "NOT_FINISHED", "NOT_FINISHED")

    def test_configured_holiday_is_not_scheduled(self):
        from app.config import settings

        with patch.object(settings, "ATTENDANCE_HOLIDAYS", "2026-11-05,2026-12-31"):
            self.assert_status(self.row(), "NOT_SCHEDULED", "NOT_SCHEDULED")

    def test_successful_empty_sync_does_not_confirm_missing_source_data(self):
        from app.services import yunatt_service

        with patch.object(yunatt_service, "fetch_months", return_value=([], [])):
            result = yunatt_service.run_sync(self.db, 1, months=["2026-11"])
        self.assertEqual(result["rows"], 0)
        self.assert_status(self.row(), "WAITING_DATA", "WAITING_DATA")
        self.assertEqual(self.get()["confirmations"], [])

    def test_reconciliation_get_does_not_mutate_attendance_or_create_admin_records(self):
        from app.models import AttendanceDataConfirmation, AttendanceSessionOverride

        record = self.punch("08:15", "17:00")
        self.leave("LATE_MORNING")
        self.assertEqual(self.row()["morning"]["status"], "EXCUSED_LATE")
        self.assertFalse(self.db.is_modified(record))
        self.db.commit()
        self.db.expire_all()
        self.assertIsNone(self.db.get(Attendance, record.id).is_late_override)
        self.assertEqual(self.db.query(AttendanceSessionOverride).count(), 0)
        self.assertEqual(self.db.query(AttendanceDataConfirmation).count(), 0)
        self.assertEqual(self.db.query(ActivityLog).count(), 0)

    def test_latest_approved_schedule_changes_duty_instead_of_creating_paid_leave(self):
        self.leave("MORNING", source="SCHEDULE", created_at=datetime(2026, 11, 1))
        self.leave("AFTERNOON", source="SCHEDULE", created_at=datetime(2026, 11, 2))
        row = self.row()
        self.assert_status(row, "WAITING_DATA", "NOT_SCHEDULED")
        self.assertIsNone(row["afternoon"]["permission_source"])
        self.leave("FULL", LeaveStatus.PENDING, source="SCHEDULE", created_at=datetime(2026, 11, 3))
        self.assert_status(self.row(), "WAITING_DATA", "NOT_SCHEDULED")

    def test_roster_excludes_inactive_unapproved_and_foreign_users(self):
        self.user(4, is_active=False)
        self.user(5, is_approved=False)
        self.db.commit()
        self.assertEqual({row["user_id"] for row in self.get()["rows"]}, {1, 2})

    def test_employee_reads_are_forced_to_self_while_senior_can_read_team(self):
        self.current = self.staff
        rows = self.get(user=self.admin)["rows"]
        self.assertEqual({row["user_id"] for row in rows}, {self.staff.id})
        self.current = self.user(4, UserRole.DIRECTOR)
        self.db.commit()
        self.assertIn(self.staff.id, {row["user_id"] for row in self.get()["rows"]})
        self.assertEqual(self.get(user=self.other)["rows"], [])

    def test_read_recomputes_after_approval_and_withdrawal_without_mutating_punches(self):
        record = self.punch("08:15", "17:00")
        request = self.leave("LATE_MORNING", LeaveStatus.PENDING)
        self.assertEqual(self.row()["morning"]["status"], "PENDING_APPROVAL")
        request.status = LeaveStatus.APPROVED
        self.db.commit()
        self.assertEqual(self.row()["morning"]["status"], "EXCUSED_LATE")
        request.status = LeaveStatus.CANCELED
        self.db.commit()
        self.assertEqual(self.row()["morning"]["status"], "UNEXCUSED_LATE")
        self.db.expire_all()
        self.assertIsNone(self.db.get(Attendance, record.id).is_late_override)
        self.assertEqual(self.db.get(Attendance, record.id).check_in, datetime(2026, 11, 5, 8, 15))
        self.assertEqual(self.db.query(ActivityLog).count(), 0)

    def test_only_admin_can_record_permissions_or_data_coverage(self):
        for role in (UserRole.FIELD_STAFF, UserRole.MANAGER_MID, UserRole.MANAGER, UserRole.DIRECTOR):
            with self.subTest(role=role):
                self.staff.role = role
                self.db.commit()
                self.current = self.staff
                self.assertEqual(self.override().status_code, 403)
                self.assertEqual(self.confirm().status_code, 403)

    def test_admin_cannot_override_foreign_user_and_coverage_is_tenant_scoped(self):
        self.assertEqual(self.override(user=self.other).status_code, 404)
        self.assertEqual(self.confirm().status_code, 200)
        self.current = self.other
        row = self.row(user=self.other)
        self.assert_status(row, "WAITING_DATA", "WAITING_DATA")
        self.assertEqual(self.get()["confirmations"], [])

    def test_admin_permission_preserves_real_punches_and_records_reset_history(self):
        record = self.punch("08:15", "17:00")
        response = self.override()
        self.assertEqual(response.status_code, 200, response.text)
        row = response.json()
        self.assertEqual(row["morning"]["status"], "EXCUSED_LATE")
        self.assertEqual(row["morning"]["permission_source"], "ADMIN")
        self.assertEqual(row["morning"]["override"]["approved_by"], "Director Nguyen")
        self.assertTrue(row["morning"]["override"]["recorded_by"])
        logs = self.db.query(ActivityLog).all()
        self.assertEqual(len(logs), 1)
        self.assertEqual(logs[0].company_id, self.admin.company_id)
        self.assertEqual(logs[0].user_id, self.admin.id)
        self.assertIn("EXCUSED_LATE", logs[0].detail)
        self.assertIn("Client visit approved", logs[0].detail)
        self.assertIn("Director Nguyen", logs[0].detail)
        response = self.override(decision=None, reason="Return to automatic")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["morning"]["status"], "UNEXCUSED_LATE")
        self.assertEqual(self.db.query(ActivityLog).count(), 2)
        self.db.expire_all()
        persisted = self.db.get(Attendance, record.id)
        self.assertEqual(persisted.check_in, datetime(2026, 11, 5, 8, 15))
        self.assertEqual(persisted.check_out, datetime(2026, 11, 5, 17, 0))
        self.assertIsNone(persisted.is_late_override)

    def test_admin_can_excuse_absence_without_inventing_attendance(self):
        response = self.override(decision="EXCUSED_ABSENCE")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["morning"]["status"], "EXCUSED_ABSENCE")
        self.assertIsNone(response.json()["attendance_id"])
        self.assertEqual(self.db.query(Attendance).count(), 0)

    def test_explicit_reset_retires_legacy_permission_only_for_matching_session(self):
        record = self.punch("08:15", "17:00")
        record.is_late_override = False
        self.db.commit()
        self.assertEqual(self.row()["morning"]["status"], "EXCUSED_LATE")

        response = self.override(decision=None, reason="Legacy morning permission revoked")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["morning"]["status"], "UNEXCUSED_LATE")
        self.db.expire_all()
        record = self.db.get(Attendance, record.id)
        self.assertIs(record.is_late_override, False)
        self.assertEqual(record.check_in, datetime(2026, 11, 5, 8, 15))
        self.assertEqual(record.check_out, datetime(2026, 11, 5, 17, 0))
        self.assertEqual(self.row()["morning"]["status"], "UNEXCUSED_LATE")

        # A reset for AM must not silently retire an independent PM legacy permission.
        record.check_in = datetime(2026, 11, 5, 13, 45)
        self.db.commit()
        self.assertEqual(self.row()["afternoon"]["status"], "EXCUSED_LATE")
        response = self.override(session="PM", decision=None, reason="Legacy afternoon permission revoked")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["afternoon"]["status"], "UNEXCUSED_LATE")
        self.db.expire_all()
        record = self.db.get(Attendance, record.id)
        self.assertIs(record.is_late_override, False)
        self.assertEqual(record.check_in, datetime(2026, 11, 5, 13, 45))
        self.assertEqual(record.check_out, datetime(2026, 11, 5, 17, 0))
        logs = self.db.query(ActivityLog).order_by(ActivityLog.id).all()
        self.assertEqual(len(logs), 2)
        self.assertIn("Legacy morning permission revoked", logs[0].detail)
        self.assertIn("Legacy afternoon permission revoked", logs[1].detail)

    def test_pure_assessor_explicit_reset_supersedes_legacy_permission(self):
        from app.models import AttendanceSessionOverride
        from app.services.attendance_reconciliation import assess_day

        record = self.punch("08:15", "17:00")
        record.is_late_override = False
        self.db.commit()
        reset = AttendanceSessionOverride(company_id=1, user_id=self.staff.id, work_date=DAY,
            session="AM", decision=None, reason="Legacy permission revoked",
            approved_by="Director Nguyen", recorded_by_id=self.admin.id)
        self.assertEqual(assess_day(self.staff, DAY, record, [], [], [], NOW)["morning"]["status"],
                         "EXCUSED_LATE")
        result = assess_day(self.staff, DAY, record, [], [reset], [], NOW)
        self.assertEqual(result["morning"]["status"], "UNEXCUSED_LATE")
        self.assertIs(record.is_late_override, False)
        self.assertFalse(self.db.is_modified(record))

    def test_permission_and_audit_rollback_together_if_audit_insert_fails(self):
        from app.models import AttendanceSessionOverride

        self.punch("08:15", "17:00")
        def fail_audit(*args):
            raise RuntimeError("Injected audit write failure")

        event.listen(ActivityLog, "before_insert", fail_audit)
        try:
            with self.assertRaises(RuntimeError):
                self.override()
        finally:
            event.remove(ActivityLog, "before_insert", fail_audit)
        self.db.rollback()
        self.assertEqual(self.db.query(AttendanceSessionOverride).count(), 0)
        self.assertEqual(self.db.query(ActivityLog).count(), 0)

    def test_coverage_and_audit_rollback_together_if_audit_insert_fails(self):
        from app.models import AttendanceDataConfirmation

        def fail_audit(*args):
            raise RuntimeError("Injected coverage audit write failure")

        event.listen(ActivityLog, "before_insert", fail_audit)
        try:
            with self.assertRaises(RuntimeError):
                self.confirm()
        finally:
            event.remove(ActivityLog, "before_insert", fail_audit)
        self.db.rollback()
        self.assertEqual(self.db.query(AttendanceDataConfirmation).count(), 0)
        self.assertEqual(self.db.query(ActivityLog).count(), 0)

    def test_updating_permission_reuses_session_record_and_audits_both_values(self):
        from app.models import AttendanceSessionOverride

        self.punch("08:15", "17:00")
        self.assertEqual(self.override().status_code, 200)
        self.assertEqual(self.override(reason="Additional evidence", approved_by="Director Tran").status_code, 200)
        self.assertEqual(self.db.query(AttendanceSessionOverride).count(), 1)
        logs = self.db.query(ActivityLog).order_by(ActivityLog.id).all()
        self.assertEqual(len(logs), 2)
        for detail in ("Client visit approved", "Additional evidence", "Director Nguyen", "Director Tran"):
            self.assertIn(detail, logs[-1].detail)

    def test_required_reason_authorizer_and_supported_sessions_decisions(self):
        for payload in ({"reason": ""}, {"reason": "   "}, {"approved_by": ""},
                        {"approved_by": "   "}, {"session": "FULL"}, {"decision": "PRESENT"}):
            with self.subTest(payload=payload):
                self.assertIn(self.override(**payload).status_code, (400, 422))
        for payload in ({"reason": ""}, {"reason": "   "}, {"session": "FULL"}):
            with self.subTest(payload=payload):
                self.assertIn(self.confirm(**payload).status_code, (400, 422))

    def test_dates_and_range_validation(self):
        for params in ({"from_date": "2026-11-06", "to_date": "2026-11-05"},
                       {"from_date": "2026-10-01", "to_date": "2026-11-01"},
                       {"from_date": "not-a-date", "to_date": "2026-11-05"}):
            with self.subTest(params=params):
                response = self.client.get("/attendance/reconciliation", params=params)
                self.assertIn(response.status_code, (400, 422))
        self.assertEqual(self.client.get("/attendance/reconciliation", params={
            "from_date": "2026-10-06", "to_date": "2026-11-05"}).status_code, 200)

    def test_future_overrides_and_coverage_are_rejected(self):
        tomorrow = date(2026, 11, 7)
        self.assertIn(self.override(day=tomorrow).status_code, (400, 422))
        self.assertIn(self.confirm(day=tomorrow).status_code, (400, 422))
        self.assertEqual(self.db.query(ActivityLog).count(), 0)

    def test_coverage_cannot_be_confirmed_before_session_ends(self):
        with patch("app.services.attendance_reconciliation.vn_now", return_value=datetime(2026, 11, 6, 10, 0)), \
             patch("app.routers.attendance.vn_now", return_value=datetime(2026, 11, 6, 10, 0)):
            self.assertIn(self.confirm(day=date(2026, 11, 6)).status_code, (400, 422))
            available = self.get(date(2026, 11, 6))["confirmation_available"]
            self.assertFalse(available["AM"])
            self.assertFalse(available["PM"])
        with patch("app.services.attendance_reconciliation.vn_now", return_value=datetime(2026, 11, 6, 12, 0)), \
             patch("app.routers.attendance.vn_now", return_value=datetime(2026, 11, 6, 12, 0)):
            self.assertEqual(self.confirm(day=date(2026, 11, 6)).status_code, 200)
            self.assertIn(self.confirm(day=date(2026, 11, 6), session="PM").status_code, (400, 422))

    def test_administrative_permission_survives_machine_resync(self):
        from app.services import yunatt_service

        self.staff.yunatt_code = "02"
        self.punch("08:15", "17:00")
        self.assertEqual(self.override().status_code, 200)
        punches = [{"staff_number": "02", "staff_name": self.staff.full_name,
                    "timestamp": datetime(2026, 11, 5, hour, minute)}
                   for hour, minute in ((8, 15), (17, 30))]
        with patch.object(yunatt_service, "fetch_months", return_value=([], punches)):
            yunatt_service.run_sync(self.db, 1, months=["2026-11"])
        row = self.row()
        self.assertEqual(row["morning"]["status"], "EXCUSED_LATE")
        self.assertEqual(row["morning"]["permission_source"], "ADMIN")
        self.assertEqual(self.db.query(ActivityLog).count(), 1)

    def test_legacy_attendance_get_does_not_apply_afternoon_permission_to_morning_arrival(self):
        self.punch("08:15", "17:00")
        self.leave("LATE_AFTERNOON")
        response = self.client.get("/attendance", params={"work_date": DAY.isoformat()})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(response.json()), 1)
        self.assertTrue(response.json()[0]["is_late"])

    def test_legacy_attendance_get_does_not_apply_morning_permission_to_afternoon_arrival(self):
        self.punch("13:45", "17:00")
        self.leave("LATE_MORNING")
        response = self.client.get("/attendance", params={"work_date": DAY.isoformat()})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()[0]["is_late"])

    def test_legacy_attendance_and_summary_keep_lateness_after_allowed_arrival_time(self):
        self.punch("08:31", "17:00")
        self.leave("LATE_MORNING", allowed_arrival_time="08:30")
        response = self.client.get("/attendance", params={"work_date": DAY.isoformat()})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()[0]["is_late"])
        response = self.client.get("/attendance/summary", params={"period": "2026-11"})
        self.assertEqual(response.status_code, 200, response.text)
        summary = next(row for row in response.json() if row["user_id"] == self.staff.id)
        self.assertEqual(summary["late_days"], 1)

    def test_legacy_get_permission_is_read_only_and_canceled_permission_is_recomputed(self):
        record = self.punch("08:15", "17:00")
        request = self.leave("LATE_MORNING")
        response = self.client.get("/attendance", params={"work_date": DAY.isoformat()})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(response.json()[0]["is_late"])
        self.assertFalse(self.db.is_modified(record))
        self.db.commit()
        self.db.expire_all()
        self.assertIsNone(self.db.get(Attendance, record.id).is_late_override)
        request.status = LeaveStatus.CANCELED
        self.db.commit()
        response = self.client.get("/attendance", params={"work_date": DAY.isoformat()})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()[0]["is_late"])
        self.assertEqual(self.row()["morning"]["status"], "UNEXCUSED_LATE")
        self.db.commit()
        self.db.expire_all()
        self.assertIsNone(self.db.get(Attendance, record.id).is_late_override)

    def test_company_coverage_waits_for_all_active_personal_shifts_to_finish(self):
        self.staff.work_end = "18:00"
        self.db.commit()
        today = date(2026, 11, 6)
        with patch("app.services.attendance_reconciliation.vn_now", return_value=datetime(2026, 11, 6, 17, 15)):
            result = self.get(today)
            self.assertFalse(result["confirmation_available"]["PM"])
            self.assertIn(self.confirm(day=today, session="PM").status_code, (400, 422))
            self.assertEqual(self.row(today)["afternoon"]["status"], "NOT_FINISHED")
        with patch("app.services.attendance_reconciliation.vn_now", return_value=datetime(2026, 11, 6, 18, 0)):
            self.assertTrue(self.get(today)["confirmation_available"]["PM"])
            self.assertEqual(self.confirm(day=today, session="PM").status_code, 200)

    def test_coverage_closure_ignores_foreign_inactive_and_unapproved_personal_shifts(self):
        self.other.work_end = "22:00"
        self.user(4, work_end="21:00", is_active=False)
        self.user(5, work_end="20:00", is_approved=False)
        self.db.commit()
        today = date(2026, 11, 6)
        with patch("app.services.attendance_reconciliation.vn_now", return_value=datetime(2026, 11, 6, 17, 15)):
            self.assertTrue(self.get(today)["confirmation_available"]["PM"])
            self.assertEqual(self.confirm(day=today, session="PM").status_code, 200)

    def test_personal_morning_only_work_end_excludes_afternoon_duty(self):
        self.staff.work_end = "11:45"
        self.punch("08:00", "11:45")
        self.assertEqual(self.confirm(session="PM").status_code, 200)
        self.assert_status(self.row(), "PRESENT", "NOT_SCHEDULED")

    def test_later_machine_data_replaces_absence_assessment_on_next_read(self):
        self.assertEqual(self.confirm().status_code, 200)
        self.assertEqual(self.confirm(session="PM").status_code, 200)
        self.assert_status(self.row(), "UNEXCUSED_ABSENCE", "UNEXCUSED_ABSENCE")
        self.punch("08:00", "17:00")
        self.assert_status(self.row(), "PRESENT", "PRESENT")
        self.assertEqual(len(self.get()["confirmations"]), 2)

    def submit_late_leave(self, **kw):
        self.current = self.staff
        return self.client.post("/leave", json={
            "from_date": "2026-11-07", "to_date": "2026-11-07", "leave_type": "LATE_MORNING",
            "reason": "Medical appointment", "allowed_arrival_time": "08:30", **kw})

    def test_leave_api_persists_allowed_arrival_time_and_returns_it_in_detail(self):
        response = self.submit_late_leave()
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()["allowed_arrival_time"], "08:30")
        leave_id = response.json()["id"]
        self.db.expire_all()
        self.assertEqual(self.db.get(LeaveRequest, leave_id).allowed_arrival_time, "08:30")
        detail = self.client.get(f"/leave/{leave_id}")
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertEqual(detail.json()["allowed_arrival_time"], "08:30")
        self.zalo.send_request.assert_called_once()

    def test_leave_api_rejects_malformed_arrival_times(self):
        for value in ("8:30", "24:00", "08:60", "not-a-time", ""):
            with self.subTest(value=value):
                self.assertEqual(self.submit_late_leave(allowed_arrival_time=value).status_code, 422)
        self.assertEqual(self.db.query(LeaveRequest).count(), 0)
        self.zalo.send_request.assert_not_called()

    def test_leave_api_rejects_arrival_time_in_wrong_session(self):
        self.assertEqual(self.submit_late_leave(allowed_arrival_time="13:45").status_code, 400)
        self.assertEqual(self.submit_late_leave(leave_type="LATE_AFTERNOON", allowed_arrival_time="08:30").status_code, 400)
        self.assertEqual(self.db.query(LeaveRequest).count(), 0)
        self.zalo.send_request.assert_not_called()

    def test_leave_api_rejects_arrival_time_for_non_late_request(self):
        self.assertEqual(self.submit_late_leave(leave_type="MORNING").status_code, 400)
        self.assertEqual(self.db.query(LeaveRequest).count(), 0)
        self.zalo.send_request.assert_not_called()

    def test_leave_api_keeps_omitted_arrival_time_compatible_with_legacy_clients(self):
        self.current = self.staff
        response = self.client.post("/leave", json={"from_date": "2026-11-07", "to_date": "2026-11-07",
            "leave_type": "LATE_MORNING", "reason": "Legacy client request"})
        self.assertEqual(response.status_code, 201, response.text)
        self.assertIsNone(response.json()["allowed_arrival_time"])


if __name__ == "__main__":
    unittest.main()
