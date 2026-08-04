"""
Script tạo dữ liệu mẫu (seed) để demo nhanh.
Chạy:  python -m app.seed
Tạo: 2 công ty, vài người dùng, gói thầu, dự án, hợp đồng, hóa đơn,
thanh toán và tiến độ — đủ để Dashboard hiển thị số liệu thật.

Tài khoản đăng nhập demo:
  - giamdoc@dosco.vn / 123456    (DIRECTOR — giao diện Giám đốc, thấy tài chính)
  - quanly@dosco.vn  / 123456    (MANAGER — giao diện Quản lý, ẩn doanh thu/lãi-lỗ)
  - ketoan@dosco.vn  / 123456    (ACCOUNTANT — cùng nhóm Quản lý)
  - hientruong@dosco.vn / 123456 (FIELD_STAFF — giao diện Nhân viên)
"""
from datetime import date, datetime, timedelta
from decimal import Decimal

from app.database import Base, SessionLocal, engine
from app.models import (
    Company, User, UserRole, Bid, BidStatus, Project, ProjectStatus,
    Contract, ContractStatus, Invoice, InvoiceStatus, Payment, PaymentType,
    PaymentDirection, Progress,
    Attendance, AttendanceSource, Evaluation, EvaluationDirection,
)
from app.security import hash_password


