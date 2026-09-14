"""
Router SƠ ĐỒ TỔ CHỨC công ty (hiện ở trang chủ).

Trước đây sơ đồ bị cắm cứng trong frontend nên muốn đổi người phải sửa code rồi
deploy lại. Nay lưu ở DB dưới dạng JSON:

  - GET  /org-chart : ai đăng nhập cũng xem được (sơ đồ là thông tin chung).
  - PUT  /org-chart : CHỈ Giám đốc / Quản trị hệ thống / Quản lý CẤP CAO.

"Quản lý cấp cao" = quản lý KHÔNG có ai quản lý bên trên — cùng định nghĩa với
chấm công (_is_senior_manager_up ở attendance.py) và nhãn roleTitle ở frontend.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db, vn_now
from app.deps import get_current_user
from app.models import OrgChart, User, UserRole
from app.schemas import OrgChartData, OrgChartOut

router = APIRouter(prefix="/org-chart", tags=["Sơ đồ tổ chức"])


def _can_edit(user: User) -> bool:
    """Giám đốc / Quản trị hệ thống / Quản lý cấp cao (không có cấp trên)."""
    is_top = not user.manager_id and (not user.manager_ids or len(user.manager_ids) == 0)
    return user.role in (UserRole.ADMIN, UserRole.DIRECTOR) or (
        user.role == UserRole.MANAGER and is_top
    )


# Sơ đồ MẶC ĐỊNH — đúng bằng bản đang vẽ cứng ở frontend trước đây, để công ty
# nào chưa từng chỉnh sửa vẫn thấy nguyên sơ đồ cũ (không phải nhập lại từ đầu).
def _n(key, name, dept, jp, bg, text, border):
    return {
        "key": key, "name": name, "deptLabel": dept, "jpDeptLabel": jp,
        "bgClass": bg, "textClass": text, "borderColor": border,
    }


_DARK = "text-slate-900"
_LIGHT = "text-white"

DEFAULT_CHART: dict = {
    "level1": [
        _n("Giang", "GIANG", "Địa hình", "地形解析", "bg-cyan-400", _DARK, "border-cyan-500"),
        _n("Nhung", "NHUNG", "Địa hình", "地形解析", "bg-emerald-500", _DARK, "border-emerald-600"),
        _n("Đạt", "ĐẠT", "Địa hình", "地形解析", "bg-amber-500", _DARK, "border-amber-600"),
        _n("Dũng", "DŨNG", "Địa hình", "地形解析", "bg-green-500", _DARK, "border-green-600"),
    ],
    "level2": [
        _n("Cường", "CƯỜNG", "Địa hình", "地形解析", "bg-cyan-400", _DARK, "border-cyan-500"),
        _n("Phú", "PHÚ", "Địa hình", "地形解析", "bg-amber-500", _DARK, "border-amber-600"),
    ],
    "level3": [
        _n("Sơn", "SƠN", "Địa hình", "地形解析", "bg-green-500", _DARK, "border-green-600"),
    ],
    "level4Left": [
        _n("Lâm", "LÂM", "3D & Cầu đường", "3次設計、土木設計", "bg-blue-100", _DARK, "border-blue-300"),
    ],
    "level4Right": [
        _n("Bính", "BÍNH", "Cầu đường", "土木設計", "bg-blue-100", _DARK, "border-blue-300"),
    ],
    "level5Left": [
        _n("Quang", "QUANG", "Thiết kế 3D", "3次設計", "bg-amber-100", _DARK, "border-amber-300"),
    ],
    "level5Right": [
        _n("Cao", "CAO", "Cầu đường", "土木設計", "bg-emerald-100", _DARK, "border-emerald-300"),
        _n("Đức", "ĐỨC", "Cầu đường", "土木設計", "bg-emerald-100", _DARK, "border-emerald-300"),
        _n("Hùng", "HÙNG", "Cầu đường", "土木設計", "bg-blue-500", _LIGHT, "border-blue-600"),
    ],
    "level6Left": [
        _n("Hoàn", "HOÀN", "Thiết kế 3D", "3次設計", "bg-amber-100", _DARK, "border-amber-300"),
        _n("Duy", "DUY", "Thiết kế 3D", "3次設計", "bg-amber-100", _DARK, "border-amber-300"),
    ],
    "level6Right": [
        _n("Linh37", "LINH37", "Cầu đường", "土木設計", "bg-emerald-100", _DARK, "border-emerald-300"),
        _n("Quân", "QUÂN", "Cầu đường", "土木設計", "bg-emerald-100", _DARK, "border-emerald-300"),
        _n("Dương", "DƯƠNG", "Cầu đường", "土木設計", "bg-emerald-100", _DARK, "border-emerald-300"),
        _n("?????", "?????", "Cầu đường", "土木設計", "bg-blue-500", _LIGHT, "border-blue-600"),
        _n("Khải", "KHẢI", "Cầu đường", "土木設計", "bg-blue-500", _LIGHT, "border-blue-600"),
    ],
}

# Số ô tối đa mỗi cụm — chặn người dùng dán nhầm hàng trăm ô làm vỡ bố cục/nặng DB.
_MAX_PER_GROUP = 12

# Màu ô theo màu LÀN của bản 2 (chỉ dùng khi đổi ngược dữ liệu bản 2 về bản này).
_V2_COLOR = {
    "teal": ("bg-cyan-400", _DARK, "border-cyan-500"),
    "violet": ("bg-blue-100", _DARK, "border-blue-300"),
    "amber": ("bg-amber-100", _DARK, "border-amber-300"),
    "sky": ("bg-blue-500", _LIGHT, "border-blue-600"),
    "rose": ("bg-emerald-100", _DARK, "border-emerald-300"),
    "emerald": ("bg-emerald-500", _DARK, "border-emerald-600"),
}


def _from_v2(data: dict) -> dict:
    """Đổi dữ liệu BẢN 2 (departments + people, có cấp trên) về bố cục hàng cố định của
    bản này, để không mất người nếu DB đã lỡ lưu bằng giao diện làn phòng ban:
      lãnh đạo -> hàng 3; phòng thứ nhất -> hàng 2 (cấp 0) + hàng 1 (cấp dưới);
      phòng thứ hai -> nhánh trái (hàng 4/5/6); phòng còn lại -> nhánh phải.
    Lần lưu tiếp theo sẽ ghi lại đúng dạng của bản này."""
    depts = [d for d in (data.get("departments") or []) if isinstance(d, dict)]
    people = [p for p in (data.get("people") or []) if isinstance(p, dict) and (p.get("name") or "").strip()]
    dept_keys = {d.get("key") for d in depts}
    by_key = {p.get("key"): p for p in people}
    lane = lambda p: p.get("dept") if p.get("dept") in dept_keys else None  # noqa: E731

    def depth(p: dict, seen: set | None = None) -> int:
        seen = seen or set()
        if p.get("key") in seen:
            return 0
        seen.add(p.get("key"))
        par = by_key.get(p.get("parent")) if p.get("parent") else None
        return depth(par, seen) + 1 if par and lane(par) == lane(p) else 0

    def node(p: dict, d: dict | None) -> dict:
        extras = [x["name"] for x in depts if x.get("key") in (p.get("extraDepts") or [])]
        bg, text, border = _V2_COLOR.get((d or {}).get("color", ""), ("bg-green-500", _DARK, "border-green-600"))
        return {
            "key": (p.get("key") or p["name"]).strip(), "name": p["name"].strip(),
            "deptLabel": " & ".join([d["name"]] + extras) if d else "",
            "jpDeptLabel": (d or {}).get("jpName", "") or "",
            "bgClass": bg, "textClass": text, "borderColor": border,
        }

    out = {g: [] for g in ("level1", "level2", "level3", "level4Left", "level4Right", "level5Left", "level5Right", "level6Left", "level6Right")}
    for p in sorted((p for p in people if lane(p) is None), key=depth):
        out["level3"].append(node(p, None))
    for i, d in enumerate(depts):
        members = [p for p in people if lane(p) == d.get("key")]
        for p in members:
            k = depth(p)
            if i == 0:
                g = "level2" if k == 0 else "level1"
            else:
                side = "Left" if i == 1 else "Right"
                g = ("level4" if k == 0 else "level5" if k == 1 else "level6") + side
            out[g].append(node(p, d))
    return out


@router.get("", response_model=OrgChartOut)
def get_org_chart(
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Sơ đồ của công ty. Chưa từng chỉnh sửa -> trả sơ đồ mặc định."""
    row = db.query(OrgChart).filter(OrgChart.company_id == current.company_id).first()
    if row is None:
        return OrgChartOut(
            data=OrgChartData.model_validate(DEFAULT_CHART),
            can_edit=_can_edit(current),
        )
    stored = row.data or DEFAULT_CHART
    if isinstance(stored, dict) and "people" in stored:
        stored = _from_v2(stored)   # DB lỡ lưu bản 2 -> đổi ngược, không mất người
    return OrgChartOut(
        data=OrgChartData.model_validate(stored),
        updated_at=row.updated_at,
        updated_by_name=row.updated_by.full_name if row.updated_by else None,
        can_edit=_can_edit(current),
    )


