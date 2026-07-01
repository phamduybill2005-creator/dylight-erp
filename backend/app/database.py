"""
Lớp truy cập cơ sở dữ liệu (SQLAlchemy 2.0).
- engine: kết nối tới PostgreSQL.
- SessionLocal: factory tạo phiên làm việc (session) cho mỗi request.
- Base: lớp gốc cho toàn bộ ORM model.
- vn_now(): "bây giờ" theo GIỜ VIỆT NAM (UTC+7, không DST) — dùng cho mọi mốc
  thời gian LƯU vào DB để hiển thị đúng giờ VN (server Render chạy giờ UTC).
"""
from datetime import datetime, timedelta

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings

# Việt Nam cố định UTC+7 (không có giờ mùa hè) -> cộng thẳng 7 giờ, không cần tzdata.
_VN_OFFSET = timedelta(hours=7)


def vn_now() -> datetime:
    """Thời điểm hiện tại theo giờ Việt Nam, dạng NAIVE (khớp cột DateTime không tz)."""
    return datetime.utcnow() + _VN_OFFSET

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


# Đặt múi giờ PHIÊN của Postgres = Việt Nam để server_default=func.now() (các cột
# created_at...) sinh giờ VN thay vì UTC. SQLite (local) bỏ qua — không có lệnh này.
@event.listens_for(engine, "connect")
def _set_session_timezone(dbapi_conn, _conn_record):  # noqa: ANN001
    if engine.dialect.name != "postgresql":
        return
    try:
        cur = dbapi_conn.cursor()
        cur.execute("SET TIME ZONE 'Asia/Ho_Chi_Minh'")
        cur.close()
    except Exception:  # noqa: BLE001 — không để lỗi set-tz làm hỏng kết nối
        pass


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