def run():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        if db.query(Company).first():
            print("Đã có dữ liệu — bỏ qua seed.")
            return

        # --- Công ty ---
        c1 = Company(name="DOSCO COMPANY LIMITED", code="DOSCO", tax_code="0101234567")
        c2 = Company(name="Chi nhánh Miền Nam DOSCO", code="DOSCO-HCM", tax_code="0107654321")
        db.add_all([c1, c2])
        db.flush()

        # --- Người dùng (công ty 1) ---
        giamdoc = User(company_id=c1.id, email="giamdoc@dosco.vn", full_name="Nguyễn Văn Giám",
                       hashed_password=hash_password("123456"), role=UserRole.DIRECTOR,
                       phone="0912345678", address="Hoàng Mai, Hà Nội", dob=date(1980, 5, 20),
                       identity_card="001080123456", cv_details="Giám đốc điều hành DOSCO")
        ketoan = User(company_id=c1.id, email="ketoan@dosco.vn", full_name="Trần Thị Kế",
                      hashed_password=hash_password("123456"), role=UserRole.ACCOUNTANT,
                      phone="0987654321", address="Thanh Xuân, Hà Nội", dob=date(1988, 10, 15),
                      identity_card="001088654321", cv_details="Kế toán trưởng với 10 năm kinh nghiệm")
        quanly = User(company_id=c1.id, email="quanly@dosco.vn", full_name="Phạm Văn Quản",
                      hashed_password=hash_password("123456"), role=UserRole.MANAGER,
                      phone="0911222333", address="Cầu Giấy, Hà Nội", dob=date(1985, 7, 8),
                      identity_card="001085222333", cv_details="Chỉ huy trưởng công trình, 12 năm kinh nghiệm")
        hientruong = User(company_id=c1.id, email="hientruong@dosco.vn", full_name="Lê Văn Trường",
                          hashed_password=hash_password("123456"), role=UserRole.FIELD_STAFF,
                          phone="0909090909", address="Sóc Sơn, Hà Nội", dob=date(1995, 3, 10),
                          identity_card="001095090909", cv_details="Kỹ sư hiện trường xây dựng cầu đường",
                          schedule="Ca sáng: 07:30 - 11:30 | Ca chiều: 13:00 - 17:00. Địa điểm: Cầu vượt sông Hồng.")
        admin_hcm = User(company_id=c2.id, email="admin@dosco.vn", full_name="Quản trị HCM",
                         hashed_password=hash_password("123456"), role=UserRole.ADMIN)

        db.add_all([giamdoc, ketoan, quanly, hientruong, admin_hcm])
        db.flush()

        # Thiết lập người quản lý trực tiếp
        quanly.manager_id = giamdoc.id
        ketoan.manager_id = giamdoc.id
        hientruong.manager_id = quanly.id

        # --- Gói thầu ---
        bid_won = Bid(company_id=c1.id, code="HSDT-2025-01", name="Cầu vượt sông Hồng - gói XL01",
                      investor="Ban QLDA Giao thông HN", package_value=Decimal("85000000000"),
                      status=BidStatus.WON, submit_date=date(2025, 2, 1), result_date=date(2025, 3, 1))
        bid_sub = Bid(company_id=c1.id, code="HSDT-2025-02", name="Đường vành đai 4 - đoạn 3",
                      investor="Sở GTVT", package_value=Decimal("120000000000"),
                      status=BidStatus.SUBMITTED, submit_date=date(2025, 5, 10))
        db.add_all([bid_won, bid_sub])
        db.flush()

        # --- Dự án ---
        p1 = Project(company_id=c1.id, bid_id=bid_won.id, code="DA-CAU-01",
                     name="Cầu vượt sông Hồng", location="Hà Nội", manager_name="KS. Phạm Minh",
                     status=ProjectStatus.IN_PROGRESS, start_date=date(2025, 4, 1))
        p2 = Project(company_id=c1.id, code="DA-TRUONG-02", name="Trường THPT Đông Anh",
                     location="Đông Anh, HN", manager_name="KS. Vũ Hà",
                     status=ProjectStatus.IN_PROGRESS, start_date=date(2025, 1, 15))
        db.add_all([p1, p2])
        db.flush()

        # --- Hợp đồng ---
        ct1 = Contract(company_id=c1.id, project_id=p1.id, code="HD-01/2025", name="Thi công phần cầu",
                       partner="Ban QLDA Giao thông HN", value_no_vat=Decimal("78000000000"),
                       vat_percent=Decimal("10"), status=ContractStatus.ACTIVE, sign_date=date(2025, 3, 20))
        ct2 = Contract(company_id=c1.id, project_id=p2.id, code="HD-02/2025", name="Xây lắp nhà 4 tầng",
                       partner="UBND huyện Đông Anh", value_no_vat=Decimal("32000000000"),
                       vat_percent=Decimal("10"), status=ContractStatus.ACTIVE, sign_date=date(2025, 1, 5))
        db.add_all([ct1, ct2])
        db.flush()

        # --- Hóa đơn đã duyệt (tính vào chi phí) ---
        db.add_all([
            Invoice(company_id=c1.id, project_id=p1.id, contract_id=ct1.id,
                    supplier_name="Công ty CP Bê tông Thăng Long", supplier_tax_code="0312345678",
                    invoice_number="1C25TLT/0451", invoice_date=date(2025, 5, 2),
                    amount_no_vat=Decimal("4200000000"), vat_amount=Decimal("420000000"),
                    total_amount=Decimal("4620000000"), category="vật tư",
                    status=InvoiceStatus.VERIFIED, ocr_confidence=Decimal("96")),
            Invoice(company_id=c1.id, project_id=p1.id, contract_id=ct1.id,
                    supplier_name="DNTN Xăng dầu Petrolimex CN5", supplier_tax_code="0109876543",
                    invoice_number="2C25PB/1180", invoice_date=date(2025, 5, 18),
                    amount_no_vat=Decimal("680000000"), vat_amount=Decimal("68000000"),
                    total_amount=Decimal("748000000"), category="nhiên liệu",
                    status=InvoiceStatus.VERIFIED, ocr_confidence=Decimal("91")),
            Invoice(company_id=c1.id, project_id=p2.id, contract_id=ct2.id,
                    supplier_name="Công ty TNHH Vật tư Xây dựng Hòa Phát", supplier_tax_code="0301234567",
                    invoice_number="5C25HP/2210", invoice_date=date(2025, 4, 25),
                    amount_no_vat=Decimal("2100000000"), vat_amount=Decimal("210000000"),
                    total_amount=Decimal("2310000000"), category="vật tư",
                    status=InvoiceStatus.VERIFIED, ocr_confidence=Decimal("94")),
            # Hóa đơn vừa AI bóc tách, đang chờ kế toán duyệt
            Invoice(company_id=c1.id, project_id=p1.id, contract_id=ct1.id,
                    supplier_name="Công ty CP Vận tải Sông Hồng", supplier_tax_code="0107778899",
                    invoice_number="3C25SH/0099", invoice_date=date(2025, 6, 1),
                    amount_no_vat=Decimal("150000000"), vat_amount=Decimal("15000000"),
                    total_amount=Decimal("165000000"), category="vận chuyển",
                    status=InvoiceStatus.EXTRACTED, ocr_confidence=Decimal("87")),
        ])

        # --- Thanh toán (tiền thu về) ---
        db.add_all([
            Payment(company_id=c1.id, contract_id=ct1.id, code="TT-01", payment_type=PaymentType.ADVANCE,
                    direction=PaymentDirection.IN, amount=Decimal("23400000000"),
                    payment_date=date(2025, 4, 5), note="Tạm ứng 30%"),
            Payment(company_id=c1.id, contract_id=ct2.id, code="TT-02", payment_type=PaymentType.PROGRESS,
                    direction=PaymentDirection.IN, amount=Decimal("9600000000"),
                    payment_date=date(2025, 5, 20), note="Thanh toán đợt 1"),
        ])

        # --- Tiến độ ---
        today = date.today()
        db.add_all([
            Progress(company_id=c1.id, project_id=p1.id, title="Thi công móng trụ T1-T4",
                     percent_complete=Decimal("100"), planned_date=today - timedelta(days=20),
                     actual_date=today - timedelta(days=18)),
            Progress(company_id=c1.id, project_id=p1.id, title="Đúc dầm nhịp giữa",
                     percent_complete=Decimal("45"), planned_date=today + timedelta(days=15)),
            Progress(company_id=c1.id, project_id=p2.id, title="Hoàn thiện tầng 2",
                     percent_complete=Decimal("70"), planned_date=today + timedelta(days=10)),
        ])

        # --- Chấm công mẫu cho cán bộ hiện trường (5 ngày gần nhất, có 1 ngày đi trễ) ---
        for i in range(5):
            d = today - timedelta(days=i)
            # ngày i==2 vào trễ lúc 8h45, các ngày khác vào đúng 7h30
            in_hour, in_min = (8, 45) if i == 2 else (7, 30)
            db.add(Attendance(
                company_id=c1.id, user_id=hientruong.id, work_date=d,
                check_in=datetime(d.year, d.month, d.day, in_hour, in_min),
                check_out=datetime(d.year, d.month, d.day, 17, 0),
                source=AttendanceSource.MANUAL,
            ))

        # --- Đánh giá mẫu 2 chiều: nhân viên ↔ quản lý trực tiếp ---
        period = today.strftime("%Y-%m")
        db.add_all([
            Evaluation(company_id=c1.id, period=period, evaluator_id=hientruong.id,
                       evaluatee_id=quanly.id, direction=EvaluationDirection.STAFF_TO_MANAGER,
                       rating=4, comment="Quản lý hỗ trợ kịp thời, phân công công việc rõ ràng."),
            Evaluation(company_id=c1.id, period=period, evaluator_id=quanly.id,
                       evaluatee_id=hientruong.id, direction=EvaluationDirection.MANAGER_TO_STAFF,
                       rating=5, comment="Chủ động, bám sát hiện trường, cần cải thiện giờ giấc đôi chút."),
        ])

        db.commit()
        print("[OK] Seed thanh cong! Dang nhap: giamdoc@dosco.vn / 123456")
    finally:
        db.close()


if __name__ == "__main__":
    run()
