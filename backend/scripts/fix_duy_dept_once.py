"""
DUY thuộc cả Phòng BIM và Phòng AI — chẩn đoán & sửa 1 LẦN trên PROD (GitHub Actions).

Vì sao cần: backfill phòng ban + giao việc mẫu đều khớp theo TÊN trong CÔNG TY ĐẦU TIÊN
và bỏ qua ADMIN/DIRECTOR, nên nếu tài khoản của DUY là ADMIN hoặc nằm ở công ty khác
thì bị bỏ sót. Script này:
  1. In danh sách user (chẩn đoán — log Actions chỉ người có quyền repo xem được).
  2. Tìm tài khoản DUY (email duy@dosco.vn hoặc tên kết thúc bằng DUY) trong công ty đầu.
  3. Nếu thấy: GỘP thêm "Phòng BIM, Phòng AI" vào department (không xóa phòng đã có),
     và giao việc mẫu trong dự án 00-0000 nếu chưa có (kèm project_members).
  4. Nếu không thấy trong công ty đầu: chỉ BÁO CÁO (không tự chuyển công ty tài khoản).

Idempotent: chạy lại không tạo trùng. Chạy: đặt env DATABASE_URL (Neon).
"""
import os
import re
import sys
import unicodedata
from datetime import datetime

import psycopg2

DEMO_EMAILS = {"giamdoc@dosco.vn", "quanly@dosco.vn", "ketoan@dosco.vn", "hientruong@dosco.vn", "admin@dosco.vn"}
WANT_DEPTS = ["Phòng BIM", "Phòng AI"]
DEMO_NOTE = "Việc mẫu để xem thử bảng tiến độ ngày — có thể đổi trạng thái hoặc xóa (nút thùng rác ở tab Phân công)."
TASK = ("Viết hướng dẫn quy trình BIM nội bộ", "IN_PROGRESS", "2026-07-04T10:00", "2026-07-06T08:30")


def name_key(full_name: str) -> str:
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

    cur.execute("SELECT id FROM companies ORDER BY id LIMIT 1")
    company_id = cur.fetchone()[0]

    # 1) Chẩn đoán: toàn bộ user (id, công ty, email, tên, vai trò, phòng ban).
    cur.execute(
        "SELECT id, company_id, email, full_name, role, is_active, COALESCE(department,'') "
        "FROM users ORDER BY company_id, id"
    )
    print("== USERS ==", flush=True)
    rows = cur.fetchall()
    for uid, cid, email, fname, role, active, dept in rows:
        print(f"  #{uid} c{cid} {email} | {fname} | {role}{'' if active else ' (khóa)'} | [{dept}]", flush=True)

    # 2) Tìm DUY trong công ty đầu tiên.
    target = None
    for uid, cid, email, fname, role, active, dept in rows:
        if cid != company_id or (email or "").lower() in DEMO_EMAILS or not active:
            continue
        if (email or "").lower() == "duy@dosco.vn" or name_key(fname) == "DUY":
            target = (uid, email, fname, dept)
            break
    if not target:
        others = [f"#{u} c{c} {e} ({f}, {r})" for u, c, e, f, r, a, d in rows
                  if (e or "").lower() == "duy@dosco.vn" or name_key(f) == "DUY"]
        print("\nKHÔNG thấy tài khoản DUY trong công ty đầu tiên.", flush=True)
        print("Ứng viên ở nơi khác: " + ("; ".join(others) if others else "KHÔNG có"), flush=True)
        print("-> Cần quyết định: chuyển tài khoản sang công ty DOSCO hoặc tạo tài khoản mới.", flush=True)
        conn.rollback()
        return 0

    uid, email, fname, dept = target
    print(f"\nDUY = #{uid} {email} ({fname}), phòng hiện tại: [{dept}]", flush=True)

    # 3) Gộp phòng ban (giữ phòng đã có, thêm BIM + AI nếu thiếu).
    parts = [p.strip() for p in (dept or "").split(",") if p.strip()]
    for w in WANT_DEPTS:
        if w not in parts:
            parts.append(w)
    new_dept = ", ".join(parts)
    if new_dept != (dept or ""):
        cur.execute("UPDATE users SET department = %s WHERE id = %s", (new_dept, uid))
        print(f"  Cập nhật phòng ban: [{new_dept}]", flush=True)
    else:
        print("  Phòng ban đã đúng — không đổi.", flush=True)

    # 4) Giao việc mẫu trong dự án 00-0000 (nếu dự án tồn tại & DUY chưa có việc ở đó).
    cur.execute(
        "SELECT id FROM projects WHERE company_id = %s AND code = '00-0000' ORDER BY id LIMIT 1",
        (company_id,),
    )
    prow = cur.fetchone()
    if prow:
        pid = prow[0]
        cur.execute(
            "SELECT 1 FROM assignments WHERE project_id = %s AND assignee_id = %s LIMIT 1", (pid, uid)
        )
        if cur.fetchone():
            print("  Việc mẫu đã có — không tạo lại.", flush=True)
        else:
            cur.execute("SELECT id FROM users WHERE company_id = %s AND role = 'DIRECTOR' ORDER BY id LIMIT 1", (company_id,))
            drow = cur.fetchone()
            assigner = drow[0] if drow else uid
            title, status, c_at, s_at = TASK
            cur.execute(
                "INSERT INTO assignments (company_id, assigner_id, assignee_id, project_id, title, "
                "description, status, created_at, started_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                (company_id, assigner, uid, pid, title, DEMO_NOTE, status,
                 datetime.fromisoformat(c_at), datetime.fromisoformat(s_at)),
            )
            cur.execute(
                "INSERT INTO project_members (project_id, user_id) SELECT %s, %s "
                "WHERE NOT EXISTS (SELECT 1 FROM project_members WHERE project_id = %s AND user_id = %s)",
                (pid, uid, pid, uid),
            )
            print(f"  + GIAO: {fname} — {title} [{status}]", flush=True)
    else:
        print("  Không thấy dự án 00-0000 — bỏ qua phần giao việc.", flush=True)

    conn.commit()
    cur.close()
    conn.close()
    print("\nXONG.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
