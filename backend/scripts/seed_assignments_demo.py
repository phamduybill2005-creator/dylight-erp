"""
Giao VIỆC MẪU cho 1 dự án nội bộ để xem thử BẢNG TIẾN ĐỘ NGÀY — chạy 1 LẦN qua GitHub Actions.

Chọn dự án ĐÀO TẠO nội bộ (code 00-0000 "モデリング研修", fallback 00-0001) — KHÔNG đụng
dự án khách hàng. Giao cho NHÂN SỰ THẬT (khớp theo TÊN như backfill phòng ban), trạng thái
xen kẽ xong / đang làm / chưa bắt đầu để bảng hiện đủ loại dải màu.

An toàn / idempotent:
  - Dự án đã có bất kỳ phân công nào -> BỎ QUA toàn bộ (không tạo trùng khi chạy lại).
  - Chỉ đặt start_date/end_date/lead_id khi đang TRỐNG (không ghi đè dữ liệu thật).
  - KHÔNG tạo thông báo (tránh spam chuông của nhân viên thật).
  - Việc mẫu ghi rõ trong mô tả — xóa được bằng nút thùng rác ở tab Phân công.

Chạy: đặt env DATABASE_URL (Neon).
"""
import os
import re
import sys
import unicodedata
from datetime import date, datetime

import psycopg2

PROJECT_CODES = ["00-0000", "00-0001"]   # dự án đào tạo nội bộ, ưu tiên 00-0000
DEMO_NOTE = "Việc mẫu để xem thử bảng tiến độ ngày — có thể đổi trạng thái hoặc xóa (nút thùng rác ở tab Phân công)."

# (tên-khóa người nhận, tiêu đề việc, trạng thái, created, started, done) — giờ VN trần.
TASKS = [
    ("LAM",   "Chuẩn hóa template Revit dựng cầu",       "DONE",        "2026-07-01T08:30", "2026-07-01T09:00", "2026-07-03T17:00"),
    ("QUANG", "Dựng mô hình mẫu trụ cầu (LOD 300)",      "DONE",        "2026-07-01T08:35", "2026-07-02T08:00", "2026-07-06T16:30"),
    ("HOAN",  "Dựng mô hình mẫu dầm & bản mặt cầu",      "IN_PROGRESS", "2026-07-02T09:00", "2026-07-03T08:00", None),
    ("DUY",   "Viết hướng dẫn quy trình BIM nội bộ",     "IN_PROGRESS", "2026-07-04T10:00", "2026-07-06T08:30", None),
    ("KHAI",  "Áp thử mô hình vào tuyến đường mẫu",      "ASSIGNED",    "2026-07-07T14:00", None, None),
    ("LAM",   "Tổng kết đào tạo & kế hoạch áp dụng",     "ASSIGNED",    "2026-07-07T15:00", None, None),
]
LEAD_KEY = "LAM"                          # trưởng phòng BIM chủ trì lớp đào tạo (chỉ đặt nếu chưa có)
START, END = date(2026, 7, 1), date(2026, 8, 15)  # chỉ đặt nếu dự án đang trống ngày

DEMO_EMAILS = {"giamdoc@dosco.vn", "quanly@dosco.vn", "ketoan@dosco.vn", "hientruong@dosco.vn", "admin@dosco.vn"}


def name_key(full_name: str) -> str:
    """'H.K.LAM' / 'Nguyễn Văn Đức' / 'LINH37' -> 'LAM' / 'DUC' / 'LINH' (như backfill phòng ban)."""
    tokens = (full_name or "").replace(".", " ").split()
    if not tokens:
        return ""
    t = unicodedata.normalize("NFD", tokens[-1])
    t = "".join(ch for ch in t if unicodedata.category(ch) != "Mn")
    t = t.replace("Đ", "D").replace("đ", "d")
    return re.sub(r"\d+", "", t).upper()


