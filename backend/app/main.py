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

from app.config import settings
from app.database import Base, engine
from app.routers import (
    auth, companies, bids, projects, contracts, invoices, payments, progress, dashboard,
    project_items, attendance, evaluations,
)

# MVP: tự tạo bảng khi khởi động. PRODUCTION nên dùng Alembic migration
# (đã có sẵn alembic trong requirements) để quản lý phiên bản schema.
Base.metadata.create_all(bind=engine)

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


@app.get("/", tags=["Health"])
def health():
    """Kiểm tra API sống."""
    return {"app": settings.APP_NAME, "status": "ok"}


# --- Đăng ký router theo tiền tố /api/v1 ---
P = settings.API_V1_PREFIX
for r in (auth, companies, bids, projects, contracts, invoices, payments, progress, dashboard,
          project_items, attendance, evaluations):
    app.include_router(r.router, prefix=P)
