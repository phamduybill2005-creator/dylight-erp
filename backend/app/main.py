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
    iclock,
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
        }
        missing = [sql for col, sql in adds.items() if col not in cols]
        if missing:
            with engine.begin() as conn:
                for sql in missing:
                    conn.execute(text(sql))

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
          leave, equipment, finance, audit, design_docs, notifications, assignments, colleagues):
    app.include_router(r.router, prefix=P)

# Máy chấm công đẩy trực tiếp (ZKTeco PUSH/ADMS) gọi đúng /iclock/... -> KHÔNG thêm tiền tố /api/v1.
app.include_router(iclock.router)
