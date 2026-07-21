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
    # Run _ensure_schema from app.main to add all missing columns
    try:
        from app.main import _ensure_schema
        _ensure_schema()
        print("Successfully ran _ensure_schema to add all missing columns.")
    except Exception as e:
        print("Failed to run _ensure_schema:", e)

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
            # Top-level (Level 1)
            {"email": "giang@dosco.vn", "name": "Giang", "role": UserRole.MANAGER, "dept": "Địa hình"},
            {"email": "nhung@dosco.vn", "name": "Nhung", "role": UserRole.MANAGER, "dept": "Địa hình"},
            {"email": "dat@dosco.vn", "name": "Đạt", "role": UserRole.MANAGER, "dept": "Địa hình"},
            {"email": "dung@dosco.vn", "name": "Dũng", "role": UserRole.MANAGER, "dept": "Địa hình"},
            
            # Level 2
            {"email": "cuong@dosco.vn", "name": "Cường", "role": UserRole.MANAGER, "dept": "Địa hình"},
            {"email": "phu@dosco.vn", "name": "Phú", "role": UserRole.MANAGER, "dept": "Địa hình"},
            
            # Level 3
            {"email": "son@dosco.vn", "name": "Sơn", "role": UserRole.MANAGER, "dept": "Địa hình"},
            
            # Level 4
            {"email": "lam@dosco.vn", "name": "Lâm", "role": UserRole.MANAGER, "dept": "Thiết kế"},
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
                    is_active=True
                )
                db.add(u)
                db.flush()
                users_map[udef["name"]] = u
                print(f"Created user ID {u.id}")
            else:
                u = db.query(User).filter(User.email == email).first()
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

        # Level 1 (Giang, Nhung, Đạt, Dũng) have no managers in diagram, report to Director if needed. Let's keep them as None or top.
        
        # Level 2: Cường, Phú report to Level 1 (Giang, Nhung, Đạt, Dũng)
        for name in ["Cường", "Phú"]:
            u = users_map.get(name)
            if u:
                u.manager_ids = get_ids_str(["Giang", "Nhung", "Đạt", "Dũng"])
                u.manager_id = get_first_id(["Giang", "Nhung", "Đạt", "Dũng"])
                
        # Level 3: Sơn reports to Level 2 (Cường, Phú)
        u_son = users_map.get("Sơn")
        if u_son:
            u_son.manager_ids = get_ids_str(["Cường", "Phú"])
            u_son.manager_id = get_first_id(["Cường", "Phú"])
            
        # Level 4: Lâm, Bính report to Level 3 (Sơn)
        for name in ["Lâm", "Bính"]:
            u = users_map.get(name)
            if u:
                u.manager_ids = get_ids_str(["Sơn"])
                u.manager_id = get_first_id(["Sơn"])
                
        # Level 5: Quang, Cao, Đức, Hùng report to Level 4 (Lâm, Bính)
        for name in ["Quang", "Cao", "Đức", "Hùng"]:
            u = users_map.get(name)
            if u:
                u.manager_ids = get_ids_str(["Lâm", "Bính"])
                u.manager_id = get_first_id(["Lâm", "Bính"])
                
        # Level 6 under Quang: Hoàn, Duy
        for name in ["Hoàn", "Duy"]:
            u = users_map.get(name)
            if u:
                u.manager_ids = get_ids_str(["Quang"])
                u.manager_id = get_first_id(["Quang"])
                
        # Level 6 under Cao, Đức, Hùng: Linh37, Quân, Dương, ?????, Khải
        for name in ["Linh37", "Quân", "Dương", "?????", "Khải"]:
            u = users_map.get(name)
            if u:
                u.manager_ids = get_ids_str(["Cao", "Đức", "Hùng"])
                u.manager_id = get_first_id(["Cao", "Đức", "Hùng"])
                
        db.commit()
        print("Successfully set up org chart manager relationships!")
        
    except Exception as e:
        db.rollback()
        print(f"Error seeding org: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    run_seed()
