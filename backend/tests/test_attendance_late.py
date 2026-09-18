"""Kiểm thử tính đi trễ theo ca làm việc.

Chạy từ thư mục backend: python -m unittest tests.test_attendance_late -v
"""
import os
import unittest
from datetime import date, datetime

os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")
os.environ.setdefault("DEBUG", "true")

from app.models import Attendance, User, UserRole


class AttendanceLateTests(unittest.TestCase):
    def _record(self, hour: int, minute: int, work_start: str | None = None) -> Attendance:
        user = User(
            company_id=1,
            email="staff@example.com",
            full_name="Nhân viên",
            role=UserRole.FIELD_STAFF,
            hashed_password="unused",
            work_start=work_start,
        )
        return Attendance(
            company_id=1,
            user_id=1,
            work_date=date(2026, 9, 15),
            check_in=datetime(2026, 9, 15, hour, minute),
            user=user,
        )

    def test_default_afternoon_shift_starts_at_1330(self):
        self.assertFalse(self._record(13, 30).is_late)
        self.assertTrue(self._record(13, 31).is_late)

    def test_explicit_work_start_remains_the_source_of_truth(self):
        self.assertFalse(self._record(13, 30, "13:30").is_late)
        self.assertTrue(self._record(13, 30, "08:30").is_late)


if __name__ == "__main__":
    unittest.main()
