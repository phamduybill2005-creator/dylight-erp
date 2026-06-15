"""Môi trường Alembic — nối với cấu hình & model của ứng dụng.

- Lấy DATABASE_URL từ app.config.settings (KHÔNG hard-code trong alembic.ini),
  nên cùng một bộ migration chạy được cho cả SQLite (dev) lẫn PostgreSQL (prod).
- target_metadata = Base.metadata để hỗ trợ `alembic revision --autogenerate`.
"""
import os
import sys
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool

from alembic import context

# Cho phép import gói `app` khi chạy alembic từ thư mục backend/
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.config import settings  # noqa: E402
from app.database import Base  # noqa: E402
import app.models  # noqa: E402,F401  (đăng ký toàn bộ bảng vào Base.metadata)

config = context.config

# Ưu tiên DATABASE_URL từ cấu hình ứng dụng (.env)
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Chạy migration ở chế độ 'offline' (chỉ cần URL, sinh ra SQL)."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        render_as_batch=url.startswith("sqlite"),
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Chạy migration ở chế độ 'online' (kết nối thực tới DB)."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        is_sqlite = connection.dialect.name == "sqlite"
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            render_as_batch=is_sqlite,  # SQLite cần batch mode để ALTER TABLE
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
