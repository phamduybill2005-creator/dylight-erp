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
    project_items, attendance, evaluations, partners, payroll,
    leave, equipment, finance, audit, design_docs, notifications, assignments, colleagues,
    chat, iclock,
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
                "geo_manager_id": "ALTER TABLE projects ADD COLUMN geo_manager_id INTEGER",
                "dosco_manager_id": "ALTER TABLE projects ADD COLUMN dosco_manager_id INTEGER",
            }
            pmissing = [sql for col, sql in padds.items() if col not in pcols]
            if pmissing:
                with engine.begin() as conn:
                    for sql in pmissing:
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


_ensure_schema()

# Tự nạp dữ liệu mẫu khi CSDL trống (tiện deploy — khỏi vào Shell chạy seed).
# seed.run() đã tự bỏ qua nếu đã có dữ liệu; bọc try để lỗi seed không làm sập app.
if settings.AUTO_SEED:
    try:
        from app.seed import run as _seed_run
        _seed_run()
    except Exception as _e:  # noqa: BLE001
        print(f"[auto-seed] bo qua (loi khi seed): {_e}")

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
          project_items, attendance, evaluations, partners, payroll,
          leave, equipment, finance, audit, design_docs, notifications, assignments, colleagues,
          chat):
    app.include_router(r.router, prefix=P)

# Máy chấm công đẩy trực tiếp (ZKTeco PUSH/ADMS) gọi đúng /iclock/... -> KHÔNG thêm tiền tố /api/v1.
app.include_router(iclock.router)
