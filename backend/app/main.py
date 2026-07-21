"""
==========================================================================
 DYLIGHT ERP — ĐIỂM VÀO ỨNG DỤNG FASTAPI
==========================================================================
Khởi tạo app, bật CORS cho frontend, phục vụ ảnh hóa đơn tĩnh và
đăng ký toàn bộ router nghiệp vụ.
"""
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from sqlalchemy import inspect, text

from app.config import settings
from app.database import Base, engine
from app.routers import (
    auth, companies, bids, projects, contracts, invoices, payments, progress, dashboard,
    project_items, attendance, evaluations, project_evaluations, partners, payroll,
    leave, equipment, finance, audit, design_docs, notifications, assignments, colleagues,
    chat, iclock, departments, timesheets,
)

# MVP: tự tạo bảng khi khởi động. PRODUCTION nên dùng Alembic migration
# (đã có sẵn alembic trong requirements) để quản lý phiên bản schema.
Base.metadata.create_all(bind=engine)


def _ensure_schema() -> None:
    """
    Tự thêm các CỘT mới vào bảng đã tồn tại (create_all không tự ALTER bảng cũ).
    Cần cho DB đã có dữ liệu (SQLite local & Postgres trên Render) — không mất dữ liệu.
    """
    try:
        insp = inspect(engine)
        if "users" not in insp.get_table_names():
            return
        cols = {c["name"] for c in insp.get_columns("users")}
        adds = {
            "base_salary": "ALTER TABLE users ADD COLUMN base_salary NUMERIC DEFAULT 0",
            "salary_type": "ALTER TABLE users ADD COLUMN salary_type VARCHAR(20) DEFAULT 'MONTHLY'",
            "allowance": "ALTER TABLE users ADD COLUMN allowance NUMERIC DEFAULT 0",
            "num_dependents": "ALTER TABLE users ADD COLUMN num_dependents INTEGER DEFAULT 0",
            "is_approved": "ALTER TABLE users ADD COLUMN is_approved BOOLEAN DEFAULT TRUE",
            "department": "ALTER TABLE users ADD COLUMN department VARCHAR(120)",
            "yunatt_code": "ALTER TABLE users ADD COLUMN yunatt_code VARCHAR(50)",
            "token_version": "ALTER TABLE users ADD COLUMN token_version INTEGER DEFAULT 0",
            "work_start": "ALTER TABLE users ADD COLUMN work_start VARCHAR(5)",
            "work_end": "ALTER TABLE users ADD COLUMN work_end VARCHAR(5)",
        }
        missing = [sql for col, sql in adds.items() if col not in cols]
        if missing:
            with engine.begin() as conn:
                for sql in missing:
                    conn.execute(text(sql))

        # Projects: cột lead_id + group_name/geo_manager_id/dosco_manager_id cho DB cũ.
        if "projects" in insp.get_table_names():
            pcols = {c["name"] for c in insp.get_columns("projects")}
            padds = {
                "lead_id": "ALTER TABLE projects ADD COLUMN lead_id INTEGER",
                "group_name": "ALTER TABLE projects ADD COLUMN group_name VARCHAR(255)",
                # GEO担当/DOSCO担当 lưu dạng TEXT (tên). (geo_manager_id/dosco_manager_id cũ
                # nếu đã có trên DB thì để trống, không dùng nữa.)
                "geo_manager": "ALTER TABLE projects ADD COLUMN geo_manager VARCHAR(255)",
                "dosco_manager": "ALTER TABLE projects ADD COLUMN dosco_manager VARCHAR(255)",
                "internal_deadline": "ALTER TABLE projects ADD COLUMN internal_deadline DATE",
                "evaluation": "ALTER TABLE projects ADD COLUMN evaluation VARCHAR(500)",
            }
            pmissing = [sql for col, sql in padds.items() if col not in pcols]
            if pmissing:
                with engine.begin() as conn:
                    for sql in pmissing:
                        conn.execute(text(sql))

        # Project_items: cột progress (% hoàn thành) + department (phòng ban phụ trách) cho DB cũ.
        if "project_items" in insp.get_table_names():
            picols = {c["name"] for c in insp.get_columns("project_items")}
            pi_adds = {
                "progress": "ALTER TABLE project_items ADD COLUMN progress NUMERIC DEFAULT 0",
                "department": "ALTER TABLE project_items ADD COLUMN department VARCHAR(120)",
                "rating": "ALTER TABLE project_items ADD COLUMN rating INTEGER DEFAULT 0",
                "assignee_id": "ALTER TABLE project_items ADD COLUMN assignee_id INTEGER",
                "due_date": "ALTER TABLE project_items ADD COLUMN due_date DATE",
                "done_date": "ALTER TABLE project_items ADD COLUMN done_date DATE",
            }
            pi_missing = [sql for col, sql in pi_adds.items() if col not in picols]
            if pi_missing:
                with engine.begin() as conn:
                    for sql in pi_missing:
                        conn.execute(text(sql))

        # Progress: cột người thực hiện / khối lượng / trạng thái cho bảng tiến độ có cấu trúc.
        if "progress" in insp.get_table_names():
            prcols = {c["name"] for c in insp.get_columns("progress")}
            pr_adds = {
                "assignee_id": "ALTER TABLE progress ADD COLUMN assignee_id INTEGER",
                "quantity": "ALTER TABLE progress ADD COLUMN quantity NUMERIC DEFAULT 0",
                "status": "ALTER TABLE progress ADD COLUMN status VARCHAR(20) DEFAULT 'TODO'",
            }
            pr_missing = [sql for col, sql in pr_adds.items() if col not in prcols]
            if pr_missing:
                with engine.begin() as conn:
                    for sql in pr_missing:
                        conn.execute(text(sql))

        # Assignments: cột started_at (bắt đầu) + done_at (hoàn thành) cho DB cũ
        # -> đo "làm trong bao lâu". TIMESTAMP hợp lệ cả SQLite & Postgres, nullable.
        if "assignments" in insp.get_table_names():
            acols = {c["name"] for c in insp.get_columns("assignments")}
            a_adds = {
                "started_at": "ALTER TABLE assignments ADD COLUMN started_at TIMESTAMP",
                "done_at": "ALTER TABLE assignments ADD COLUMN done_at TIMESTAMP",
            }
            a_missing = [sql for col, sql in a_adds.items() if col not in acols]
            if a_missing:
                with engine.begin() as conn:
                    for sql in a_missing:
                        conn.execute(text(sql))

        # Conversations: cột project_id (nhóm chat gắn dự án) cho DB cũ.
        if "conversations" in insp.get_table_names():
            cvcols = {c["name"] for c in insp.get_columns("conversations")}
            if "project_id" not in cvcols:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE conversations ADD COLUMN project_id INTEGER"))

        # Bảng companies: cờ chia sẻ phiếu lương.
        if "companies" in insp.get_table_names():
            ccols = {c["name"] for c in insp.get_columns("companies")}
            if "payroll_shared" not in ccols:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE companies ADD COLUMN payroll_shared BOOLEAN DEFAULT FALSE"))

        # Evaluations: cột eval_date (ngày chấm) + project_id (dự án) cho DB cũ —
        # chấm theo TỪNG NGÀY & TỪNG DỰ ÁN, gộp theo tuần. Nullable, hợp lệ cả SQLite & Postgres.
        if "evaluations" in insp.get_table_names():
            ecols = {c["name"] for c in insp.get_columns("evaluations")}
            e_adds = {
                "eval_date": "ALTER TABLE evaluations ADD COLUMN eval_date DATE",
                "project_id": "ALTER TABLE evaluations ADD COLUMN project_id INTEGER",
            }
            e_missing = [sql for col, sql in e_adds.items() if col not in ecols]
            if e_missing:
                with engine.begin() as conn:
                    for sql in e_missing:
                        conn.execute(text(sql))

        # Nới rộng evaluations.period (đánh giá đổi sang kỳ TUẦN 'YYYY-MM-DD' = 10 ký tự).
        # Postgres ép độ dài VARCHAR; SQLite bỏ qua nên không cần. Chỉ ALTER khi đang < 20.
        if engine.dialect.name == "postgresql" and "evaluations" in insp.get_table_names():
            pcol = next((c for c in insp.get_columns("evaluations") if c["name"] == "period"), None)
            plen = getattr(pcol["type"], "length", None) if pcol else None
            if plen is not None and plen < 20:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE evaluations ALTER COLUMN period TYPE VARCHAR(20)"))

        # Chống bản ghi chấm công TRÙNG (user_id, work_date): thêm UNIQUE INDEX nếu bảng
        # đã tồn tại mà chưa có. AN TOÀN: KHÔNG xóa dữ liệu — nếu đang còn dòng trùng thì
        # BỎ QUA + cảnh báo để admin tự gộp (tránh tự ý xóa chấm công trên prod).
        if "attendance" in insp.get_table_names():
            have = {ix["name"] for ix in insp.get_indexes("attendance")}
            have |= {uc["name"] for uc in insp.get_unique_constraints("attendance")}
            if "uq_attendance_user_day" not in have:
                with engine.begin() as conn:
                    dup = conn.execute(text(
                        "SELECT 1 FROM attendance GROUP BY user_id, work_date HAVING COUNT(*) > 1 LIMIT 1"
                    )).first()
                    if dup:
                        print("[ensure-schema] CANH BAO: con ban ghi cham cong trung "
                              "(user_id, work_date) -> CHUA them rang buoc duy nhat. "
                              "Hay gop thu cong roi khoi dong lai de bao ve.")
                    else:
                        conn.execute(text(
                            "CREATE UNIQUE INDEX uq_attendance_user_day ON attendance (user_id, work_date)"
                        ))

        # Timesheets: cột project_item_id (gắn giờ vào ĐẦU VIỆC của hạng mục) cho DB cũ.
        # Đồng thời BỎ ràng buộc cũ (user_id, project_id, work_date) — nay 1 người có thể
        # khai NHIỀU đầu việc trong cùng 1 dự án/ngày nên khóa cũ sẽ chặn nhầm. Dedup do
        # router (tìm-rồi-ghi-đè) đảm nhiệm. Chỉ chạy DROP trên Postgres (prod); SQLite tạo
        # bảng mới theo model nên không có khóa cũ.
        if "timesheets" in insp.get_table_names():
            tcols = {c["name"] for c in insp.get_columns("timesheets")}
            with engine.begin() as conn:
                if "project_item_id" not in tcols:
                    conn.execute(text("ALTER TABLE timesheets ADD COLUMN project_item_id INTEGER"))
                if engine.dialect.name == "postgresql":
                    conn.execute(text(
                        "ALTER TABLE timesheets DROP CONSTRAINT IF EXISTS uq_timesheet_user_proj_day"
                    ))

        # CHAT: chống tạo trùng phòng 1-1 -> UNIQUE (company_id, direct_key) chỉ với DIRECT
        # (direct_key IS NOT NULL). Partial index chạy được cả Postgres & SQLite.
        if "conversations" in insp.get_table_names():
            have = {ix["name"] for ix in insp.get_indexes("conversations")}
            if "uq_conversations_direct_key" not in have:
                with engine.begin() as conn:
                    conn.execute(text(
                        "CREATE UNIQUE INDEX IF NOT EXISTS uq_conversations_direct_key "
                        "ON conversations (company_id, direct_key) WHERE direct_key IS NOT NULL"
                    ))

        # CHAT: mỗi người 1 cảm xúc / 1 tin -> UNIQUE (message_id, user_id).
        # create_all đã tạo bảng + ràng buộc; đây chỉ phòng hờ DB cũ thiếu index.
        if "message_reactions" in insp.get_table_names():
            have = {ix["name"] for ix in insp.get_indexes("message_reactions")}
            have |= {uc["name"] for uc in insp.get_unique_constraints("message_reactions")}
            if "uq_reaction_msg_user" not in have:
                with engine.begin() as conn:
                    conn.execute(text(
                        "CREATE UNIQUE INDEX IF NOT EXISTS uq_reaction_msg_user "
                        "ON message_reactions (message_id, user_id)"
                    ))
    except Exception as _e:  # noqa: BLE001
        print(f"[ensure-schema] bo qua: {_e}")

    # CỘT QUAN TRỌNG cho tính năng "giao đầu việc + giờ theo người" — chạy ĐỘC LẬP với
    # khối trên: nếu 1 bảng phía trên lỗi, migration này VẪN chạy (khỏi bị bỏ qua dây chuyền).
    # Idempotent: chỉ ALTER khi thiếu cột; DROP ... IF EXISTS.
    try:
        insp2 = inspect(engine)
        tn2 = insp2.get_table_names()
        if "project_items" in tn2:
            picols2 = {c["name"] for c in insp2.get_columns("project_items")}
            with engine.begin() as conn:
                if "assignee_id" not in picols2:
                    conn.execute(text("ALTER TABLE project_items ADD COLUMN assignee_id INTEGER"))
                if "due_date" not in picols2:
                    conn.execute(text("ALTER TABLE project_items ADD COLUMN due_date DATE"))
                if "done_date" not in picols2:
                    conn.execute(text("ALTER TABLE project_items ADD COLUMN done_date DATE"))
        if "timesheets" in tn2:
            if "project_item_id" not in {c["name"] for c in insp2.get_columns("timesheets")}:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE timesheets ADD COLUMN project_item_id INTEGER"))
            if engine.dialect.name == "postgresql":
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE timesheets DROP CONSTRAINT IF EXISTS uq_timesheet_user_proj_day"))
    except Exception as _e:  # noqa: BLE001
        print(f"[ensure-schema] cot quan trong bo qua: {_e}")


