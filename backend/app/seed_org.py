import sys
import os
from datetime import date
from decimal import Decimal

# Add parent directory to path so we can import app modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal, engine
from sqlalchemy import text
from app.models import Base, User, UserRole, Company
from app.security import hash_password

def run_seed():
    # 2026-07-24: NGỪNG seed các tài khoản DEMO 1 tên (giang@, son@, duong@, cao@, ...)
    # vì trùng với tài khoản THẬT dạng <initials>@dosco.vn (dhson@, nthgiang@, ...).
    # Chúng đã bị xóa trên PROD theo yêu cầu; KHÔNG tạo lại nữa. (_ensure_schema đã chạy
    # ở app/main.py trước lời gọi này nên không cần lặp lại.) Bật lại: đặt env SEED_ORG_DEMO=1.
    import os
    if not os.environ.get("SEED_ORG_DEMO"):
        print("[seed-org] Da tat seed tai khoan demo (SEED_ORG_DEMO chua bat).")
        return

    db = SessionLocal()
    try:
        # 1. Get the company
        company = db.query(Company).filter(Company.code == "DOSCO").first()
        if not company:
            company = Company(name="Công ty CP Xây dựng DOSCO", code="DOSCO", tax_code="0101234567")
            db.add(company)
            db.commit()
            db.refresh(company)
            
        print(f"Using company ID: {company.id}")
        
        # 2. Check if users are already seeded to prevent duplicates
        existing_emails = {u.email for u in db.query(User).all()}
        
        # Define users in org chart
        # Level 1: GIANG, NHUNG, ĐẠT, DŨNG
        # Level 2: CƯỜNG, PHÚ
        # Level 3: SƠN
        # Level 4: LÂM, BÍNH
        # Level 5: QUANG, CAO, ĐỨC, HÙNG
        # Level 6: HOÀN, DUY, LINH37, QUÂN, DƯƠNG, ????? (UNKNOWN), KHẢI
        
        users_def = [
            # NHÂN VIÊN nhánh Địa hình (dưới cùng của nhánh, dưới Cường/Phú)
            {"email": "giang@dosco.vn", "name": "Giang", "role": UserRole.FIELD_STAFF, "dept": "Địa hình"},
            {"email": "nhung@dosco.vn", "name": "Nhung", "role": UserRole.FIELD_STAFF, "dept": "Địa hình"},
            {"email": "dat@dosco.vn", "name": "Đạt", "role": UserRole.FIELD_STAFF, "dept": "Địa hình"},
            {"email": "dung@dosco.vn", "name": "Dũng", "role": UserRole.FIELD_STAFF, "dept": "Địa hình"},
            
            # Level 2
            {"email": "cuong@dosco.vn", "name": "Cường", "role": UserRole.MANAGER, "dept": "Địa hình", "work_start": "08:30", "work_end": "18:30"},
            {"email": "phu@dosco.vn", "name": "Phú", "role": UserRole.MANAGER, "dept": "Địa hình"},
            
            # Level 3
            {"email": "son@dosco.vn", "name": "Sơn", "role": UserRole.MANAGER, "dept": "Địa hình"},
            
            # Level 4
            {"email": "lam@dosco.vn", "name": "Lâm", "role": UserRole.MANAGER, "dept": "Thiết kế", "work_start": "08:30", "work_end": "18:30"},
            {"email": "binh@dosco.vn", "name": "Bính", "role": UserRole.MANAGER, "dept": "Thiết kế"},
            
            # Level 5
            {"email": "quang@dosco.vn", "name": "Quang", "role": UserRole.MANAGER, "dept": "Thiết kế"},
            {"email": "cao@dosco.vn", "name": "Cao", "role": UserRole.MANAGER, "dept": "Thiết kế"},
            {"email": "duc@dosco.vn", "name": "Đức", "role": UserRole.MANAGER, "dept": "Thiết kế"},
            {"email": "hung@dosco.vn", "name": "Hùng", "role": UserRole.MANAGER, "dept": "Thiết kế"},
            
            # Level 6
            {"email": "hoan@dosco.vn", "name": "Hoàn", "role": UserRole.FIELD_STAFF, "dept": "Thiết kế"},
            {"email": "duy@dosco.vn", "name": "Duy", "role": UserRole.FIELD_STAFF, "dept": "Thiết kế"},
            {"email": "linh37@dosco.vn", "name": "Linh37", "role": UserRole.FIELD_STAFF, "dept": "Thiết kế"},
            {"email": "quan@dosco.vn", "name": "Quân", "role": UserRole.FIELD_STAFF, "dept": "Thiết kế"},
            {"email": "duong@dosco.vn", "name": "Dương", "role": UserRole.FIELD_STAFF, "dept": "Thiết kế"},
            {"email": "unknown@dosco.vn", "name": "?????", "role": UserRole.FIELD_STAFF, "dept": "Thiết kế"},
            {"email": "khai@dosco.vn", "name": "Khải", "role": UserRole.FIELD_STAFF, "dept": "Thiết kế"},
        ]
        
        # Add any missing users
        users_map = {}
        for udef in users_def:
            email = udef["email"]
            if email not in existing_emails:
                u = User(
                    company_id=company.id,
                    email=email,
                    full_name=udef["name"],
                    hashed_password=hash_password("123456"),
                    role=udef["role"],
                    department=udef["dept"],
                    is_approved=True,
                    is_active=True,
                    work_start=udef.get("work_start"),
                    work_end=udef.get("work_end")
                )
                db.add(u)
                db.flush()
                users_map[udef["name"]] = u
                print(f"Created user ID {u.id}")
            else:
                u = db.query(User).filter(User.email == email).first()
                # Đồng bộ CHỨC VỤ (role) + phòng ban theo sơ đồ — NHƯNG KHÔNG BAO GIỜ hạ
                # vai trò Admin/Giám đốc (tránh KHÓA NHẦM tài khoản quản trị nếu trùng email).
                if u.role not in (UserRole.ADMIN, UserRole.DIRECTOR):
                    u.role = udef["role"]
                    u.department = udef["dept"]
                if "work_start" in udef:
                    u.work_start = udef["work_start"]
                if "work_end" in udef:
                    u.work_end = udef["work_end"]
                users_map[udef["name"]] = u
                print(f"Found existing user ID {u.id}")
                
        db.commit()
        
        # Now set up relationships based on the diagram
        # Helper function to get IDs as comma-separated string
        def get_ids_str(names):
            ids = []
            for n in names:
                if n in users_map:
                    ids.append(str(users_map[n].id))
            return ",".join(ids) if ids else None
            
        def get_first_id(names):
            for n in names:
                if n in users_map:
                    return users_map[n].id
            return None

        # ===== HỆ THỐNG CẤP BẬC (tỏa từ giữa ra):
        #   Nhánh ĐỊA HÌNH:  SƠN (đầu) -> Cường, Phú -> Giang, Nhung, Đạt, Dũng (nhân viên)
        #   Nhánh THIẾT KẾ:  LÂM, BÍNH (đầu) -> Quang, Cao, Đức, Hùng -> nhân viên
        # SƠN, LÂM, BÍNH là CAO NHẤT (không có quản lý). =====

        def set_mgr(names, mgr_names):
            for nm in names:
                u = users_map.get(nm)
                if u:
                    u.manager_ids = get_ids_str(mgr_names)
                    u.manager_id = get_first_id(mgr_names)

        def clear_mgr(names):
            for nm in names:
                u = users_map.get(nm)
                if u:
                    u.manager_ids = None
                    u.manager_id = None

        # Đầu 2 nhánh: không có quản lý.
        clear_mgr(["Sơn", "Lâm", "Bính"])
        # Nhánh Địa hình.
        set_mgr(["Cường", "Phú"], ["Sơn"])
        set_mgr(["Giang", "Nhung", "Đạt", "Dũng"], ["Cường", "Phú"])
        # Nhánh Thiết kế.
        set_mgr(["Quang", "Cao", "Đức", "Hùng"], ["Lâm", "Bính"])
        set_mgr(["Hoàn", "Duy"], ["Quang"])
        set_mgr(["Linh37", "Quân", "Dương", "?????", "Khải"], ["Cao", "Đức", "Hùng"])

        db.commit()
        print("Successfully set up org chart manager relationships!")
        
    except Exception as e:
        db.rollback()
        print(f"Error seeding org: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    run_seed()
