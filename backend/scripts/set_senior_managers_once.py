"""
Chuẩn hóa QUẢN LÝ CẤP CAO trên PROD: SƠN (dhson@), LÂM (hklam@), BÍNH (ncbinh@)
là ĐẦU NHÁNH -> KHÔNG có ai quản lý bên trên (manager_id / manager_ids = NULL).

Vì sao cần: nhãn chức vụ ở giao diện (roleTitle) và quyền "cấp cao" ở backend đều
suy ra từ "không có ai quản lý bên trên". Hiện 2 người đang bị gán quản lý cấp trên
nên hiển thị nhầm "Quản lý cấp trung".

Idempotent — chạy lại không đổi gì thêm. Chạy qua GitHub Actions (secret DATABASE_URL).
"""
import os
import sys

import psycopg2

SENIOR_EMAILS = ["dhson@dosco.vn", "hklam@dosco.vn", "ncbinh@dosco.vn"]


def main() -> int:
    db_url = os.environ.get("DATABASE_URL", "").strip()
    if not db_url:
        print("LOI: thieu DATABASE_URL.", flush=True)
        return 2

    conn = psycopg2.connect(db_url)
    conn.autocommit = False
    cur = conn.cursor()

    cur.execute(
        "SELECT id, email, full_name, role, manager_id, manager_ids FROM users "
        "WHERE lower(email) = ANY(%s) ORDER BY id",
        (SENIOR_EMAILS,),
    )
    rows = cur.fetchall()
    print("== TRUOC ==", flush=True)
    for uid, email, name, role, mid, mids in rows:
        print(f"  #{uid} {email:22} | {name:12} | {role} | manager_id={mid} manager_ids={mids!r}",
              flush=True)

    if not rows:
        print("Khong tim thay tai khoan nao -> khong doi.", flush=True)
        conn.rollback()
        return 0

    cur.execute(
        "UPDATE users SET manager_id = NULL, manager_ids = NULL "
        "WHERE lower(email) = ANY(%s) AND (manager_id IS NOT NULL OR manager_ids IS NOT NULL)",
        (SENIOR_EMAILS,),
    )
    changed = cur.rowcount
    conn.commit()
    print(f"\nDA CAP NHAT {changed} tai khoan -> khong con quan ly ben tren.", flush=True)

    cur.execute(
        "SELECT id, email, full_name, role, manager_id, manager_ids FROM users "
        "WHERE lower(email) = ANY(%s) ORDER BY id",
        (SENIOR_EMAILS,),
    )
    print("== SAU ==", flush=True)
    for uid, email, name, role, mid, mids in cur.fetchall():
        print(f"  #{uid} {email:22} | {name:12} | {role} | manager_id={mid} manager_ids={mids!r}",
              flush=True)

    cur.close()
    conn.close()
    print("XONG.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
