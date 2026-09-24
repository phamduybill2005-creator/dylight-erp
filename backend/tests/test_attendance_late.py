"""Kiểm thử tính đi trễ theo ca làm việc.

Luật (models.Attendance.is_late): chấm vào trước 11:45 = ca sáng -> so với giờ riêng
(work_start) hoặc 08:00; chấm vào sau 11:45 = ca chiều -> so với 13:30, kể cả người có
giờ riêng buổi sáng; giờ riêng chỉ dùng cho ca chiều khi bản thân nó là giờ buổi chiều.

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

    def test_ca_sang_theo_moc_chung_0800(self):
        self.assertFalse(self._record(8, 0).is_late)
        self.assertTrue(self._record(8, 1).is_late)

    def test_ca_chieu_moc_1330_den_som_khong_tre(self):
        # Vào sau 11:45 là ca chiều: 12:00 / 13:00 / 13:30 đều không trễ, 13:31 mới trễ.
        for h, m in ((12, 0), (13, 0), (13, 30)):
            self.assertFalse(self._record(h, m).is_late, f"{h:02d}:{m:02d}")
        self.assertTrue(self._record(13, 31).is_late)

    def test_gio_rieng_buoi_sang_chi_ap_dung_cho_ca_sang(self):
        self.assertFalse(self._record(8, 30, "08:30").is_late)
        self.assertTrue(self._record(8, 31, "08:30").is_late)
        # Người có giờ riêng 08:30 nhưng hôm đó làm ca chiều: so với 13:30, không phải 08:30.
        self.assertFalse(self._record(13, 0, "08:30").is_late)
        self.assertFalse(self._record(13, 30, "08:30").is_late)
        self.assertTrue(self._record(13, 31, "08:30").is_late)

    def test_gio_rieng_buoi_chieu_la_moc_cua_ca_chieu(self):
        self.assertFalse(self._record(13, 30, "13:30").is_late)
        self.assertFalse(self._record(13, 50, "14:00").is_late)
        self.assertTrue(self._record(14, 1, "14:00").is_late)

    def test_chu_nhat_va_de_trang_thai(self):
        sunday = self._record(9, 0)
        sunday.work_date = date(2026, 9, 20)   # Chủ nhật
        self.assertFalse(sunday.is_late)
        forced = self._record(8, 0)
        forced.is_late_override = True
        self.assertTrue(forced.is_late)


if __name__ == "__main__":
    unittest.main()
