"""
Router SƠ ĐỒ TỔ CHỨC công ty (hiện ở trang chủ).
  - GET  /org-chart : ai đăng nhập cũng xem được (sơ đồ là thông tin chung).
  - PUT  /org-chart : CHỈ Giám đốc / Quản trị hệ thống / Quản lý CẤP CAO.
"Quản lý cấp cao" = quản lý KHÔNG có ai quản lý bên trên — cùng định nghĩa với
chấm công (_is_senior_manager_up ở attendance.py) và nhãn roleTitle ở frontend.

DỮ LIỆU (JSON trong org_charts.data) — PHIÊN BẢN 2, vẽ theo LÀN PHÒNG BAN:
  departments: [{key, name, jpName, color}]           mỗi phòng = 1 làn, màu chọn từ _COLORS
  people:      [{key, name, title, dept, extraDepts, parent}]
    key        họ tên tài khoản ERP (để liên kết & xem hồ sơ) hoặc tên tự đặt — không trùng
    dept       key phòng ban; None = LÃNH ĐẠO, vẽ ở trên cùng, không thuộc làn nào
    extraDepts phòng kiêm nhiệm (chỉ ghi nhãn, không vẽ thêm ô)
    parent     key cấp trên trực tiếp (None = không có) -> frontend tự xếp cấp trong làn
Bản cũ (phiên bản 1: level1..level6Right, mỗi ô tự chọn màu) được TỰ CHUYỂN khi
đọc; lần lưu đầu tiên sau đó ghi hẳn sang dạng mới. Không cần migration DB.
"""
import re
import unicodedata

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db, vn_now
from app.deps import get_current_user
from app.models import OrgChart, User, UserRole
from app.schemas import OrgChartData, OrgChartOut

router = APIRouter(prefix="/org-chart", tags=["Sơ đồ tổ chức"])

# Màu làn — CỐ ĐỊNH, khớp COLOR_STYLE ở frontend (Tailwind chỉ sinh class có trong mã nguồn).
_COLORS = ("teal", "violet", "amber", "sky", "rose", "emerald")
_MAX_DEPARTMENTS = 8
_MAX_PEOPLE = 80


def _can_edit(user: User) -> bool:
    """Giám đốc / Quản trị hệ thống / Quản lý cấp cao (không có cấp trên)."""
    is_top = not user.manager_id and (not user.manager_ids or len(user.manager_ids) == 0)
    return user.role in (UserRole.ADMIN, UserRole.DIRECTOR) or (
        user.role == UserRole.MANAGER and is_top
    )


# ----------------------------------------------------------------- tiện ích
def _fold(s: str) -> str:
    """Bỏ dấu tiếng Việt, về chữ thường: 'Cầu đường' -> 'cau duong'."""
    s = s.replace("đ", "d").replace("Đ", "D")
    s = "".join(ch for ch in unicodedata.normalize("NFD", s) if unicodedata.category(ch) != "Mn")
    return s.lower()


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", _fold(s)).strip("-") or "phong"


def _given_name(full_name: str) -> str:
    """'D.V.QUANG' -> 'QUANG' (tên hiển thị ngắn như các ô sẵn có)."""
    return (full_name.split(".")[-1] or full_name).strip().upper()


# --------------------------------------------------- sơ đồ mặc định (bản cũ)
# Đúng bằng bản đang vẽ cứng ở frontend trước đây; được chuyển sang dạng mới khi
# đọc, để công ty nào chưa từng chỉnh sửa vẫn thấy nguyên bộ nhân sự cũ.
def _n(key, name, dept, jp):
    return {"key": key, "name": name, "deptLabel": dept, "jpDeptLabel": jp}


_LEGACY_DEFAULT: dict = {
    "level1": [
        _n("Giang", "GIANG", "Địa hình", "地形解析"),
        _n("Nhung", "NHUNG", "Địa hình", "地形解析"),
        _n("Đạt", "ĐẠT", "Địa hình", "地形解析"),
        _n("Dũng", "DŨNG", "Địa hình", "地形解析"),
    ],
    "level2": [
        _n("Cường", "CƯỜNG", "Địa hình", "地形解析"),
        _n("Phú", "PHÚ", "Địa hình", "地形解析"),
    ],
    "level3": [_n("Sơn", "SƠN", "Địa hình", "地形解析")],
    "level4Left": [_n("Lâm", "LÂM", "3D & Cầu đường", "3次設計、土木設計")],
    "level4Right": [_n("Bính", "BÍNH", "Cầu đường", "土木設計")],
    "level5Left": [_n("Quang", "QUANG", "Thiết kế 3D", "3次設計")],
    "level5Right": [
        _n("Cao", "CAO", "Cầu đường", "土木設計"),
        _n("Đức", "ĐỨC", "Cầu đường", "土木設計"),
        _n("Hùng", "HÙNG", "Cầu đường", "土木設計"),
    ],
    "level6Left": [
        _n("Hoàn", "HOÀN", "Thiết kế 3D", "3次設計"),
        _n("Duy", "DUY", "Thiết kế 3D", "3次設計"),
    ],
    "level6Right": [
        _n("Linh37", "LINH37", "Cầu đường", "土木設計"),
        _n("Quân", "QUÂN", "Cầu đường", "土木設計"),
        _n("Dương", "DƯƠNG", "Cầu đường", "土木設計"),
        _n("?????", "?????", "Cầu đường", "土木設計"),
        _n("Khải", "KHẢI", "Cầu đường", "土木設計"),
    ],
}

