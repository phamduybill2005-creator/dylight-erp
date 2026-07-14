"""
Đổi tên phòng ban "Phòng Khảo sát" -> "Phòng Bản đồ" trên PROD (Neon) — chạy 1 LẦN
qua GitHub Actions (secret DATABASE_URL). Làm y hệt cascade của router PATCH /departments:
  1. Đổi tên dòng trong bảng `departments`.
  2. users.department: chuỗi nhiều phòng ngăn bởi dấu phẩy -> thay ĐÚNG token.
  3. project_items.department: khớp tuyệt đối.
  4. progress_snapshots.department: đổi tên, tránh vi phạm UNIQUE (project, ngày, phòng).

Idempotent: nếu không còn "Phòng Khảo sát" (đã đổi) thì chỉ báo cáo, không đổi gì.
"""
import os
import sys

import psycopg2

OLD = "Phòng Khảo sát"
NEW = "Phòng Bản đồ"


def _norm(s: str | None) -> str:
    return " ".join((s or "").split()).casefold()


def main() -> int:
    db_url = os.environ.get("DATABASE_URL", "").strip()
    if not db_url:
        print("LOI: thieu DATABASE_URL.", flush=True)
        return 2

    conn = psycopg2.connect(db_url)
    conn.autocommit = False
    cur = conn.cursor()

    cur.execute("SELECT id, company_id, name FROM departments ORDER BY company_id, id")
    rows = cur.fetchall()
    print("== DEPARTMENTS ==", flush=True)
    for did, cid, name in rows:
        print(f"  #{did} c{cid} [{name}]", flush=True)

    targets = [(did, cid) for did, cid, name in rows if _norm(name) == _norm(OLD)]
    if not targets:
        already = any(_norm(n) == _norm(NEW) for _, _, n in rows)
        print(f"\nKHONG thay phong '{OLD}'." +
              (f" (co ve da doi sang '{NEW}')" if already else ""), flush=True)
        conn.rollback()
        return 0

    users_changed = 0
    for did, cid in targets:
        # 1) đổi tên phòng — nếu công ty ĐÃ có phòng tên mới thì GỘP (xóa dòng cũ để
        #    không vi phạm UNIQUE(company_id, name)); vẫn cascade tham chiếu cũ -> mới.
        cur.execute(
            "SELECT id FROM departments WHERE company_id = %s AND lower(name) = lower(%s) AND id <> %s",
            (cid, NEW, did),
        )
        if cur.fetchone():
            cur.execute("DELETE FROM departments WHERE id = %s", (did,))
            print(f"  c{cid}: da co '{NEW}' -> gop, xoa dong '{OLD}'", flush=True)
        else:
            cur.execute("UPDATE departments SET name = %s WHERE id = %s", (NEW, did))

        # 2) users.department (token chính xác trong chuỗi nhiều phòng)
        cur.execute(
            "SELECT id, department FROM users "
            "WHERE company_id = %s AND department IS NOT NULL AND department <> ''",
            (cid,),
        )
        for uid, dept in cur.fetchall():
            toks = [t.strip() for t in dept.split(",") if t.strip()]
            if OLD not in toks:
                continue
            seen: set[str] = set()
            out: list[str] = []
            for t in toks:
                nt = NEW if t == OLD else t
                if nt not in seen:
                    seen.add(nt)
                    out.append(nt)
            newdept = ", ".join(out)
            if newdept != dept:
                cur.execute("UPDATE users SET department = %s WHERE id = %s", (newdept, uid))
                users_changed += 1

        # 3) project_items.department
        cur.execute(
            "UPDATE project_items SET department = %s WHERE company_id = %s AND department = %s",
            (NEW, cid, OLD),
        )

        # 4) progress_snapshots.department (tránh trùng UNIQUE)
        cur.execute(
            "UPDATE progress_snapshots SET department = %s "
            "WHERE company_id = %s AND department = %s "
            "AND NOT EXISTS (SELECT 1 FROM progress_snapshots s2 "
            "WHERE s2.project_id = progress_snapshots.project_id "
            "AND s2.snap_date = progress_snapshots.snap_date "
            "AND s2.department = %s)",
            (NEW, cid, OLD, NEW),
        )

    conn.commit()
    print(f"\nDA DOI '{OLD}' -> '{NEW}' cho {len(targets)} cong ty; "
          f"cap nhat phong ban cho {users_changed} nhan su.", flush=True)
    cur.close()
    conn.close()
    print("XONG.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
