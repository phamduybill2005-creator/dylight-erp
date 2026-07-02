"""
RESET DỮ LIỆU NGHIỆP VỤ — đưa ERP vào sử dụng thật (chạy 1 LẦN qua GitHub Actions).

Theo yêu cầu chủ doanh nghiệp (2026-07-02):
  XÓA: dự án, đấu thầu, hợp đồng, hóa đơn, thanh toán, dự toán hạng mục, tiến độ,
       giao việc, hồ sơ thiết kế, bảng lương (payroll), nhóm chat GẮN DỰ ÁN.
  ĐƯA VỀ 0: lương cơ bản + phụ cấp trong hồ sơ từng nhân viên (users.base_salary/allowance).
  GIỮ NGUYÊN: tài khoản (users), công ty, CHẤM CÔNG (attendance + yunatt_sync_log),
       biệt danh, đối tác, đánh giá, nghỉ phép, chat thường (không gắn dự án), thông báo,
       thiết bị, nhật ký.

AN TOÀN:
  - LUÔN sao lưu mọi bảng bị đụng ra CSV (thư mục ./backup) TRƯỚC khi xóa. Actions tải lên artifact.
  - DRY_RUN=true (mặc định): chỉ sao lưu + đếm số dòng SẼ xóa rồi ROLLBACK (không đổi gì).
  - Khi APPLY: bắt buộc RESET_CONFIRM == chuỗi mã đúng, ngược lại thoát ngay, không xóa.
  - Toàn bộ xóa nằm trong 1 transaction: lỗi -> rollback -> DB nguyên vẹn.

Chạy: đặt env DATABASE_URL (Neon), DRY_RUN (true/false), RESET_CONFIRM.
"""
from __future__ import annotations

import csv
import os
import sys

import psycopg2

EXPECTED_CONFIRM = "XOA-DU-LIEU-DU-AN"

# Tài khoản DEMO cũ (mật khẩu 123456) cần VÔ HIỆU khi đưa vào dùng thật.
# CHỐT AN TOÀN: chỉ vô hiệu nếu CÒN admin/giám đốc KHÁC đang hoạt động (chống tự khóa).
DEMO_EMAILS = ["giamdoc@dosco.vn", "admin@dosco.vn"]

# Bảng sao lưu đầy đủ (SELECT * -> CSV) trước khi xóa.
BACKUP_TABLES = [
    "projects", "bids", "contracts", "invoices", "payments", "project_items",
    "progress", "assignments", "design_documents", "project_members", "payroll",
    "conversations", "conversation_members", "chat_messages", "message_reactions",
]

BACKUP_DIR = os.path.join(os.path.dirname(__file__), "..", "backup")


def _log(msg: str) -> None:
    print(msg, flush=True)


def backup_query(cur, path: str, sql: str, params=None) -> int:
    cur.execute(sql, params or ())
    cols = [d[0] for d in cur.description]
    rows = cur.fetchall()
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(cols)
        w.writerows(rows)
    return len(rows)


