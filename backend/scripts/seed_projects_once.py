"""
Nạp 17 dự án (bảng Excel Nhật–Việt) vào DB — chạy 1 LẦN qua GitHub Actions.

An toàn:
  - Tự thêm cột group_name/geo_manager/dosco_manager nếu thiếu (ADD COLUMN IF NOT EXISTS).
  - KHÔNG tạo trùng: bỏ qua dự án có Mã QL (code) đã tồn tại trong cùng công ty.
  - Chỉ THÊM, không sửa/không xoá gì.

Chạy: đặt env DATABASE_URL (Neon).
"""
import os
import sys

import psycopg2

# (管理番号, プロジェクト名, グループ, GEO担当, DOSCO担当)
PROJECTS = [
    ("2738-0480", "ERE三種五城目風力発電事業詳細設計_フジタ", "土木設計", "池上", "DUC"),
    ("2735-0214", "松阪飯南", "土木設計", "池上", "CAO"),
    ("2838-0050", "能登町農地災害（ARIAKE）", "土木設計", "宮本", "BINH"),
    ("8137-0609", "グリーンパワーいちき串木野", "土木設計", "鳥越", "HUNG"),
    ("2737-0315", "唐津風力", "土木設計", "鳥越", "HUNG"),
    ("2738-0608", "下桶売風力発電事業概略設計", "土木設計", "宮本", "HUNG"),
    ("2734-0347", "西郷村太陽光", "土木設計", "池上", "LAM"),
    ("2738-0543", "枝幸風力発電所", "土木設計", "才ノ平", "HUNG"),
    ("2739-0092", "枝幸風力", "土木設計", "宮本", "HUNG"),
    ("2738-0295", "会津みなと風力発電事業_COP", "土木設計", "宮本", "CAO"),
    ("2738-0087", "EREノソウケ峠風力発電事業", "土木設計", "宮本", "DUC"),
    ("2734-0765", "国見岳", "土木設計", "鳥越", "HUNG"),
    ("2739-0124", "VENA_いちき串木野", "土木設計", "鳥越", "HUNG"),
    ("8138-0709", "日田市蓄電所開発申請", "土木設計", "丸澤", "CAO"),
    ("2738-0719", "七戸八幡岳風力", "土木設計", "才ノ平", "HUNG"),
    ("2737-0455", "あさひ風力", "土木設計", "鳥越", "CAO"),
    ("2738-0830", "郡山風力", "土木設計", "宮本", "CAO"),
]


def main() -> int:
    db_url = os.environ.get("DATABASE_URL", "").strip()
    if not db_url:
        print("LỖI: thiếu DATABASE_URL.", flush=True)
        return 2

    conn = psycopg2.connect(db_url)
    conn.autocommit = False
    cur = conn.cursor()

    # Tự thêm cột nếu backend chưa deploy migration (an toàn, idempotent).
    for col in ("group_name", "geo_manager", "dosco_manager"):
        cur.execute(f"ALTER TABLE projects ADD COLUMN IF NOT EXISTS {col} VARCHAR(255)")

    # Công ty mục tiêu = công ty đầu tiên (hệ hiện chỉ 1 công ty DOSCO).
    cur.execute("SELECT id, name FROM companies ORDER BY id LIMIT 1")
    row = cur.fetchone()
    if not row:
        print("LỖI: chưa có công ty nào trong DB.", flush=True)
        return 3
    company_id, company_name = row
    print(f"Công ty: #{company_id} {company_name}", flush=True)

    inserted, skipped = 0, 0
    for code, name, grp, geo, dosco in PROJECTS:
        cur.execute(
            "SELECT 1 FROM projects WHERE company_id = %s AND code = %s", (company_id, code)
        )
        if cur.fetchone():
            skipped += 1
            print(f"  BỎ QUA (đã có): {code} — {name}", flush=True)
            continue
        cur.execute(
            "INSERT INTO projects (company_id, code, name, group_name, geo_manager, dosco_manager, status) "
            "VALUES (%s, %s, %s, %s, %s, %s, 'PLANNING')",
            (company_id, code, name, grp, geo, dosco),
        )
        inserted += 1
        print(f"  + THÊM: {code} — {name} | GEO {geo} | DOSCO {dosco}", flush=True)

    conn.commit()
    cur.close()
    conn.close()
    print(f"\nXONG: thêm {inserted}, bỏ qua {skipped} (đã có). Tổng gửi: {len(PROJECTS)}.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
