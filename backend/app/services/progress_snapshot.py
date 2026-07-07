"""
Chụp % tiến độ theo NGÀY để dựng "đường tiến độ" (quan sát từng ngày).

Mỗi lần gọi sẽ upsert điểm tiến độ của HÔM NAY cho 1 dự án:
- 1 dòng toàn dự án (department = "")
- mỗi phòng ban phụ trách 1 dòng (rollup từ các đầu việc thuộc nhóm của phòng đó)

Nhờ đó xem được mỗi ngày dự án / từng phòng làm tới đâu, mất bao lâu để hoàn thành.
Cách tính % giống _progress_percent ở router dự án (bình quân theo trọng số thành tiền).
"""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy.orm import Session

from app.database import vn_now
from app.models import ProjectItem, ProgressSnapshot


def _rollup(children: list[ProjectItem]) -> Decimal:
    """% bình quân theo trọng số thành tiền; chưa nhập tiền -> bình quân đều; rỗng -> 0."""
    if not children:
        return Decimal(0)

    def amt(it: ProjectItem) -> Decimal:
        return (it.quantity or Decimal(0)) * (it.unit_price or Decimal(0))

    def pct(it: ProjectItem) -> Decimal:
        return min(Decimal(100), max(Decimal(0), it.progress or Decimal(0)))

    total = sum((amt(i) for i in children), Decimal(0))
    if total > 0:
        value = sum((pct(i) * amt(i) for i in children), Decimal(0)) / total
    else:
        value = sum((pct(i) for i in children), Decimal(0)) / Decimal(len(children))
    return Decimal(value).quantize(Decimal("0.1"))


def snapshot_project(db: Session, project_id: int, company_id: int) -> None:
    """Upsert điểm tiến độ HÔM NAY (toàn dự án + từng phòng). Tự commit phần của mình."""
    items = db.query(ProjectItem).filter(ProjectItem.project_id == project_id).all()
    # Phòng ban gán ở cấp NHÓM cha -> map nhóm_id -> tên phòng.
    group_dept = {g.id: (g.department or "").strip() for g in items if g.parent_id is None}
    children = [i for i in items if i.parent_id is not None]

    by_dept: dict[str, list[ProjectItem]] = {}
    for c in children:
        by_dept.setdefault(group_dept.get(c.parent_id, ""), []).append(c)

    # "" = toàn dự án (tất cả đầu việc); mỗi phòng CÓ TÊN = 1 dòng riêng.
    targets: dict[str, Decimal] = {"": _rollup(children)}
    for dept, kids in by_dept.items():
        if dept:
            targets[dept] = _rollup(kids)

    today = vn_now().date()
    for dept, pct in targets.items():
        row = (
            db.query(ProgressSnapshot)
            .filter(
                ProgressSnapshot.project_id == project_id,
                ProgressSnapshot.snap_date == today,
                ProgressSnapshot.department == dept,
            )
            .first()
        )
        if row:
            row.percent = pct
        else:
            db.add(
                ProgressSnapshot(
                    company_id=company_id,
                    project_id=project_id,
                    snap_date=today,
                    department=dept,
                    percent=pct,
                )
            )
    db.commit()