_LEGACY_GROUPS = (
    "level1", "level2", "level3", "level4Left", "level4Right",
    "level5Left", "level5Right", "level6Left", "level6Right",
)


def _is_legacy(data) -> bool:
    return isinstance(data, dict) and "people" not in data and any(g in data for g in _LEGACY_GROUPS)


def _migrate_v1(old: dict, director_name: str | None = None) -> dict:
    """Chuyển sơ đồ bản cũ (các hàng cố định) sang dạng phòng ban + cấp trên.

    Bản cũ vẽ: hàng 1 (nhân viên) — hàng 2 (quản lý) — hàng 3 (Sơn) — rồi tách
    2 nhánh: trái = 3D (hàng 4/5/6 Left), phải = Cầu đường (hàng 4/5/6 Right).
    Quan hệ cấp trên suy từ cách vẽ đó: mỗi hàng nối lên Ô ĐẦU TIÊN của hàng
    trên. Người sửa có thể chỉnh lại từng người trong màn sửa sơ đồ.
    """
    def group(k: str) -> list[dict]:
        return [nd for nd in (old.get(k) or []) if (nd.get("name") or "").strip()]

    # 1) Phòng ban = các nhãn phòng khác nhau. Ô đầu nhánh (hàng 4) hay ghi gộp
    #    "3D & Cầu đường" nên chỉ lấy nhãn của nó khi không chứa nhãn nào đã có.
    labels: list[tuple[str, str]] = []

    def add_label(nd: dict) -> None:
        lab = (nd.get("deptLabel") or "").strip()
        if lab and lab not in [name for name, _ in labels]:
            labels.append((lab, (nd.get("jpDeptLabel") or "").strip()))

    for k in ("level1", "level2", "level5Left", "level6Left", "level5Right", "level6Right"):
        for nd in group(k):
            add_label(nd)
    for k in ("level4Left", "level4Right"):
        for nd in group(k):
            lab = (nd.get("deptLabel") or "").strip()
            if lab and not any(name in lab for name, _ in labels):
                add_label(nd)

    departments: list[dict] = []
    used: set[str] = set()
    for i, (name, jp) in enumerate(labels):
        key = base = _slug(name)
        j = 2
        while key in used:
            key = f"{base}-{j}"
            j += 1
        used.add(key)
        departments.append({"key": key, "name": name, "jpName": jp, "color": _COLORS[i % len(_COLORS)]})

    def exact(label: str) -> str | None:
        return next((d["key"] for d in departments if d["name"] == label), None)

    def contained(label: str) -> list[str]:
        return [d["key"] for d in departments if d["name"] and d["name"] in label]

    def primary_dept(nd: dict, child: dict | None) -> tuple[str | None, list[str]]:
        own = (nd.get("deptLabel") or "").strip()
        dept = (exact((child.get("deptLabel") or "").strip()) if child else None) or exact(own)
        if dept is None:
            found = contained(own)
            dept = found[0] if found else None
        extras = [k for k in contained(own) if k != dept]
        return dept, extras

    # 2) Nhân sự + cấp trên.
    people: list[dict] = []

    def add(nd: dict, dept: str | None, parent: str | None, extras: list[str] | None = None) -> str:
        key = (nd.get("key") or nd.get("name") or "").strip() or nd["name"].strip()
        people.append({
            "key": key, "name": nd["name"].strip(), "title": "",
            "dept": dept, "extraDepts": extras or [], "parent": parent,
        })
        return key

    director_key: str | None = None
    if director_name and not any(
        (nd.get("key") or "").strip().lower() == director_name.lower()
        for g in _LEGACY_GROUPS for nd in group(g)
    ):
        director_key = director_name
        people.append({
            "key": director_name, "name": _given_name(director_name), "title": "Giám đốc",
            "dept": None, "extraDepts": [], "parent": None,
        })

    lvl3 = group("level3")
    lvl3_key = add(lvl3[0], None, director_key) if lvl3 else director_key
    for nd in lvl3[1:]:
        add(nd, None, director_key)

    lvl2 = group("level2")
    lvl2_key = None
    for i, nd in enumerate(lvl2):
        k = add(nd, exact((nd.get("deptLabel") or "").strip()) or (departments[0]["key"] if departments else None), lvl3_key)
        if i == 0:
            lvl2_key = k
    for nd in group("level1"):
        add(nd, exact((nd.get("deptLabel") or "").strip()) or (departments[0]["key"] if departments else None),
            lvl2_key or lvl3_key)

    for side in ("Left", "Right"):
        l4, l5, l6 = group(f"level4{side}"), group(f"level5{side}"), group(f"level6{side}")
        l4_key = lvl3_key
        for i, nd in enumerate(l4):
            dept, extras = primary_dept(nd, l5[0] if l5 else (l6[0] if l6 else None))
            k = add(nd, dept, lvl3_key, extras)
            if i == 0:
                l4_key = k
        l5_key = l4_key
        for i, nd in enumerate(l5):
            k = add(nd, exact((nd.get("deptLabel") or "").strip()), l4_key)
            if i == 0:
                l5_key = k
        for nd in l6:
            add(nd, exact((nd.get("deptLabel") or "").strip()), l5_key)

    return {"version": 2, "departments": departments, "people": people}