def main() -> int:
    db_url = os.environ.get("DATABASE_URL", "").strip()
    if not db_url:
        print("LỖI: thiếu DATABASE_URL.", flush=True)
        return 2

    conn = psycopg2.connect(db_url)
    conn.autocommit = False
    cur = conn.cursor()

    cur.execute("SELECT id, name FROM companies ORDER BY id LIMIT 1")
    row = cur.fetchone()
    if not row:
        print("LỖI: chưa có công ty nào.", flush=True)
        return 3
    company_id, company_name = row
    print(f"Công ty: #{company_id} {company_name}", flush=True)

    # --- Dự án đào tạo nội bộ ---
    proj = None
    for code in PROJECT_CODES:
        cur.execute(
            "SELECT id, code, name, start_date, end_date, lead_id FROM projects "
            "WHERE company_id = %s AND code = %s ORDER BY id LIMIT 1",
            (company_id, code),
        )
        proj = cur.fetchone()
        if proj:
            break
    if not proj:
        print(f"LỖI: không tìm thấy dự án nội bộ {PROJECT_CODES}.", flush=True)
        return 4
    pid, pcode, pname, p_start, p_end, p_lead = proj
    print(f"Dự án: #{pid} {pcode} — {pname}", flush=True)

    # --- Idempotent: đã có phân công thì thôi ---
    cur.execute("SELECT COUNT(*) FROM assignments WHERE project_id = %s", (pid,))
    if cur.fetchone()[0] > 0:
        print("BỎ QUA: dự án đã có phân công (script chỉ chạy 1 lần).", flush=True)
        conn.rollback()
        return 0

    # --- Người thật: khớp theo tên ---
    cur.execute(
        "SELECT id, full_name, email, role FROM users "
        "WHERE company_id = %s AND is_active = TRUE",
        (company_id,),
    )
    by_key: dict[str, tuple[int, str]] = {}
    director_id = None
    for uid, fname, email, role in cur.fetchall():
        if (email or "").lower() in DEMO_EMAILS:
            continue
        if role == "DIRECTOR" and director_id is None:
            director_id = uid
            continue
        if role in ("ADMIN", "DIRECTOR"):
            continue
        k = name_key(fname)
        if k and k not in by_key:
            by_key[k] = (uid, fname)
    if director_id is None:
        print("LỖI: không tìm thấy Giám đốc (người giao việc).", flush=True)
        conn.rollback()
        return 5

    # --- Đặt ngày & chủ trì (chỉ khi trống) ---
    if p_start is None and p_end is None:
        cur.execute("UPDATE projects SET start_date = %s, end_date = %s WHERE id = %s", (START, END, pid))
        print(f"  Đặt thời gian dự án: {START} -> {END} (đang trống)", flush=True)
    lead = by_key.get(LEAD_KEY)
    if p_lead is None and lead:
        cur.execute("UPDATE projects SET lead_id = %s WHERE id = %s", (lead[0], pid))
        print(f"  Đặt chủ trì: {lead[1]}", flush=True)

    created, skipped = 0, []
    for key, title, status, c_at, s_at, d_at in TASKS:
        person = by_key.get(key)
        if not person:
            skipped.append(f"{key} ({title})")
            continue
        uid, fname = person
        cur.execute(
            "INSERT INTO assignments (company_id, assigner_id, assignee_id, project_id, title, "
            "description, status, created_at, started_at, done_at) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (
                company_id, director_id, uid, pid, title, DEMO_NOTE, status,
                datetime.fromisoformat(c_at),
                datetime.fromisoformat(s_at) if s_at else None,
                datetime.fromisoformat(d_at) if d_at else None,
            ),
        )
        # Thêm vào thành viên dự án để hiện cột "Người thực hiện" (bỏ qua nếu đã có).
        cur.execute(
            "INSERT INTO project_members (project_id, user_id) SELECT %s, %s "
            "WHERE NOT EXISTS (SELECT 1 FROM project_members WHERE project_id = %s AND user_id = %s)",
            (pid, uid, pid, uid),
        )
        created += 1
        print(f"  + GIAO: {fname} — {title} [{status}]", flush=True)

    conn.commit()
    cur.close()
    conn.close()
    print(f"\nXONG: giao {created}/{len(TASKS)} việc mẫu cho dự án {pcode}.", flush=True)
    if skipped:
        print("Không tìm thấy người (bỏ qua): " + ", ".join(skipped), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
