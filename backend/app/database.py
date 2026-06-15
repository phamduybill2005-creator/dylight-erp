"""
Lớp truy cập cơ sở dữ liệu (SQLAlchemy 2.0).
- engine: kết nối tới PostgreSQL.
- SessionLocal: factory tạo phiên làm việc (session) cho mỗi request.
- Base: lớp gốc cho toàn bộ ORM model.
"""
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings

# Chuẩn hóa URL Postgres do dịch vụ host cấp (Render/Heroku dùng "postgres://",
# SQLAlchemy 2.0 cần driver rõ ràng). SQLite (chạy local) giữ nguyên.
_db_url = settings.DATABASE_URL
if _db_url.startswith("postgres://"):
    _db_url = _db_url.replace("postgres://", "postgresql+psycopg2://", 1)
elif _db_url.startswith("postgresql://"):
    _db_url = _db_url.replace("postgresql://", "postgresql+psycopg2://", 1)

# pool_pre_ping=True: tự kiểm tra kết nối "chết" trước khi dùng (tránh lỗi
# khi DB đóng kết nối nhàn rỗi). future=True bật API kiểu 2.0.
engine = create_engine(
    _db_url,
    pool_pre_ping=True,
    future=True,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


class Base(DeclarativeBase):
    """Lớp gốc khai báo cho mọi bảng trong hệ thống."""
    pass


def get_db():
    """
    Dependency của FastAPI: mở một session cho request và đóng lại khi xong.
    Dùng: db: Session = Depends(get_db)
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
