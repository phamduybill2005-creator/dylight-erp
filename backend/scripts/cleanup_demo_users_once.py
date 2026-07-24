"""
Xóa các TÀI KHOẢN DEMO "1 tên" (giang@, son@, duong@, cao@, ...) trên PROD (Neon) —
chúng trùng với tài khoản THẬT dạng <initials>@dosco.vn (dhson@, nthgiang@, ...).
Đồng thời đưa DUY vào Phòng AI (cộng thêm).

AN TOÀN:
  - MẶC ĐỊNH chỉ BÁO CÁO (in toàn bộ user + danh sách sẽ xóa). Chỉ xóa khi env
    DELETE_CONFIRM=YES.
  - Quy tắc "1 tên" RẤT chặt: full_name KHÔNG có dấu cách VÀ KHÔNG có dấu chấm
    (tài khoản thật "N.V.CUONG" có chấm; "Phạm Duy" có cách -> đều KHÔNG bị chọn).
  - Bỏ qua ADMIN/Giám đốc và danh sách email được bảo vệ.
  - Xóa FK-safe (cột nullable -> NULL; NOT NULL -> xóa dòng) trong 1 transaction.
Chạy qua GitHub Actions (secret DATABASE_URL). Không import app.main (không seed).
"""
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # cho import app.*

from app.database import SessionLocal          # noqa: E402
from app.models import Base, User, UserRole     # noqa: E402

PROTECT_EMAILS = {
    "dvquang@dosco.vn", "dhson@dosco.vn", "duy@dosco.vn",
    "admin@dosco.vn", "giamdoc@dosco.vn",
}
DUY_EMAIL = "duy@dosco.vn"
AI_DEPT = "Phòng AI"


def is_demo(u: User) -> bool:
    if u.role in (UserRole.ADMIN, UserRole.DIRECTOR):
        return False
    if (u.email or "").lower() in PROTECT_EMAILS:
        return False
    name = (u.full_name or "").strip()
    return bool(name) and " " not in name and "." not in name


def purge_user_refs(db, uid: int) -> None:
    users_id = User.__table__.c.id
    refs = [
        (t, c)
        for t in Base.metadata.sorted_tables
        for c in t.columns
        if c is not users_id and any(fk.column is users_id for fk in c.foreign_keys)
    ]
    pending, guard = refs, 0
    while pending:
        guard += 1
        if guard > len(refs) + 5:
            raise RuntimeError(f"Khong giai quyet duoc thu tu FK: {pending}")
        still, prog = [], False
        for t, c in pending:
            sp = db.begin_nested()
            try:
                if c.nullable:
                    db.execute(t.update().where(c == uid).values({c.name: None}))
                else:
                    db.execute(t.delete().where(c == uid))
                sp.commit()
                prog = True
            except Exception:  # noqa: BLE001 — vuong FK thi thu vong sau
                sp.rollback()
                still.append((t, c))
        if not prog:
            raise RuntimeError(f"Vuong khoa ngoai: {still}")
        pending = still
    for u in db.query(User).filter(User.manager_ids.isnot(None)).all():
        parts = [x for x in str(u.manager_ids).split(",") if x.strip() and x.strip() != str(uid)]
        new = ",".join(parts) if parts else None
        if new != u.manager_ids:
            u.manager_ids = new


def main() -> int:
    db = SessionLocal()
    users = db.query(User).order_by(User.id).all()
    print(f"== TAT CA {len(users)} USERS ==", flush=True)
    for u in users:
        print(f"  #{u.id:>3} {u.email:28} | {u.full_name!r:22} | {u.role} | dept={u.department!r}",
              flush=True)

    targets = [u for u in users if is_demo(u)]
    print(f"\n== {len(targets)} TAI KHOAN DEMO (1-ten) SE XOA ==", flush=True)
    for u in targets:
        print(f"  #{u.id:>3} {u.email:28} | {u.full_name!r} | {u.role}", flush=True)

    confirm = os.environ.get("DELETE_CONFIRM", "").strip().upper() == "YES"
    if not confirm:
        print("\n(CHE DO BAO CAO — CHUA xoa. Dat DELETE_CONFIRM=YES de xoa that.)", flush=True)
        db.close()
        return 0

    for u in targets:
        purge_user_refs(db, u.id)
        db.delete(u)
    db.commit()
    print(f"\nDA XOA {len(targets)} tai khoan demo.", flush=True)

    duy = db.query(User).filter(User.email == DUY_EMAIL).first()
    if duy:
        parts = [d.strip() for d in (duy.department or "").split(",") if d.strip()]
        if AI_DEPT not in parts:
            parts.append(AI_DEPT)
            duy.department = ", ".join(parts)
            db.commit()
        print(f"DUY ({DUY_EMAIL}) dept = {duy.department!r}", flush=True)
    else:
        print(f"Khong tim thay {DUY_EMAIL}.", flush=True)

    db.close()
    print("XONG.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
