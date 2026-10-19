"""Owners can withdraw only pending leave; approval and withdrawal are exclusive."""
import os
import unittest
from datetime import date, timedelta
from unittest.mock import Mock, patch

os.environ["DATABASE_URL"] = "sqlite+pysqlite:///:memory:"
os.environ["DEBUG"] = "true"

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, update
from sqlalchemy.orm import Query, sessionmaker
from sqlalchemy.dialects import postgresql
from sqlalchemy.pool import StaticPool
from app.database import Base, get_db
from app.deps import get_current_user
from app.models import ActivityLog, Company, LeaveRequest, LeaveStatus, User, UserRole
from app.routers.leave import router
from app.services.leave_zalo_service import get_leave_zalo_service


class LeaveWithdrawalTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)
        with self.sessions() as db:
            company = Company(name="Withdrawal", code="WITHDRAW")
            other_company = Company(name="Other", code="WITHDRAW-OTHER")
            db.add_all([company, other_company]); db.flush()
            self.owner = User(company_id=company.id, email="owner@example.invalid", full_name="Owner",
                hashed_password="unused", role=UserRole.FIELD_STAFF)
            self.other = User(company_id=company.id, email="other@example.invalid", full_name="Other",
                hashed_password="unused", role=UserRole.FIELD_STAFF)
            self.manager = User(company_id=company.id, email="manager@example.invalid", full_name="Manager",
                hashed_password="unused", role=UserRole.DIRECTOR)
            self.outsider = User(company_id=other_company.id, email="outsider@example.invalid", full_name="Outsider",
                hashed_password="unused", role=UserRole.ADMIN)
            db.add_all([self.owner, self.other, self.manager, self.outsider]); db.commit()
        self.current = self.owner
        self.zalo = Mock()
        self.race = False
        self.race_status = LeaveStatus.APPROVED
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_current_user] = lambda: self.current
        app.dependency_overrides[get_db] = self.db_dependency
        app.dependency_overrides[get_leave_zalo_service] = lambda: self.zalo
        self.client = TestClient(app)

    def db_dependency(self):
        with self.sessions() as db:
            if self.race:
                original = db.execute
                def execute(statement, *args, **kwargs):
                    if self.race and getattr(statement, "is_update", False):
                        self.race = False
                        # The handler already read PENDING. Simulate a decision
                        # committing before its conditional withdrawal write.
                        db.connection().execute(update(LeaveRequest).where(LeaveRequest.id == self.race_id)
                            .values(status=self.race_status))
                        db.commit()
                    return original(statement, *args, **kwargs)
                db.execute = execute
            yield db

    def tearDown(self):
        self.client.close()
        self.engine.dispose()

    def make_leave(self, status=LeaveStatus.PENDING, source="LEAVE"):
        day = date.today() + timedelta(days=3)
        with self.sessions() as db:
            row = LeaveRequest(company_id=self.owner.company_id, user_id=self.owner.id,
                from_date=day, to_date=day, status=status, source=source, reason="Test")
            db.add(row); db.commit()
            return row.id

    def withdraw(self, leave_id):
        return self.client.post(f"/leave/{leave_id}/withdraw")

    def test_owner_withdraws_pending_leave_and_history_is_retained(self):
        leave_id = self.make_leave()
        with patch("app.routers.leave.publish") as publish:
            response = self.withdraw(leave_id)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["status"], "CANCELED")
        self.assertIsNone(response.json()["decided_by_id"])
        mine = self.client.get("/leave/me").json()
        self.assertEqual(mine[0]["status"], "CANCELED")
        with self.sessions() as db:
            self.assertIsNotNone(db.get(LeaveRequest, leave_id))
            self.assertEqual(db.query(ActivityLog).filter_by(action="leave.withdraw").count(), 1)
        self.assertIn((self.owner.company_id, "leave"), [call.args for call in publish.call_args_list])
        self.zalo.send_decision.assert_not_called()

    def test_other_employee_approver_and_other_company_cannot_withdraw(self):
        leave_id = self.make_leave()
        for user in (self.other, self.manager, self.outsider):
            self.current = user
            self.assertEqual(self.withdraw(leave_id).status_code, 404)
        self.current = self.owner
        self.assertEqual(self.client.get(f"/leave/{leave_id}").json()["status"], "PENDING")

    def test_processed_and_repeated_withdrawals_are_rejected(self):
        for status in (LeaveStatus.APPROVED, LeaveStatus.REJECTED):
            self.assertEqual(self.withdraw(self.make_leave(status)).status_code, 409)
        leave_id = self.make_leave()
        self.assertEqual(self.withdraw(leave_id).status_code, 200)
        self.assertEqual(self.withdraw(leave_id).status_code, 409)

    def test_student_schedule_cannot_use_leave_withdrawal(self):
        self.assertEqual(self.withdraw(self.make_leave(source="SCHEDULE")).status_code, 400)

    def test_approval_wins_stale_withdrawal(self):
        self.race_id = self.make_leave()
        self.race = True
        self.assertEqual(self.withdraw(self.race_id).status_code, 409)
        self.assertEqual(self.client.get(f"/leave/{self.race_id}").json()["status"], "APPROVED")

    def test_withdrawal_wins_and_approver_sees_new_status(self):
        leave_id = self.make_leave()
        self.assertEqual(self.withdraw(leave_id).status_code, 200)
        self.current = self.manager
        self.assertEqual(self.client.get("/leave?status=PENDING").json(), [])
        response = self.client.post(f"/leave/{leave_id}/decide", json={"status": "APPROVED"})
        self.assertEqual(response.status_code, 409)
        self.zalo.send_decision.assert_not_called()

    def test_owner_cannot_bypass_status_guard_using_old_delete_endpoint(self):
        leave_id = self.make_leave(LeaveStatus.APPROVED)
        self.assertEqual(self.client.delete(f"/leave/{leave_id}").status_code, 409)
        pending_id = self.make_leave()
        self.assertEqual(self.client.delete(f"/leave/{pending_id}").status_code, 200)
        self.assertEqual(self.client.get(f"/leave/{pending_id}").json()["status"], "CANCELED")

    def test_existing_student_schedule_delete_still_works(self):
        leave_id = self.make_leave(LeaveStatus.APPROVED, "SCHEDULE")
        self.assertEqual(self.client.delete(f"/leave/{leave_id}").status_code, 200)
        with self.sessions() as db:
            self.assertIsNone(db.get(LeaveRequest, leave_id))

    def test_legacy_null_source_is_withdrawable_and_remains_in_my_history(self):
        leave_id = self.make_leave()
        with self.sessions() as db:
            db.execute(update(LeaveRequest).where(LeaveRequest.id == leave_id).values(source=None))
            db.commit()
        self.assertEqual(self.withdraw(leave_id).status_code, 200)
        self.assertEqual(self.client.get("/leave/me").json()[0]["status"], "CANCELED")

    def test_withdrawal_can_win_after_approver_already_read_pending(self):
        self.race_id = self.make_leave()
        self.race_status = LeaveStatus.CANCELED
        self.race = True
        self.current = self.manager
        response = self.client.post(f"/leave/{self.race_id}/decide", json={"status": "APPROVED"})
        self.assertEqual(response.status_code, 409)
        self.zalo.send_decision.assert_not_called()

    def test_approver_cannot_use_decision_action_to_withdraw_other_users_leave(self):
        leave_id = self.make_leave()
        self.current = self.manager
        response = self.client.post(f"/leave/{leave_id}/decide", json={"status": "CANCELED"})
        self.assertEqual(response.status_code, 400)

    def test_student_schedule_all_day_does_not_delete_withdrawn_history(self):
        leave_id = self.make_leave()
        self.assertEqual(self.withdraw(leave_id).status_code, 200)
        day = (date.today() + timedelta(days=3)).isoformat()
        response = self.client.post("/leave/student-week-schedule", json={"days": [{"date": day, "shift": "ALL_DAY"}]})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.client.get(f"/leave/{leave_id}").json()["status"], "CANCELED")

    def test_student_schedule_locks_selected_leaves_until_its_write_commits(self):
        self.make_leave()
        day = (date.today() + timedelta(days=3)).isoformat()
        selected = []
        original_all = Query.all

        def capture(query):
            if query.column_descriptions[0].get("entity") is LeaveRequest:
                selected.append(str(query.statement.compile(dialect=postgresql.dialect())))
            return original_all(query)

        with patch.object(Query, "all", capture):
            response = self.client.post("/leave/student-week-schedule", json={"days": [{"date": day, "shift": "OFF"}]})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(selected), 1)
        # SQLite cannot enforce row locks. Verify the actual query emitted by
        # this handler acquires them when compiled for the production database.
        self.assertIn("FOR UPDATE", selected[0])

    def test_student_schedule_off_creates_separate_row_and_does_not_revive_withdrawn_id(self):
        leave_id = self.make_leave()
        self.assertEqual(self.withdraw(leave_id).status_code, 200)
        day = (date.today() + timedelta(days=3)).isoformat()
        response = self.client.post("/leave/student-week-schedule", json={"days": [{"date": day, "shift": "OFF"}]})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertNotEqual(response.json()[0]["id"], leave_id)
        self.assertEqual(response.json()[0]["source"], "SCHEDULE")
        self.assertEqual(self.client.get(f"/leave/{leave_id}").json()["status"], "CANCELED")