@router.put("", response_model=OrgChartOut)
def save_org_chart(
    payload: OrgChartData,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Ghi đè toàn bộ sơ đồ. CHỈ Giám đốc / Quản trị / Quản lý cấp cao."""
    if not _can_edit(current):
        raise HTTPException(
            403,
            "Chỉ Giám đốc, Quản trị hệ thống hoặc Quản lý cấp cao mới được sửa sơ đồ tổ chức.",
        )

    data = payload.model_dump()

    for group, nodes in data.items():
        if len(nodes) > _MAX_PER_GROUP:
            raise HTTPException(400, f"Mỗi hàng tối đa {_MAX_PER_GROUP} ô (hàng '{group}' đang có {len(nodes)}).")
        for nd in nodes:
            if not (nd.get("name") or "").strip():
                raise HTTPException(400, "Tên nhân sự trong sơ đồ không được để trống.")

    # 'key' dùng để dò ra tài khoản ERP tương ứng -> không được trùng nhau.
    keys = [nd["key"] for nodes in data.values() for nd in nodes]
    dup = {k for k in keys if keys.count(k) > 1}
    if dup:
        raise HTTPException(400, f"Trùng mã nhân sự trong sơ đồ: {', '.join(sorted(dup))}")

    row = db.query(OrgChart).filter(OrgChart.company_id == current.company_id).first()
    if row is None:
        row = OrgChart(company_id=current.company_id)
        db.add(row)
    row.data = data
    row.updated_at = vn_now()
    row.updated_by_id = current.id
    db.commit()
    db.refresh(row)

    return OrgChartOut(
        data=OrgChartData.model_validate(row.data),
        updated_at=row.updated_at,
        updated_by_name=row.updated_by.full_name if row.updated_by else None,
        can_edit=True,
    )