def _director_name(db: Session, company_id: int) -> str | None:
    d = (
        db.query(User)
        .filter(User.company_id == company_id, User.role == UserRole.DIRECTOR, User.is_active.is_(True))
        .order_by(User.id)
        .first()
    )
    return d.full_name if d else None


def _load(db: Session, current: User, raw) -> OrgChartData:
    """Đọc dữ liệu đã lưu (hoặc mặc định), tự chuyển bản cũ sang bản 2."""
    if not raw:
        raw = _LEGACY_DEFAULT
    if _is_legacy(raw):
        raw = _migrate_v1(raw, _director_name(db, current.company_id))
    return OrgChartData.model_validate(raw)


# ---------------------------------------------------------------- kiểm tra
def _validate(data: dict) -> None:
    """Chặn dữ liệu làm vỡ sơ đồ: trùng mã, phòng/cấp trên không tồn tại, vòng lặp."""
    depts = data["departments"]
    people = data["people"]
    if len(depts) > _MAX_DEPARTMENTS:
        raise HTTPException(400, f"Tối đa {_MAX_DEPARTMENTS} phòng ban trên sơ đồ.")
    if len(people) > _MAX_PEOPLE:
        raise HTTPException(400, f"Tối đa {_MAX_PEOPLE} người trên sơ đồ.")

    dept_keys: set[str] = set()
    for d in depts:
        if not d["name"].strip():
            raise HTTPException(400, "Tên phòng ban không được để trống.")
        if not d["key"].strip():
            raise HTTPException(400, f"Phòng '{d['name']}' thiếu mã.")
        if d["color"] not in _COLORS:
            raise HTTPException(400, f"Màu '{d['color']}' của phòng '{d['name']}' không hợp lệ.")
        k = d["key"].strip().lower()
        if k in dept_keys:
            raise HTTPException(400, f"Trùng mã phòng ban: {d['key']}")
        dept_keys.add(k)

    keys: set[str] = set()
    for p in people:
        if not p["name"].strip():
            raise HTTPException(400, "Tên nhân sự trong sơ đồ không được để trống.")
        if not p["key"].strip():
            raise HTTPException(400, f"'{p['name']}' thiếu mã liên kết.")
        k = p["key"].strip().lower()
        if k in keys:
            raise HTTPException(400, f"Trùng mã nhân sự trong sơ đồ: {p['key']}")
        keys.add(k)

    by_key = {p["key"].strip().lower(): p for p in people}
    for p in people:
        if p["dept"] is not None and p["dept"].strip().lower() not in dept_keys:
            raise HTTPException(400, f"'{p['name']}' thuộc phòng không có trên sơ đồ.")
        for x in p["extraDepts"]:
            if x.strip().lower() not in dept_keys:
                raise HTTPException(400, f"'{p['name']}' kiêm phòng không có trên sơ đồ.")
        if p["parent"] is not None:
            pk = p["parent"].strip().lower()
            if pk == p["key"].strip().lower():
                raise HTTPException(400, f"'{p['name']}' không thể là cấp trên của chính mình.")
            if pk not in by_key:
                raise HTTPException(400, f"Cấp trên của '{p['name']}' không có trên sơ đồ.")

    # Vòng lặp cấp trên (A -> B -> A) làm frontend không xếp được cấp.
    for p in people:
        seen = {p["key"].strip().lower()}
        cur = p
        while cur["parent"] is not None:
            pk = cur["parent"].strip().lower()
            if pk in seen:
                raise HTTPException(400, f"Cấp trên của '{p['name']}' tạo thành vòng lặp.")
            seen.add(pk)
            cur = by_key[pk]


# --------------------------------------------------------------------- API
@router.get("", response_model=OrgChartOut)
def get_org_chart(
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Sơ đồ của công ty. Chưa từng chỉnh sửa -> trả sơ đồ mặc định."""
    row = db.query(OrgChart).filter(OrgChart.company_id == current.company_id).first()
    if row is None:
        return OrgChartOut(data=_load(db, current, None), can_edit=_can_edit(current))
    return OrgChartOut(
        data=_load(db, current, row.data),
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
    data["version"] = 2
    _validate(data)

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