_ensure_schema()

# Tự nạp dữ liệu mẫu khi CSDL trống (tiện deploy — khỏi vào Shell chạy seed).
# seed.run() đã tự bỏ qua nếu đã có dữ liệu; bọc try để lỗi seed không làm sập app.
if settings.AUTO_SEED:
    try:
        from app.seed import run as _seed_run
        _seed_run()
    except Exception as _e:  # noqa: BLE001
        print(f"[auto-seed] bo qua (loi khi seed): {_e}")


def _backfill_departments() -> None:
    """
    Gán PHÒNG BAN cho nhân sự theo sơ đồ tổ chức DOSCO (07/2026) — chạy mỗi lần
    khởi động nhưng CHỈ điền cho người đang TRỐNG department, nên không bao giờ
    ghi đè phân công đã chỉnh tay trên giao diện.

    Khớp theo TÊN (từ cuối của full_name, bỏ dấu + bỏ số): tài khoản thật đăng ký
    qua Google nên không đoán trước được email. Bỏ qua ADMIN/DIRECTOR (Giám đốc
    không thuộc phòng nào) và các tài khoản demo.
    """
    import re
    import unicodedata

    from app.database import SessionLocal
    from app.models import User, UserRole

    # Tên phòng PHẢI khớp PRESET_DEPARTMENTS (frontend/src/lib/departments.ts).
    KS, BIM, TKD, AI = "Phòng Bản đồ", "Phòng BIM", "Phòng Thiết kế đường 2D", "Phòng AI"
    NAME_TO_DEPTS = {
        # Phòng Bản đồ (trước là Phòng Khảo sát) — trưởng SƠN (kiêm Phòng AI)
        "SON": f"{KS}, {AI}",
        "GIANG": KS, "NHUNG": KS, "DAT": KS, "DUNG": KS, "CUONG": KS, "PHU": KS,
        # Phòng BIM — trưởng LÂM; DUY kiêm trưởng Phòng AI
        "LAM": BIM, "QUANG": BIM, "HOAN": BIM,
        "DUY": f"{BIM}, {AI}",
        # Phòng Thiết kế đường 2D — trưởng BÍNH (2 bạn LINH đều cùng phòng)
        "BINH": TKD, "CAO": TKD, "DUC": TKD, "HUNG": TKD, "LINH": TKD,
        "QUAN": TKD, "DUONG": TKD, "KHAI": TKD,
    }
    DEMO_EMAILS = {
        "giamdoc@dosco.vn", "quanly@dosco.vn", "ketoan@dosco.vn",
        "hientruong@dosco.vn", "admin@dosco.vn",
    }

    def name_key(full_name: str | None) -> str:
        """'D.H.SON' / 'Nguyễn Văn Đức' / 'D.T.LINH (LINH37)' -> 'SON' / 'DUC' / 'LINH'.
        Bỏ dấu + bỏ MỌI ký tự không phải chữ (số, ngoặc...) để tên kèm hậu tố vẫn khớp."""
        tokens = (full_name or "").replace(".", " ").split()
        if not tokens:
            return ""
        t = unicodedata.normalize("NFD", tokens[-1])
        t = "".join(ch for ch in t if unicodedata.category(ch) != "Mn")
        t = t.replace("Đ", "D").replace("đ", "d")
        return re.sub(r"[^A-Za-z]", "", t).upper()

    db = SessionLocal()
    try:
        blanks = db.query(User).filter(
            (User.department.is_(None)) | (User.department == "")
        ).all()
        changed = 0
        for u in blanks:
            if u.role in (UserRole.ADMIN, UserRole.DIRECTOR):
                continue
            if (u.email or "").lower() in DEMO_EMAILS:
                continue
            depts = NAME_TO_DEPTS.get(name_key(u.full_name))
            if depts:
                u.department = depts
                changed += 1
        if changed:
            db.commit()
            print(f"[backfill-dept] da gan phong ban cho {changed} nguoi theo so do to chuc")
    except Exception as _e:  # noqa: BLE001
        db.rollback()
        print(f"[backfill-dept] bo qua: {_e}")
    finally:
        db.close()


