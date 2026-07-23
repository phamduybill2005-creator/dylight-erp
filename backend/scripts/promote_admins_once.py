"""
Nâng tài khoản PHẠM DUY + SƠN lên QUẢN TRỊ HỆ THỐNG (role=ADMIN) trên PROD (Neon).

Chạy qua GitHub Actions (secret DATABASE_URL) — chuỗi kết nối Neon KHÔNG nằm trong
repo, nên thao tác dữ liệu prod đi theo pattern "script one-off + workflow"
(giống promote_son_admin_once.py / fix_duy_dept_once.py).

An toàn:
  - Khớp theo EMAIL chính xác (email là DUY NHẤT toàn hệ thống -> không lẫn công ty).
  - Mỗi người có DANH SÁCH email ứng viên; nâng ĐÚNG tài khoản đầu tiên tồn tại.
  - Idempotent: đã là ADMIN thì bỏ qua. Nếu đang khóa -> mở khóa để dùng được quyền.
  - Không tìm thấy -> BÁO CÁO, không làm hỏng gì (không raise).
Đổi role có thể HOÀN TÁC (hạ lại sau nếu cần).
"""
import os
import sys

import psycopg2

# Mỗi người: thử lần lượt các email; lấy tài khoản ĐẦU TIÊN tồn tại.
TARGETS = [
    ("PHAM DUY", ["duy@dosco.vn"]),
    ("SON", ["dhson@dosco.vn", "son@dosco.vn"]),
]


def main() -> int:
    db_url = os.environ.get("DATABASE_URL", "").strip()
    if not db_url:
        print("LOI: thieu DATABASE_URL.", flush=True)
        return 2

    conn = psycopg2.connect(db_url)
    conn.autocommit = False
    cur = conn.cursor()

    # In toàn bộ user để chẩn đoán (log Actions chỉ người có quyền repo xem được).
    cur.execute(
        "SELECT id, company_id, email, full_name, role, is_active FROM users "
        "ORDER BY company_id, id"
    )
    rows = cur.fetchall()
    by_email = {(e or "").lower(): (uid, cid, e, f, r, a)
                for uid, cid, e, f, r, a in rows}
    print("== USERS ==", flush=True)
    for uid, cid, email, fname, role, active in rows:
        print(f"  #{uid} c{cid} {email} | {fname} | {role}{'' if active else ' (khoa)'}",
              flush=True)

    changed = 0
    print("\n== NANG QUYEN ==", flush=True)
    for label, emails in TARGETS:
        hit = next((by_email[e.lower()] for e in emails if e.lower() in by_email), None)
        if not hit:
            print(f"  [{label}] KHONG tim thay tai khoan (da thu: {', '.join(emails)}) "
                  f"-> bo qua.", flush=True)
            continue
        uid, cid, email, fname, role, active = hit
        if role == "ADMIN":
            print(f"  [{label}] #{uid} {email} ({fname}) da la ADMIN -> khong doi.",
                  flush=True)
            continue
        cur.execute("UPDATE users SET role = 'ADMIN' WHERE id = %s", (uid,))
        note = ""
        if not active:
            cur.execute("UPDATE users SET is_active = TRUE WHERE id = %s", (uid,))
            note = " (dang khoa -> da mo khoa)"
        changed += 1
        print(f"  [{label}] DA NANG: #{uid} {email} ({fname}) {role} -> ADMIN{note}.",
              flush=True)

    if changed:
        conn.commit()
        print(f"\nDA COMMIT {changed} thay doi.", flush=True)
    else:
        conn.rollback()
        print("\nKhong co gi de doi (rollback).", flush=True)

    cur.close()
    conn.close()
    print("XONG.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
