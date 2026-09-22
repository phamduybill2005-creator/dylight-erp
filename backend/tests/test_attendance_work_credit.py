"""CÔNG THEO CA (Attendance.work_credit) và việc API trả work_credit cho TỪNG NGÀY.

Quy tắc (models.Attendance.work_credit): ca sáng 08:00–11:45, ca chiều 13:30–17:00,
mỗi ca 0.5 công. Có mặt sáng = giờ vào <= 11:45; có mặt chiều = giờ ra >= 13:30
(thiếu giờ ra thì xét giờ vào >= 13:30). Có chấm mà không rơi vào ca nào -> 0.5.
Màn "Chấm công của tôi" cộng work_credit từng ngày -> khớp bảng tổng hợp của quản lý.

Chạy từ thư mục backend: python -m unittest tests.test_attendance_work_credit -v
"""
import os
import unittest
from datetime import date, datetime
from decimal import Decimal

os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")
os.environ.setdefault("DEBUG", "true")

from app.models import Attendance, AttendanceSource
from app.schemas import AttendanceOut

DAY = date(2026, 9, 15)


def rec(check_in: tuple[int, int], check_out: tuple[int, int] | None = None) -> Attendance:
    return Attendance(
        id=1, company_id=1, user_id=1, work_date=DAY, source=AttendanceSource.MANUAL,
        check_in=datetime(DAY.year, DAY.month, DAY.day, *check_in),
        check_out=datetime(DAY.year, DAY.month, DAY.day, *check_out) if check_out else None,
        created_at=datetime(DAY.year, DAY.month, DAY.day, 7, 0),
    )


class WorkCreditTests(unittest.TestCase):
    def test_chi_lam_sang_ra_truoc_13h30_la_nua_cong(self):
        self.assertEqual(rec((7, 52), (11, 52)).work_credit, Decimal("0.5"))
        # Ra 12:42 vẫn trước mốc vào ca chiều -> vẫn 0.5 dù làm 4 giờ.
        self.assertEqual(rec((7, 45), (12, 42)).work_credit, Decimal("0.5"))

    def test_lam_ca_ngay_la_mot_cong(self):
        self.assertEqual(rec((7, 52), (17, 8)).work_credit, Decimal("1"))
        # Ra đúng mốc 13:30 đã tính có mặt buổi chiều.
        self.assertEqual(rec((8, 0), (13, 30)).work_credit, Decimal("1"))

    def test_chi_lam_chieu_la_nua_cong(self):
        self.assertEqual(rec((13, 40), (17, 0)).work_credit, Decimal("0.5"))
        # Chưa có giờ ra: suy theo giờ vào buổi chiều.
        self.assertEqual(rec((13, 40)).work_credit, Decimal("0.5"))

    def test_cham_vao_giua_trua_khong_roi_ca_nao_van_toi_thieu_nua_cong(self):
        self.assertEqual(rec((12, 0)).work_credit, Decimal("0.5"))

    def test_api_tra_work_credit_tung_ngay(self):
        self.assertEqual(AttendanceOut.model_validate(rec((7, 52), (11, 52))).work_credit, 0.5)
        self.assertEqual(AttendanceOut.model_validate(rec((7, 52), (17, 8))).work_credit, 1.0)

    def test_tong_thang_theo_ca_khop_bang_tong_hop(self):
        # 11 ngày chỉ làm sáng + 1 ngày cả ngày = 6.5 công (ví dụ tháng 9/2026 trong màn hình).
        days = [rec((7, 50), (11, 50)) for _ in range(11)] + [rec((7, 52), (17, 8))]
        self.assertEqual(sum(float(r.work_credit) for r in days), 6.5)


if __name__ == "__main__":
    unittest.main()