_backfill_departments()


def _seed_departments() -> None:
    """
    Nạp DANH MỤC phòng ban (bảng departments) cho công ty nào CHƯA có dòng nào —
    chạy mỗi lần khởi động nhưng chỉ điền khi bảng của công ty đó rỗng, nên không
    ghi đè các phòng Admin đã tạo/đổi tên. Danh mục khởi tạo = 4 phòng mặc định +
    mọi tên phòng đã dùng sẵn trong dữ liệu (users/hạng mục) để Admin thấy đủ và
    đổi tên được. Trùng khớp PRESET_DEPARTMENTS ở frontend.
    """
    from app.database import SessionLocal
    from app.models import Company, Department, ProjectItem, User

    PRESETS = ["Phòng Bản đồ", "Phòng BIM", "Phòng Thiết kế đường 2D", "Phòng AI"]

    db = SessionLocal()
    try:
        for (cid,) in db.query(Company.id).all():
            has_any = (
                db.query(Department.id)
                .filter(Department.company_id == cid)
                .first()
            )
            if has_any:
                continue

            names: list[str] = []
            seen: set[str] = set()

            def _add(raw: str | None) -> None:
                t = " ".join((raw or "").split())
                if t and t not in seen:
                    seen.add(t)
                    names.append(t)

            for n in PRESETS:
                _add(n)
            # Tên phòng đã dùng trong dữ liệu cũ (users lưu nhiều phòng/dấu phẩy).
            for (dep,) in db.query(User.department).filter(User.company_id == cid).all():
                for tok in (dep or "").split(","):
                    _add(tok)
            for (dep,) in (
                db.query(ProjectItem.department).filter(ProjectItem.company_id == cid).all()
            ):
                _add(dep)

            for i, n in enumerate(names):
                db.add(Department(company_id=cid, name=n, order_index=i))
        db.commit()
    except Exception as _e:  # noqa: BLE001
        db.rollback()
        print(f"[seed-dept] bo qua: {_e}")
    finally:
        db.close()


