"""
============================================================================
 ĐỒNG BỘ CHẤM CÔNG YUNATT -> ERP (chạy trên GitHub Actions / CI)
============================================================================
Mục đích: chạy ĐÚNG một lần việc đồng bộ chấm công từ cổng Yunatt về ERP,
giống hệt job nền 20:00 trong backend/app/services/scheduler.py, nhưng không
cần backend chạy 24/7 — thay vào đó một cron của GitHub Actions gọi script này.

NGUYÊN TẮC QUAN TRỌNG:
- TÁI SỬ DỤNG yunatt_service.run_sync (KHÔNG viết lại phần cào Playwright).
- TUYỆT ĐỐI KHÔNG import app.main. Import app.main sẽ chạy ngay lúc nạp module:
  create_all + _ensure_schema() (ALTER TABLE) + (mặc định AUTO_SEED) seed.run()
  trên DB thật. Ở đây chỉ import app.database, app.models, app.services.yunatt_service.
- Gọi Base.metadata.create_all(engine) một cách phòng thủ: chỉ tạo bảng còn
  THIẾU (vd yunatt_sync_log), không sửa/không xóa — idempotent, an toàn với DB
  prod (vốn đã có sẵn mọi bảng) và đúng hành vi của app (main/seed cũng gọi nó).

CÁCH CHẠY: đặt CWD = backend/ (hoặc PYTHONPATH=backend) để "import app.*" phân
giải y như khi server chạy. Cần các biến môi trường: DATABASE_URL (chuỗi EXTERNAL
của Render, giữ ?sslmode=require), YUNATT_EMAIL, YUNATT_PASSWORD. Tùy chọn:
YUNATT_COMPANY_ID (0/rỗng = công ty đầu tiên).

LƯU Ý: settings là singleton tạo lúc import app.config -> mọi biến môi trường
phải được set TRƯỚC khi import app.*. Trong GitHub Actions ta set qua `env:`.

Mã thoát (exit code):
  0  thành công
  1  lỗi không lường trước (đã rollback + ghi nhật ký thất bại)
  2  không tìm thấy công ty để nhận dữ liệu
  3  lỗi cấu hình/đăng nhập/Playwright (YunattError)
"""
from __future__ import annotations

import os
import re
import sys

# Cho "import app.*" chạy được dù gọi script kiểu nào (python scripts/x.py đặt sys.path[0]
# = thư mục scripts/, KHÔNG phải backend/). Tự thêm backend/ (cha của scripts/) vào path.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# QUAN TRỌNG: chỉ import lớp truy cập DB + models + service. KHÔNG import app.main.
from app.database import Base, SessionLocal, engine  # noqa: E402  # tạo engine từ DATABASE_URL (đã chuẩn hóa scheme)
import app.models  # noqa: F401  # đăng ký TẤT CẢ bảng (gồm YunattSyncLog) vào Base.metadata
from app.services import yunatt_service


# Che thông tin đăng nhập trong chuỗi lỗi: scheme://user:pass@host -> scheme://***@host
# (SQLAlchemy/psycopg2 hay nhúng cả DATABASE_URL có mật khẩu vào lỗi; dòng nhật ký
#  YunattSyncLog.message lại hiển thị cho Ban Giám đốc trong app nên phải làm sạch.)
_CREDS_RE = re.compile(r"(?P<scheme>[a-zA-Z0-9+.\-]+://)[^@/\s]+@")


def _sanitize(msg: str) -> str:
    """Xóa user:pass khỏi mọi URL nhúng trong thông điệp lỗi (tránh lộ mật khẩu)."""
    return _CREDS_RE.sub(r"\g<scheme>***@", msg or "")


def main() -> int:
    # An toàn & idempotent: chỉ tạo bảng còn thiếu (no-op trên prod, không ALTER, không seed).
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    company_id = None
    try:
        company_id = yunatt_service.resolve_company_id(db)  # tôn trọng YUNATT_COMPANY_ID, nếu không lấy công ty đầu tiên
        if not company_id:
            print("[yunatt-sync] khong tim thay cong ty -> bo qua.")
            return 2

        # trigger="auto" -> đánh dấu là job tự động (giống scheduler), months mặc định = [thang truoc, thang hien tai]
        res = yunatt_service.run_sync(db, company_id, trigger="auto")
        print(
            f"[yunatt-sync] OK months={res['months']} rows={res['rows']} "
            f"matched={res['matched']} days={res['days_updated']} "
            f"days_no_checkout={res['days_no_checkout']} "
            f"unmatched={len(res['unmatched'])}"
        )
        return 0

    except yunatt_service.YunattError as e:
        # Lỗi cấu hình / đăng nhập / Playwright -> ghi nhật ký thất bại để Ban Giám đốc thấy.
        db.rollback()
        clean = _sanitize(str(e))
        if company_id:
            yunatt_service.record_failure(db, company_id, clean, trigger="auto")
        print(f"[yunatt-sync] LOI cau hinh/dang nhap: {clean}")
        return 3

    except Exception as e:  # noqa: BLE001
        db.rollback()
        clean = _sanitize(str(e))
        if company_id:
            yunatt_service.record_failure(db, company_id, clean, trigger="auto")
        print(f"[yunatt-sync] THAT BAI: {clean}")
        return 1

    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
