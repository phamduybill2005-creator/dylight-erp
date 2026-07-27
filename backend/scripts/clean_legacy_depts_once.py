"""
Dọn TÊN PHÒNG BAN CŨ còn sót trên hồ sơ nhân sự (PROD/Neon).

Công ty chỉ còn 4 phòng chính thức:
  Phòng Bản đồ · Phòng BIM · Phòng Thiết kế đường 2D · Phòng AI
Các tên cũ từ đợt seed đầu ("Thiết kế", "Địa hình", "Khảo sát") vẫn bám trên cột
users.department (VD Phạm Duy = "Thiết kế, Phòng AI") nên hiện lẫn trong ô chọn phòng ban.

Script BỎ các token cũ đó khỏi chuỗi department, giữ nguyên các phòng hợp lệ.
Người sau khi bỏ mà KHÔNG còn phòng nào -> để trống (NULL).
Idempotent. Chạy qua GitHub Actions (secret DATABASE_URL).
"""
import os
import sys

import psycopg2

LEGACY = {"thiết kế", "địa hình", "khảo sát"}   # so sánh không phân biệt hoa/thường


def main() -> int:
    db_url = os.environ.get("DATABASE_URL", "").strip()
    if not db_url:
        print("LOI: thieu DATABASE_URL.", flush=True)
        return 2

    conn = psycopg2.connect(db_url)
    conn.autocommit = False
    cur = conn.cursor()

    cur.execute(
        "SELECT id, email, full_name, department FROM users "
        "WHERE department IS NOT NULL AND department <> '' ORDER BY id"
    )
    rows = cur.fetchall()

    changes = []
    for uid, email, name, dept in rows:
        parts = [p.strip() for p in (dept or "").split(",") if p.strip()]
        kept = [p for p in parts if p.lower() not in LEGACY]
        if kept == parts:
            continue
        new = ", ".join(kept) if kept else None
        changes.append((uid, email, name, dept, new))

    print(f"== {len(changes)} HO SO CAN DON (trong {len(rows)}) ==", flush=True)
    for uid, email, name, old, new in changes:
        print(f"  #{uid} {email:24} | {name:14} | {old!r} -> {new!r}", flush=True)

    if not changes:
        print("Khong co gi de doi.", flush=True)
        conn.rollback()
        return 0

    for uid, _e, _n, _o, new in changes:
        cur.execute("UPDATE users SET department = %s WHERE id = %s", (new, uid))
    conn.commit()
    print(f"\nDA CAP NHAT {len(changes)} ho so.", flush=True)

    cur.close()
    conn.close()
    print("XONG.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