def main() -> int:
    db_url = os.environ.get("DATABASE_URL", "").strip()
    if not db_url:
        _log("LỖI: thiếu DATABASE_URL.")
        return 2
    dry_run = os.environ.get("DRY_RUN", "true").strip().lower() != "false"
    confirm = os.environ.get("RESET_CONFIRM", "").strip()

    if not dry_run and confirm != EXPECTED_CONFIRM:
        _log(f"LỖI: chế độ APPLY nhưng RESET_CONFIRM sai. Cần nhập đúng: {EXPECTED_CONFIRM}")
        return 3

    os.makedirs(BACKUP_DIR, exist_ok=True)

    conn = psycopg2.connect(db_url)
    conn.autocommit = False
    cur = conn.cursor()

    # ---------- 1. SAO LƯU (SELECT, chưa đụng dữ liệu) ----------
    _log("== SAO LƯU (CSV) ==")
    total_backup = 0
    for t in BACKUP_TABLES:
        try:
            n = backup_query(cur, os.path.join(BACKUP_DIR, f"{t}.csv"), f"SELECT * FROM {t}")
            total_backup += n
            _log(f"  {t:22s} {n:6d} dòng -> backup/{t}.csv")
        except Exception as e:  # noqa: BLE001
            _log(f"  {t:22s} BỎ QUA (không đọc được: {e})")
            conn.rollback()
    # Snapshot lương nhân viên trước khi đưa về 0 (để có thể khôi phục).
    backup_query(
        cur,
        os.path.join(BACKUP_DIR, "users_salary_before_reset.csv"),
        "SELECT id, full_name, email, base_salary, allowance FROM users ORDER BY id",
    )
    _log("  users_salary_before_reset.csv (ảnh chụp lương trước khi reset)")
    # Sao lưu toàn bộ users (trạng thái trước) để có thể khôi phục nếu cần.
    backup_query(
        cur,
        os.path.join(BACKUP_DIR, "users_before_reset.csv"),
        "SELECT id, full_name, email, role, is_active, is_approved FROM users ORDER BY id",
    )
    _log("  users_before_reset.csv (ảnh chụp toàn bộ tài khoản)")

    # ---------- 2. XÓA (trong transaction) ----------
    _log("\n== XÓA (child -> parent) ==")
    deleted: dict[str, int] = {}

    def run(sql: str, params=None) -> int:
        cur.execute(sql, params or ())
        return cur.rowcount

    # 2a. Nhóm chat GẮN DỰ ÁN (giữ chat thường project_id IS NULL).
    cur.execute("SELECT id FROM conversations WHERE project_id IS NOT NULL")
    conv_ids = [r[0] for r in cur.fetchall()]
    if conv_ids:
        deleted["message_reactions(dự án)"] = run(
            "DELETE FROM message_reactions WHERE message_id IN "
            "(SELECT id FROM chat_messages WHERE conversation_id = ANY(%s))",
            (conv_ids,),
        )
        deleted["chat_messages(dự án)"] = run(
            "DELETE FROM chat_messages WHERE conversation_id = ANY(%s)", (conv_ids,)
        )
        deleted["conversation_members(dự án)"] = run(
            "DELETE FROM conversation_members WHERE conversation_id = ANY(%s)", (conv_ids,)
        )
        deleted["conversations(dự án)"] = run(
            "DELETE FROM conversations WHERE id = ANY(%s)", (conv_ids,)
        )

    # 2b. project_items tự tham chiếu (parent_id) -> xóa con trước, rồi cha.
    deleted["project_items(con)"] = run("DELETE FROM project_items WHERE parent_id IS NOT NULL")
    deleted["project_items(nhóm)"] = run("DELETE FROM project_items")

    # 2c. Các bảng con của projects/contracts (theo thứ tự FK an toàn).
    for t in [
        "payments", "invoices", "contracts",
        "progress", "assignments", "design_documents",
        "project_members", "payroll",
    ]:
        deleted[t] = run(f"DELETE FROM {t}")

    # 2d. Bảng cha.
    deleted["projects"] = run("DELETE FROM projects")
    deleted["bids"] = run("DELETE FROM bids")

    # 2e. Đưa lương trong hồ sơ nhân viên về 0.
    deleted["users.base_salary/allowance -> 0"] = run(
        "UPDATE users SET base_salary = 0, allowance = 0"
    )

    # 2f. VÔ HIỆU 2 tài khoản demo cũ (mật khẩu 123456) — CHỐT AN TOÀN chống tự khóa:
    #     chỉ khóa nếu CÒN >=1 admin/giám đốc KHÁC đang hoạt động (vd duy@dosco.vn).
    cur.execute(
        "SELECT count(*) FROM users "
        "WHERE role IN ('ADMIN','DIRECTOR') AND is_active = TRUE "
        "AND lower(email) <> ALL(%s)",
        ([e.lower() for e in DEMO_EMAILS],),
    )
    other_admins = cur.fetchone()[0]
    if other_admins >= 1:
        # is_active=FALSE chặn đăng nhập; token_version++ giết mọi phiên cũ đang mở.
        deleted["vô hiệu tài khoản demo"] = run(
            "UPDATE users SET is_active = FALSE, is_approved = FALSE, "
            "token_version = COALESCE(token_version,0) + 1 "
            "WHERE lower(email) = ANY(%s)",
            ([e.lower() for e in DEMO_EMAILS],),
        )
        _log(f"  (còn {other_admins} admin/giám đốc khác -> an toàn để vô hiệu tài khoản demo)")
    else:
        deleted["vô hiệu tài khoản demo"] = 0
        _log("  ⚠ BỎ QUA vô hiệu tài khoản demo: KHÔNG còn admin/giám đốc khác đang hoạt "
             "động -> tránh tự khóa toàn hệ thống. Hãy tạo/cấp quyền tài khoản của bạn trước.")

    for k, v in deleted.items():
        _log(f"  {k:34s} {v:6d} dòng")

    # ---------- 3. CHỐT ----------
    if dry_run:
        conn.rollback()
        _log("\n== DRY RUN: ĐÃ ROLLBACK — KHÔNG thay đổi gì. (Đặt mode=apply + confirm để xóa thật.) ==")
    else:
        conn.commit()
        _log("\n== ĐÃ COMMIT: dữ liệu nghiệp vụ đã reset; 2 tài khoản demo đã vô hiệu (nếu đủ điều kiện). "
             "Tài khoản nhân viên thật + chấm công GIỮ NGUYÊN. ==")

    cur.close()
    conn.close()
    _log(f"\nTổng sao lưu: {total_backup} dòng trong ./backup (kèm ảnh lương).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