_seed_departments()

app = FastAPI(
    title=settings.APP_NAME,
    version="1.0.0",
    description="API quản lý vòng đời dự án xây dựng: đấu thầu → hợp đồng → "
                "hóa đơn (AI OCR) → thanh toán → báo cáo lãi/lỗ.",
)

# --- CORS: cho phép frontend Next.js gọi API ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Security headers cho MỌI response (gồm cả /static) ---
# nosniff: chặn trình duyệt "đoán" kiểu file -> giảm nhẹ stored-XSS ở ảnh hóa đơn.
# X-Frame-Options DENY: chống clickjacking (nhúng màn duyệt hóa đơn vào iframe lừa bấm).
# HSTS: ép HTTPS (Render đã HTTPS). Referrer/Permissions: hạn chế rò rỉ + quyền trình duyệt.
@app.middleware("http")
async def _security_headers(request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
    response.headers.setdefault(
        "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
    )
    return response

# --- Phục vụ ảnh hóa đơn đã upload tại /static ---
os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
app.mount("/static", StaticFiles(directory=settings.UPLOAD_DIR), name="static")


@app.on_event("startup")
def _start_yunatt_scheduler() -> None:
    """Bật lịch tự đồng bộ chấm công Yunatt (mỗi ngày 1 lần) khi app khởi động."""
    try:
        from app.services.scheduler import start_scheduler
        start_scheduler()
    except Exception as _e:  # noqa: BLE001
        print(f"[startup] khong bat duoc lich Yunatt: {_e}")


@app.get("/", tags=["Health"])
def health():
    """Kiểm tra API sống."""
    return {"app": settings.APP_NAME, "status": "ok"}


# --- Đăng ký router theo tiền tố /api/v1 ---
P = settings.API_V1_PREFIX
for r in (auth, companies, bids, projects, contracts, invoices, payments, progress, dashboard,
          project_items, attendance, evaluations, project_evaluations, partners, payroll,
          leave, equipment, finance, audit, design_docs, notifications, assignments, colleagues,
          chat, departments, timesheets):
    app.include_router(r.router, prefix=P)

# Máy chấm công đẩy trực tiếp (ZKTeco PUSH/ADMS) gọi đúng /iclock/... -> KHÔNG thêm tiền tố /api/v1.
app.include_router(iclock.router)
