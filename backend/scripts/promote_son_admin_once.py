"""
Nâng tài khoản của SƠN lên QUẢN TRỊ VIÊN (role=ADMIN) — chạy 1 LẦN trên PROD
(GitHub Actions, dùng secret DATABASE_URL = Neon).

Vì sao dùng script: chuỗi kết nối Neon KHÔNG nằm trong repo (chỉ ở env Render +
secret Actions), nên thao tác dữ liệu prod đi theo pattern "script one-off + workflow"
(giống fix_duy_dept_once.py).

Cách xác định SƠN — an toàn, không đoán bừa:
  1. In toàn bộ user (chẩn đoán; chỉ người có quyền repo xem được log Actions).
  2. Ưu tiên khớp EMAIL 'dhson@dosco.vn' (email là DUY NHẤT toàn hệ thống).
  3. Nếu không có email đó: khớp theo TÊN kết thúc bằng "SON" (bỏ dấu/bỏ số),
     loại tài khoản demo & tài khoản đã khóa.
  4. Chỉ nâng quyền khi xác định được ĐÚNG 1 người. Nếu 0 hoặc >1 -> chỉ BÁO CÁO,
     KHÔNG đổi gì (rollback).

Idempotent: nếu đã là ADMIN thì không đổi. Đổi role có thể hoàn tác (hạ lại sau).
"""
import os
import re
import sys
import unicodedata

import psycopg2

SON_EMAIL = "dhson@dosco.vn"
DEMO_EMAILS = {
    "giamdoc@dosco.vn", "quanly@dosco.vn", "ketoan@dosco.vn",
    "hientruong@dosco.vn", "admin@dosco.vn",
}


def name_key(full_name: str) -> str:
    """'D.H.SON' / 'Nguyễn Văn Sơn' -> 'SON'. Bỏ dấu + bỏ mọi ký tự không phải chữ."""
    tokens = (full_name or "").replace(".", " ").split()
    if not tokens:
        return ""
    t = unicodedata.normalize("NFD", tokens[-1])
    t = "".join(ch for ch in t if unicodedata.category(ch) != "Mn")
    t = t.replace("Đ", "D").replace("đ", "d")
    return re.sub(r"[^A-Za-z]", "", t).upper()


def main() -> int:
    db_url = os.environ.get("DATABASE_URL", "").strip()
    if not db_url:
        print("LỖI: thiếu DATABASE_URL.", flush=True)
        return 2

    conn = psycopg2.connect(db_url)
    conn.autocommit = False
    cur = conn.cursor()

    cur.execute(
        "SELECT id, company_id, email, full_name, role, is_active FROM users "
        "ORDER BY company_id, id"
    )
    rows = cur.fetchall()
    print("== USERS ==", flush=True)
    for uid, cid, email, fname, role, active in rows:
        print(f"  #{uid} c{cid} {email} | {fname} | {role}{'' if active else ' (khoa)'}", flush=True)

    # 1) Ưu tiên khớp email (duy nhất). 2) Dự phòng: tên "SON", còn hoạt động, không demo.
    by_email = [r for r in rows if (r[2] or "").lower() == SON_EMAIL]
    if by_email:
        candidates = by_email
        how = f"email {SON_EMAIL}"
    else:
        candidates = [
            r for r in rows
            if name_key(r[3]) == "SON"
            and (r[2] or "").lower() not in DEMO_EMAILS
            and r[5]  # is_active
        ]
        how = 'ten ket thuc bang "SON"'

    if len(candidates) != 1:
        print(f"\nKHONG the xac dinh duy nhat tai khoan SON (khop theo {how}).", flush=True)
        print("Ung vien: " + (
            "; ".join(f"#{u} c{c} {e} ({f}, {r})" for u, c, e, f, r, a in candidates)
            if candidates else "KHONG co"
        ), flush=True)
        print("-> KHONG doi gi. Hay cho biet dung email/ID cua Son de nang quyen.", flush=True)
        conn.rollback()
        return 0

    uid, cid, email, fname, role, active = candidates[0]
    print(f"\nSON = #{uid} c{cid} {email} ({fname}), role hien tai: {role}"
          f"{'' if active else ' (dang KHOA)'}", flush=True)

    if role == "ADMIN":
        print("  Da la ADMIN — khong doi.", flush=True)
        conn.rollback()
        return 0

    cur.execute("UPDATE users SET role = 'ADMIN' WHERE id = %s", (uid,))
    if not active:
        # Nếu đang khóa thì mở để dùng được quyền quản trị.
        cur.execute("UPDATE users SET is_active = TRUE WHERE id = %s", (uid,))
        print("  (Tai khoan dang khoa -> da mo khoa)", flush=True)
    conn.commit()
    print(f"  DA NANG QUYEN: #{uid} {email} -> ADMIN (quan tri vien).", flush=True)

    cur.close()
    conn.close()
    print("\nXONG.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
