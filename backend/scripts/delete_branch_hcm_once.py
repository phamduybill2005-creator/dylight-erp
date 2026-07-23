"""
XÓA HẲN chi nhánh "Chi nhánh Miền Nam DOSCO" (code = DOSCO-HCM) + TOÀN BỘ dữ liệu
thuộc nó trên PROD (Neon). Chạy qua GitHub Actions (secret DATABASE_URL).

AN TOÀN:
  - Chỉ xóa công ty có code = 'DOSCO-HCM'. TỪ CHỐI nếu là công ty chính 'DOSCO'.
  - Không thấy chi nhánh -> báo cáo, không làm gì (idempotent, chạy lại vô hại).
  - In BÁO CÁO số dòng sẽ xóa từng bảng TRƯỚC khi xóa (xem trong log Actions).
  - Xóa mọi bảng có cột company_id theo VÒNG LẶP RETRY để thỏa mãn khóa ngoại,
    rồi xóa dòng công ty. TẤT CẢ trong 1 transaction — lỗi giữa chừng thì rollback
    toàn bộ (không xóa nham nhở). Bảng liên kết project_members tự xóa nhờ ON DELETE
    CASCADE khi xóa users/projects.

Xóa dữ liệu là KHÔNG hoàn tác — chỉ chạy khi đã xác nhận.
"""
import os
import sys

import psycopg2

TARGET_CODE = "DOSCO-HCM"     # chi nhánh cần xóa
MAIN_CODE = "DOSCO"           # công ty chính — TUYỆT ĐỐI không xóa


def main() -> int:
    db_url = os.environ.get("DATABASE_URL", "").strip()
    if not db_url:
        print("LOI: thieu DATABASE_URL.", flush=True)
        return 2

    conn = psycopg2.connect(db_url)
    conn.autocommit = False
    cur = conn.cursor()

    # Liệt kê công ty để chẩn đoán.
    cur.execute("SELECT id, code, name FROM companies ORDER BY id")
    rows = cur.fetchall()
    print("== COMPANIES ==", flush=True)
    for i, c, n in rows:
        print(f"  #{i} [{c}] {n}", flush=True)

    target = next((r for r in rows if (r[1] or "") == TARGET_CODE), None)
    if not target:
        print(f"\nKhong tim thay chi nhanh code={TARGET_CODE} -> khong lam gi.", flush=True)
        conn.rollback()
        return 0
    cid, code, name = target
    if code == MAIN_CODE:
        print("TU CHOI: khong duoc xoa cong ty chinh.", flush=True)
        conn.rollback()
        return 1

    print(f"\n>> SE XOA cong ty #{cid} [{code}] {name} va TOAN BO du lieu cua no.", flush=True)

    # Mọi bảng có cột company_id (trừ 'companies').
    cur.execute(
        """SELECT table_name FROM information_schema.columns
           WHERE column_name = 'company_id' AND table_schema = 'public'
             AND table_name <> 'companies'"""
    )
    tables = sorted(r[0] for r in cur.fetchall())

    print("\n== So dong se xoa (company_id = %d) ==" % cid, flush=True)
    total = 0
    for t in tables:
        cur.execute(f'SELECT count(*) FROM "{t}" WHERE company_id = %s', (cid,))
        n = cur.fetchone()[0]
        if n:
            print(f"  {t}: {n}", flush=True)
            total += n
    print(f"  (tong cong {total} dong + 1 cong ty)", flush=True)

    # Xóa theo vòng lặp: bảng nào vướng FK thì để lại thử vòng sau (dùng SAVEPOINT).
    remaining = list(tables)
    guard = 0
    while remaining:
        guard += 1
        if guard > len(tables) + 5:
            print("LOI: khong the giai quyet thu tu khoa ngoai:", remaining, flush=True)
            conn.rollback()
            return 1
        still = []
        progressed = False
        for t in remaining:
            cur.execute("SAVEPOINT sp")
            try:
                cur.execute(f'DELETE FROM "{t}" WHERE company_id = %s', (cid,))
                cur.execute("RELEASE SAVEPOINT sp")
                progressed = True
            except psycopg2.Error:
                cur.execute("ROLLBACK TO SAVEPOINT sp")
                still.append(t)
        if not progressed:
            print("LOI: con vuong khoa ngoai (co the du lieu cong ty khac tham chieu):",
                  still, flush=True)
            conn.rollback()
            return 1
        remaining = still

    cur.execute("DELETE FROM companies WHERE id = %s", (cid,))
    conn.commit()
    print(f"\nDA XOA xong chi nhanh [{code}] {name}. Hoan tat.", flush=True)

    cur.close()
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
