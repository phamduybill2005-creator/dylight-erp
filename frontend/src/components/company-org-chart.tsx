"use client";

// SƠ ĐỒ TỔ CHỨC — vẽ theo LÀN PHÒNG BAN.
//   - Lãnh đạo (không thuộc phòng nào) ở trên cùng, nối xuống các làn.
//   - Mỗi phòng ban là một làn; trong làn xếp theo CẤP (suy từ "cấp trên" của
//     từng người), cấp trên ở trên, cấp dưới ở dưới.
//   - Màu theo PHÒNG (danh sách cố định), nhãn phòng ở đầu làn thay cho chú thích.
//   - Tìm tên: làm nổi người khớp + chuỗi cấp trên, mờ những người còn lại.
//   - Sửa sơ đồ: chọn phòng + cấp trên cho từng người, sơ đồ tự sắp xếp.

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { roleTitle, isSeniorManagerUp } from "@/lib/roles";
import type {
  Colleague, OrgChartColor, OrgChartData, OrgChartDepartment, OrgChartPerson, User,
} from "@/lib/types";
import {
  UserIcon,
  EnvelopeIcon,
  PhoneIcon,
  BriefcaseIcon,
  XMarkIcon,
  AcademicCapIcon,
  PencilSquareIcon,
  PlusIcon,
  TrashIcon,
  CheckIcon,
  MagnifyingGlassIcon,
  ChevronDownIcon,
  UserPlusIcon,
  ArrowsPointingInIcon,
  ArrowsPointingOutIcon,
} from "@heroicons/react/24/outline";

/**
 * MÀU LÀN — CỐ ĐỊNH. Tailwind chỉ sinh class nào XUẤT HIỆN TRONG MÃ NGUỒN nên mọi
 * class phải viết sẵn ở đây; phòng ban chỉ được chọn 1 trong các màu này.
 * Khớp _COLORS ở backend/app/routers/org_chart.py.
 */
const COLOR_STYLE: Record<OrgChartColor, { label: string; lane: string; border: string; badge: string; avatar: string; swatch: string }> = {
  teal:    { label: "Xanh ngọc",  lane: "bg-teal-50/60",    border: "border-teal-200",    badge: "bg-teal-100 text-teal-800",       avatar: "bg-teal-100 text-teal-800",       swatch: "bg-teal-400" },
  violet:  { label: "Tím",        lane: "bg-violet-50/60",  border: "border-violet-200",  badge: "bg-violet-100 text-violet-800",   avatar: "bg-violet-100 text-violet-800",   swatch: "bg-violet-400" },
  amber:   { label: "Cam",        lane: "bg-amber-50/60",   border: "border-amber-200",   badge: "bg-amber-100 text-amber-800",     avatar: "bg-amber-100 text-amber-800",     swatch: "bg-amber-400" },
  sky:     { label: "Xanh dương", lane: "bg-sky-50/60",     border: "border-sky-200",     badge: "bg-sky-100 text-sky-800",         avatar: "bg-sky-100 text-sky-800",         swatch: "bg-sky-400" },
  rose:    { label: "Hồng",       lane: "bg-rose-50/60",    border: "border-rose-200",    badge: "bg-rose-100 text-rose-800",       avatar: "bg-rose-100 text-rose-800",       swatch: "bg-rose-400" },
  emerald: { label: "Xanh lá",    lane: "bg-emerald-50/60", border: "border-emerald-200", badge: "bg-emerald-100 text-emerald-800", avatar: "bg-emerald-100 text-emerald-800", swatch: "bg-emerald-400" },
};
const COLORS = Object.keys(COLOR_STYLE) as OrgChartColor[];

/** Số cột làn trên màn hình rộng — tra bảng chữ sẵn (không ghép class động). */
const LANE_GRID = [
  "", "lg:grid-cols-1", "lg:grid-cols-2", "lg:grid-cols-3", "lg:grid-cols-4",
  "lg:grid-cols-5", "lg:grid-cols-6", "lg:grid-cols-7", "lg:grid-cols-8",
];

// ------------------------------------------------------------------ tiện ích
/** Bỏ dấu, chữ thường: "Cầu đường" -> "cau duong" (để tìm & sinh mã). */
const fold = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
const slug = (s: string) => fold(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "phong";
/** "D.V.QUANG" -> "QUANG" (tên hiển thị ngắn như các ô sẵn có). */
const givenName = (full: string) => (full.split(".").pop() || full).trim().toUpperCase();
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

const P = (key: string, name: string, dept: string | null, parent: string | null, extraDepts: string[] = []): OrgChartPerson =>
  ({ key, name, title: "", dept, extraDepts, parent });

/**
 * Sơ đồ MẶC ĐỊNH — dùng khi chưa gọi được API (mất mạng / backend chưa lên).
 * Là bản chuyển đổi của sơ đồ cũ, khớp _LEGACY_DEFAULT ở backend.
 */
const DEFAULT_CHART: OrgChartData = {
  version: 2,
  departments: [
    { key: "dia-hinh", name: "Địa hình", jpName: "地形解析", color: "teal" },
    { key: "thiet-ke-3d", name: "Thiết kế 3D", jpName: "3次設計", color: "violet" },
    { key: "cau-duong", name: "Cầu đường", jpName: "土木設計", color: "amber" },
  ],
  people: [
    P("Sơn", "SƠN", null, null),
    P("Cường", "CƯỜNG", "dia-hinh", "Sơn"), P("Phú", "PHÚ", "dia-hinh", "Sơn"),
    P("Giang", "GIANG", "dia-hinh", "Cường"), P("Nhung", "NHUNG", "dia-hinh", "Cường"),
    P("Đạt", "ĐẠT", "dia-hinh", "Cường"), P("Dũng", "DŨNG", "dia-hinh", "Cường"),
    P("Lâm", "LÂM", "thiet-ke-3d", "Sơn", ["cau-duong"]),
    P("Quang", "QUANG", "thiet-ke-3d", "Lâm"),
    P("Hoàn", "HOÀN", "thiet-ke-3d", "Quang"), P("Duy", "DUY", "thiet-ke-3d", "Quang"),
    P("Bính", "BÍNH", "cau-duong", "Sơn"),
    P("Cao", "CAO", "cau-duong", "Bính"), P("Đức", "ĐỨC", "cau-duong", "Bính"), P("Hùng", "HÙNG", "cau-duong", "Bính"),
    P("Linh37", "LINH37", "cau-duong", "Cao"), P("Quân", "QUÂN", "cau-duong", "Cao"),
    P("Dương", "DƯƠNG", "cau-duong", "Cao"), P("?????", "?????", "cau-duong", "Cao"), P("Khải", "KHẢI", "cau-duong", "Cao"),
  ],
};

/** Dữ liệu từ API có đúng dạng bản 2 không (backend cũ trả bản 1 -> không vẽ được). */
const isV2 = (d: unknown): d is OrgChartData =>
  !!d && typeof d === "object" && Array.isArray((d as OrgChartData).people) && Array.isArray((d as OrgChartData).departments);

// ------------------------------------------------------------ xếp cấp trong làn
type Row = OrgChartPerson[];

/** Làn của một người: key phòng, hoặc null = lãnh đạo. Phòng không còn tồn tại -> coi như lãnh đạo. */
function laneOf(p: OrgChartPerson, deptKeys: Set<string>): string | null {
  return p.dept && deptKeys.has(p.dept) ? p.dept : null;
}

/**
 * Chia người trong CÙNG một làn thành các hàng theo cấp: cấp 0 = cấp trên nằm
 * ngoài làn (hoặc không có), cấp n = cấp trên (cùng làn) ở cấp n-1.
 * Cấp trên tạo vòng lặp (dữ liệu hỏng) -> coi như cấp 0, không treo trang.
 */
function buildLayout(data: OrgChartData) {
  const byKey = new Map(data.people.map((p) => [p.key, p]));
  const deptKeys = new Set(data.departments.map((d) => d.key));
  const depthCache = new Map<string, number>();

  const depthOf = (p: OrgChartPerson, seen: Set<string>): number => {
    const cached = depthCache.get(p.key);
    if (cached !== undefined) return cached;
    if (seen.has(p.key)) return 0;
    seen.add(p.key);
    const par = p.parent ? byKey.get(p.parent) : undefined;
    const d = par && laneOf(par, deptKeys) === laneOf(p, deptKeys) ? depthOf(par, seen) + 1 : 0;
    depthCache.set(p.key, d);
    return d;
  };
  const rowsFor = (list: OrgChartPerson[]): Row[] => {
    const rows: Row[] = [];
    for (const p of list) {
      const d = depthOf(p, new Set());
      (rows[d] ??= []).push(p);
    }
    return rows.filter(Boolean);   // bỏ hàng trống (mảng thưa)
  };

  const leadership = rowsFor(data.people.filter((p) => laneOf(p, deptKeys) === null));
  const lanes = data.departments.map((dept) => {
    const members = data.people.filter((p) => laneOf(p, deptKeys) === dept.key);
    return { dept, rows: rowsFor(members), count: members.length };
  });
  return { leadership, lanes, byKey, deptKeys };
}

// =========================================================================
export default function CompanyOrgChart() {
  const [colleagues, setColleagues] = useState<Colleague[]>([]);
  const [selectedUser, setSelectedUser] = useState<Colleague | null>(null);
  const [loading, setLoading] = useState(true);

  const [chart, setChart] = useState<OrgChartData>(DEFAULT_CHART);   // bản đang hiển thị
  const [draft, setDraft] = useState<OrgChartData | null>(null);     // bản đang sửa dở
  const [canEdit, setCanEdit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [updatedBy, setUpdatedBy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Hộp thoại sửa/thêm NGƯỜI (index = -1 nghĩa là thêm mới) và PHÒNG BAN.
  const [editingPerson, setEditingPerson] = useState<{ index: number; p: OrgChartPerson } | null>(null);
  const [editingDept, setEditingDept] = useState<{ index: number; d: OrgChartDepartment } | null>(null);

  useEffect(() => {
    api.colleagues().then(setColleagues).catch(() => {});

    api.orgChart()
      .then((res) => {
        // Backend lỗi/trả thiếu `data` -> KHÔNG được setChart(undefined): vẽ sẽ
        // ném lỗi và làm TRẮNG CẢ TRANG CHỦ. Backend cũ (bản 1) cũng rơi vào đây.
        if (isV2(res?.data)) {
          setChart(res.data);
        } else {
          setChart(DEFAULT_CHART);
          setNotice("Máy chủ đang trả sơ đồ dạng cũ — đang hiện sơ đồ mặc định. Hãy cập nhật backend.");
        }
        setCanEdit(!!res?.can_edit);
        setUpdatedBy(res?.updated_by_name || null);
      })
      .catch(() => {
        // Backend chưa có endpoint / lỗi mạng -> vẫn vẽ sơ đồ mặc định.
        // Quyền sửa suy từ tài khoản đang đăng nhập cho khớp gate của backend.
        const me = api.cachedUser() as User | null;
        setCanEdit(isSeniorManagerUp(me));
      })
      .finally(() => setLoading(false));
  }, []);

  const view = draft ?? chart;
  const isEditMode = draft !== null;
  const layout = useMemo(() => buildLayout(view), [view]);
  const deptByKey = useMemo(() => new Map(view.departments.map((d) => [d.key, d])), [view.departments]);

  // ------------------------------------------------------------ tra cứu ERP
  const colleagueByName = useMemo(() => {
    const m = new Map<string, Colleague>();
    colleagues.forEach((c) => m.set(c.full_name.toLowerCase(), c));
    return m;
  }, [colleagues]);
  const linkedOf = (p: OrgChartPerson) => colleagueByName.get(p.key.toLowerCase());

  /** Chức danh dưới tên: theo tài khoản ERP nếu đã liên kết, không thì chức danh tự ghi. */
  const subtitleOf = (p: OrgChartPerson) => {
    const c = linkedOf(p);
    if (c) return roleTitle(c.role, c.has_subordinates, !c.manager_id && !c.manager_ids);
    return p.title;
  };

  // ------------------------------------------------------------------ tìm tên
  // Người khớp + toàn bộ chuỗi CẤP TRÊN của họ được giữ sáng, còn lại làm mờ.
  const matched = useMemo(() => {
    const q = fold(query.trim());
    if (!q) return null;
    const set = new Set<string>();
    view.people.forEach((p) => {
      if (fold(p.name).includes(q) || fold(p.key).includes(q) || fold(p.title).includes(q)) set.add(p.key);
    });
    for (const k of [...set]) {
      let cur = layout.byKey.get(k);
      const seen = new Set<string>();
      while (cur?.parent && !seen.has(cur.parent)) {
        seen.add(cur.parent);
        set.add(cur.parent);
        cur = layout.byKey.get(cur.parent);
      }
    }
    return set;
  }, [query, view.people, layout.byKey]);

  const toggleLane = (key: string) =>
    setCollapsed((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const allCollapsed = view.departments.length > 0 && view.departments.every((d) => collapsed.has(d.key));

  // ------------------------------------------------------------ xem hồ sơ
  const handlePersonClick = (p: OrgChartPerson) => {
    const c = linkedOf(p);
    if (c) { setSelectedUser(c); return; }
    const deptNames = [p.dept, ...p.extraDepts].map((k) => (k && deptByKey.get(k)?.name) || "").filter(Boolean);
    const parent = p.parent ? layout.byKey.get(p.parent) : undefined;
    setSelectedUser({
      id: 0,
      full_name: p.name,
      role: "FIELD_STAFF",
      department: deptNames.join(", ") || "Lãnh đạo",
      in_my_team: false,
      manager_name: parent?.name || null,
    });
  };

  // ------------------------------------------------------------ thao tác sửa
  const startEdit = () => { setDraft(clone(chart)); setQuery(""); setErr(null); };
  const cancelEdit = () => { setDraft(null); setEditingPerson(null); setEditingDept(null); setErr(null); };

  /** Sinh mã người chưa trùng (không phân biệt hoa thường), bỏ qua chính ô đang sửa. */
  const uniquePersonKey = (base: string, skipIndex: number) => {
    const taken = new Set((draft ?? chart).people.filter((_, i) => i !== skipIndex).map((p) => p.key.toLowerCase()));
    const root = (base || "Nhân sự").trim();
    if (!taken.has(root.toLowerCase())) return root;
    let i = 2;
    while (taken.has(`${root} ${i}`.toLowerCase())) i++;
    return `${root} ${i}`;
  };

  const openNewPerson = () => {
    const firstDept = draft?.departments[0]?.key ?? null;
    setEditingPerson({ index: -1, p: P("", "", firstDept, null) });
    setErr(null);
  };

  const commitPerson = () => {
    if (!draft || !editingPerson) return;
    const { index } = editingPerson;
    const name = editingPerson.p.name.trim();
    if (!name) { setErr("Tên hiển thị không được để trống."); return; }

    const prevKey = index >= 0 ? draft.people[index].key : "";
    const linkedName = colleagueByName.get(editingPerson.p.key.toLowerCase())?.full_name;
    // Đã liên kết -> mã = họ tên ERP. Chưa liên kết -> giữ mã cũ, hoặc lấy theo tên.
    const prevWasLinked = !!colleagueByName.get(prevKey.toLowerCase());
    const key = linkedName ?? uniquePersonKey(prevWasLinked || !prevKey ? name : prevKey, index);
    if (linkedName && draft.people.some((p, i) => i !== index && p.key.toLowerCase() === linkedName.toLowerCase())) {
      setErr(`Tài khoản ${linkedName} đã có trên sơ đồ.`); return;
    }

    const dept = editingPerson.p.dept && deptByKey.has(editingPerson.p.dept) ? editingPerson.p.dept : null;
    const extraDepts = dept ? editingPerson.p.extraDepts.filter((k) => k !== dept && deptByKey.has(k)) : [];
    let parent = editingPerson.p.parent && layout.byKey.has(editingPerson.p.parent) ? editingPerson.p.parent : null;
    if (parent === prevKey && prevKey) parent = null;   // tự chọn mình làm cấp trên
    // Cấp trên không được là cấp dưới của chính người này (vòng lặp).
    let cur = parent ? layout.byKey.get(parent) : undefined;
    const seen = new Set<string>();
    while (cur && !seen.has(cur.key)) {
      if (cur.key === prevKey && prevKey) { setErr(`${cur.name} đang là cấp dưới của người này — không thể chọn làm cấp trên.`); return; }
      seen.add(cur.key);
      cur = cur.parent ? layout.byKey.get(cur.parent) : undefined;
    }

    const next = clone(draft);
    const person: OrgChartPerson = { key, name, title: editingPerson.p.title.trim(), dept, extraDepts, parent };
    if (index < 0) next.people.push(person);
    else {
      next.people[index] = person;
      // Đổi mã (đổi liên kết / đổi tên) -> cấp dưới vẫn phải trỏ đúng người này.
      if (key !== prevKey) next.people.forEach((p) => { if (p.parent === prevKey) p.parent = key; });
    }
    setDraft(next);
    setEditingPerson(null);
    setErr(null);
  };

  const removePerson = (index: number) => {
    if (!draft) return;
    const person = draft.people[index];
    const kids = draft.people.filter((p) => p.parent === person.key);
    const msg = kids.length
      ? `Xoá "${person.name}" khỏi sơ đồ? ${kids.length} người đang dưới quyền sẽ chuyển lên cấp trên của ${person.name}.`
      : `Xoá "${person.name}" khỏi sơ đồ?`;
    if (!window.confirm(msg)) return;
    const next = clone(draft);
    next.people.forEach((p) => { if (p.parent === person.key) p.parent = person.parent; });
    next.people.splice(index, 1);
    setDraft(next);
  };

  const openNewDept = () => {
    const color = COLORS[(draft?.departments.length ?? 0) % COLORS.length];
    setEditingDept({ index: -1, d: { key: "", name: "", jpName: "", color } });
    setErr(null);
  };

  const commitDept = () => {
    if (!draft || !editingDept) return;
    const name = editingDept.d.name.trim();
    if (!name) { setErr("Tên phòng ban không được để trống."); return; }
    const next = clone(draft);
    if (editingDept.index < 0) {
      const taken = new Set(next.departments.map((d) => d.key));
      let key = slug(name); const base = key; let i = 2;
      while (taken.has(key)) key = `${base}-${i++}`;
      next.departments.push({ key, name, jpName: editingDept.d.jpName.trim(), color: editingDept.d.color });
    } else {
      next.departments[editingDept.index] = { ...editingDept.d, name, jpName: editingDept.d.jpName.trim() };
    }
    setDraft(next);
    setEditingDept(null);
    setErr(null);
  };

  const removeDept = (index: number) => {
    if (!draft) return;
    const d = draft.departments[index];
    const inUse = draft.people.filter((p) => p.dept === d.key || p.extraDepts.includes(d.key)).length;
    if (inUse) { setErr(`Phòng "${d.name}" còn ${inUse} người — chuyển họ sang phòng khác trước khi xoá.`); return; }
    if (!window.confirm(`Xoá phòng "${d.name}" khỏi sơ đồ?`)) return;
    const next = clone(draft);
    next.departments.splice(index, 1);
    setDraft(next);
    setErr(null);
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setErr(null);
    try {
      const res = await api.saveOrgChart(draft);
      setChart(res.data);
      setUpdatedBy(res.updated_by_name || null);
      setDraft(null);
      setNotice(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Không lưu được sơ đồ.");
    } finally {
      setSaving(false);
    }
  };

  // ------------------------------------------------------------------ render
  const renderPerson = (p: OrgChartPerson, color: OrgChartColor | null) => {
    const index = view.people.indexOf(p);
    const linked = linkedOf(p);
    const dim = !!matched && !matched.has(p.key);
    const hit = !!matched && matched.has(p.key);
    const sub = subtitleOf(p);
    const extras = p.extraDepts.map((k) => deptByKey.get(k)?.name).filter(Boolean).join(", ");
    const avatar = color ? COLOR_STYLE[color].avatar : "bg-ink text-white";

    return (
      <div key={p.key} className={`relative transition-opacity ${dim ? "opacity-25" : ""}`}>
        <button
          type="button"
          onClick={() => (isEditMode ? setEditingPerson({ index, p: clone(p) }) : handlePersonClick(p))}
          title={isEditMode ? "Bấm để sửa" : linked ? `${linked.full_name} — xem hồ sơ` : "Xem chi tiết"}
          className={`flex w-[8.5rem] items-center gap-2 rounded-xl border bg-white px-2 py-1.5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md active:scale-[0.98] ${
            hit ? "border-amber ring-2 ring-amber/40" : "border-line"
          } ${isEditMode ? "border-dashed border-indigo-300" : ""}`}
        >
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-black ${avatar}`}>
            {p.name.trim().charAt(0).toUpperCase() || "?"}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-bold leading-tight text-ink">{p.name}</span>
            {sub && <span className="block truncate text-[10px] leading-tight text-muted">{sub}</span>}
            {extras && <span className="block truncate text-[10px] leading-tight text-steel">Kiêm {extras}</span>}
          </span>
          {/* Chấm xanh: đã khớp một tài khoản ERP */}
          {linked && !isEditMode && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-indigo-600" title="Đã liên kết tài khoản ERP" />}
        </button>

        {isEditMode && (
          <button
            type="button"
            onClick={() => removePerson(index)}
            title={`Xoá ${p.name}`}
            className="absolute -right-2 -top-2 z-10 rounded-full border border-bad/40 bg-white p-1 text-bad shadow-sm transition-colors hover:bg-bad hover:text-white"
          >
            <TrashIcon className="h-3 w-3" />
          </button>
        )}
      </div>
    );
  };

  const renderRows = (rows: Row[], color: OrgChartColor | null) =>
    rows.map((row, i) => (
      <div key={i} className="flex flex-col items-center">
        {i > 0 && <span className="h-3 w-px bg-slate-300" />}
        <div className="flex flex-wrap justify-center gap-2">{row.map((p) => renderPerson(p, color))}</div>
      </div>
    ));

  const renderLane = ({ dept, rows, count }: { dept: OrgChartDepartment; rows: Row[]; count: number }, index: number) => {
    const cs = COLOR_STYLE[dept.color] ?? COLOR_STYLE.teal;
    const isCollapsed = collapsed.has(dept.key) && !isEditMode;
    const shownRows = isCollapsed ? rows.slice(0, 1) : rows;
    const hidden = count - shownRows.reduce((n, r) => n + r.length, 0);
    const laneDim = !!matched && !rows.some((r) => r.some((p) => matched.has(p.key)));

    return (
      <section key={dept.key} className={`rounded-xl border ${cs.border} ${cs.lane} p-2.5 transition-opacity ${laneDim ? "opacity-40" : ""}`}>
        <div className="mb-2 flex items-center justify-between gap-1">
          <span className={`inline-flex min-w-0 items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold ${cs.badge}`}>
            <span className="truncate">{dept.name}</span>
            {dept.jpName && <span className="truncate font-normal opacity-80">· {dept.jpName}</span>}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <span className="text-[10px] text-muted">{count} người</span>
            {isEditMode ? (
              <>
                <button type="button" onClick={() => { setEditingDept({ index, d: { ...dept } }); setErr(null); }} title="Sửa phòng ban"
                  className="rounded-md p-1 text-muted hover:bg-white hover:text-ink">
                  <PencilSquareIcon className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => removeDept(index)} title="Xoá phòng ban"
                  className="rounded-md p-1 text-muted hover:bg-white hover:text-bad">
                  <TrashIcon className="h-3.5 w-3.5" />
                </button>
              </>
            ) : (
              rows.length > 1 && (
                <button type="button" onClick={() => toggleLane(dept.key)} title={isCollapsed ? "Mở rộng" : "Thu gọn"}
                  className="rounded-md p-1 text-muted hover:bg-white hover:text-ink">
                  <ChevronDownIcon className={`h-3.5 w-3.5 transition-transform ${isCollapsed ? "-rotate-90" : ""}`} />
                </button>
              )
            )}
          </span>
        </div>

        {count === 0 ? (
          <p className="py-3 text-center text-[11px] italic text-muted">Chưa có ai trong phòng này.</p>
        ) : (
          <div className="flex flex-col items-center">
            {renderRows(shownRows, dept.color)}
            {isCollapsed && hidden > 0 && (
              <button type="button" onClick={() => toggleLane(dept.key)}
                className="mt-2 rounded-full border border-line bg-white px-2.5 py-0.5 text-[10px] font-semibold text-steel hover:bg-paper">
                + {hidden} người nữa
              </button>
            )}
          </div>
        )}
      </section>
    );
  };

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center rounded-xl2 bg-white shadow-card">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-steel border-t-amber" />
      </div>
    );
  }

  const laneCount = layout.lanes.length;
  const gridCols = LANE_GRID[Math.min(laneCount, LANE_GRID.length - 1)];
  const hasLeadership = layout.leadership.length > 0;
  const otherPeople = (skip: number) => view.people.filter((_, i) => i !== skip);

  return (
    <div className="relative overflow-hidden rounded-xl2 border border-line/45 bg-white p-5 shadow-card">
      {/* ---------------- tiêu đề + công cụ ---------------- */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-steel">Sơ đồ tổ chức công ty</h2>
          <p className="text-[10px] text-muted">
            {isEditMode
              ? "Đang sửa — bấm vào người để đổi phòng ban / cấp trên, bấm thùng rác để xoá."
              : "Bấm vào từng người để xem chức vụ & liên hệ · gõ tên để tìm"}
          </p>
          {!isEditMode && updatedBy && (
            <p className="mt-0.5 text-[10px] italic text-muted">Cập nhật gần nhất bởi {updatedBy}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!isEditMode && (
            <>
              <label className="relative">
                <MagnifyingGlassIcon className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Tìm tên…"
                  aria-label="Tìm nhân sự trên sơ đồ"
                  className="w-36 rounded-full border border-line bg-paper py-1 pl-7 pr-2 text-[11px] outline-none focus:border-steel"
                />
              </label>
              {laneCount > 0 && (
                <button
                  type="button"
                  onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(view.departments.map((d) => d.key)))}
                  className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-[11px] font-semibold text-muted hover:bg-paper hover:text-ink"
                >
                  {allCollapsed ? <ArrowsPointingOutIcon className="h-3.5 w-3.5" /> : <ArrowsPointingInIcon className="h-3.5 w-3.5" />}
                  {allCollapsed ? "Mở rộng" : "Thu gọn"}
                </button>
              )}
            </>
          )}

          {/* Thêm/sửa/xoá: CHỈ Giám đốc, Quản trị hệ thống, Quản lý cấp cao.
              Backend chặn lần nữa ở PUT /org-chart nên ẩn nút chỉ là cho gọn UI. */}
          {canEdit && !isEditMode && (
            <button
              type="button"
              onClick={startEdit}
              className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-100 px-3 py-1 text-[11px] font-bold text-slate-700 shadow-sm transition-colors hover:bg-slate-200 hover:text-ink"
            >
              <PencilSquareIcon className="h-3.5 w-3.5 text-steel" />
              Sửa sơ đồ
            </button>
          )}

          {isEditMode && (
            <>
              <button type="button" onClick={openNewPerson}
                className="inline-flex items-center gap-1 rounded-full border border-indigo-300 bg-indigo-50 px-3 py-1 text-[11px] font-bold text-indigo-700 hover:bg-indigo-100">
                <UserPlusIcon className="h-3.5 w-3.5" /> Thêm người
              </button>
              <button type="button" onClick={openNewDept}
                className="inline-flex items-center gap-1 rounded-full border border-indigo-300 bg-indigo-50 px-3 py-1 text-[11px] font-bold text-indigo-700 hover:bg-indigo-100">
                <PlusIcon className="h-3.5 w-3.5" /> Thêm phòng ban
              </button>
              <button type="button" onClick={cancelEdit} disabled={saving}
                className="rounded-full border border-line px-3 py-1 text-[11px] font-semibold text-muted transition-colors hover:bg-paper hover:text-ink disabled:opacity-50">
                Huỷ bỏ
              </button>
              <button type="button" onClick={save} disabled={saving}
                className="inline-flex items-center gap-1 rounded-full bg-ink px-3 py-1 text-[11px] font-bold text-white transition-colors hover:bg-steel disabled:opacity-50">
                {saving ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-amber" /> : <CheckIcon className="h-3.5 w-3.5" />}
                Lưu sơ đồ
              </button>
            </>
          )}
        </div>
      </div>

      {notice && !isEditMode && (
        <p className="mb-3 rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 text-[11px] font-semibold text-amber-deep">{notice}</p>
      )}
      {err && !editingPerson && !editingDept && (
        <p className="mb-3 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-[11px] font-semibold text-bad">{err}</p>
      )}
      {matched && matched.size === 0 && (
        <p className="mb-3 text-center text-[11px] italic text-muted">Không có ai tên “{query.trim()}” trên sơ đồ.</p>
      )}

      {/* ---------------- LÃNH ĐẠO (trên cùng) ---------------- */}
      {hasLeadership && (
        <div className="flex flex-col items-center">
          {renderRows(layout.leadership, null)}
          {laneCount > 0 && <span className="h-4 w-px bg-slate-300" />}
        </div>
      )}
      {isEditMode && !hasLeadership && (
        <p className="mb-2 text-center text-[10px] italic text-muted">Chưa có lãnh đạo — thêm người và chọn phòng ban “Lãnh đạo (trên cùng)”.</p>
      )}

      {/* Thanh nối từ lãnh đạo xuống từng làn — chỉ khi các làn nằm cùng một hàng (màn rộng) */}
      {hasLeadership && laneCount > 0 && (
        <div className={`hidden gap-3 lg:grid ${gridCols}`} aria-hidden="true">
          {layout.lanes.map(({ dept }, i) => (
            <div key={dept.key} className="relative h-4">
              {laneCount > 1 && (
                <span className={`absolute top-0 border-t border-slate-300 ${i === 0 ? "left-1/2 right-0" : i === laneCount - 1 ? "left-0 right-1/2" : "left-0 right-0"}`} />
              )}
              <span className="absolute left-1/2 top-0 h-full w-px bg-slate-300" />
            </div>
          ))}
        </div>
      )}

      {/* ---------------- CÁC LÀN PHÒNG BAN ---------------- */}
      {laneCount > 0 ? (
        <div className={`grid grid-cols-1 gap-3 ${gridCols}`}>{layout.lanes.map(renderLane)}</div>
      ) : (
        <p className="rounded-lg border border-dashed border-line py-6 text-center text-[11px] italic text-muted">
          Chưa có phòng ban nào trên sơ đồ.{canEdit && !isEditMode ? " Bấm “Sửa sơ đồ” để thêm." : ""}
        </p>
      )}

      {/* ---------------- Hộp thoại THÊM / SỬA NGƯỜI ---------------- */}
      {editingPerson && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="max-h-full w-full max-w-sm overflow-y-auto rounded-2xl border border-line/60 bg-white p-5 shadow-2xl">
            <h3 className="text-sm font-bold text-ink">{editingPerson.index < 0 ? "Thêm người vào sơ đồ" : "Sửa thông tin trên sơ đồ"}</h3>

            <div className="mt-3 space-y-2.5">
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-muted">Tài khoản ERP</span>
                <select
                  value={colleagueByName.get(editingPerson.p.key.toLowerCase())?.full_name ?? ""}
                  onChange={(e) => {
                    const full = e.target.value;
                    const wasLinked = !!colleagueByName.get(editingPerson.p.key.toLowerCase());
                    setEditingPerson({
                      ...editingPerson,
                      p: {
                        ...editingPerson.p,
                        key: full || (wasLinked ? "" : editingPerson.p.key),
                        name: full && !editingPerson.p.name.trim() ? givenName(full) : editingPerson.p.name,
                      },
                    });
                  }}
                  className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
                >
                  <option value="">— Không liên kết —</option>
                  {[...colleagues].sort((a, b) => a.full_name.localeCompare(b.full_name, "vi")).map((c) => (
                    <option key={c.id} value={c.full_name}>{c.full_name}{c.department ? ` (${c.department})` : ""}</option>
                  ))}
                </select>
                <span className="mt-1 block text-[10px] text-muted">Liên kết để bấm vào là xem được hồ sơ, chức danh lấy theo tài khoản.</span>
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-muted">Tên hiển thị *</span>
                <input
                  autoFocus
                  value={editingPerson.p.name}
                  onChange={(e) => setEditingPerson({ ...editingPerson, p: { ...editingPerson.p, name: e.target.value } })}
                  onKeyDown={(e) => { if (e.key === "Enter") commitPerson(); }}
                  placeholder="VD: HÙNG"
                  className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
                />
              </label>

              {!colleagueByName.get(editingPerson.p.key.toLowerCase()) && (
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold text-muted">Chức danh (tuỳ chọn)</span>
                  <input
                    value={editingPerson.p.title}
                    onChange={(e) => setEditingPerson({ ...editingPerson, p: { ...editingPerson.p, title: e.target.value } })}
                    placeholder="VD: Quản lý cấp trung"
                    className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
                  />
                </label>
              )}

              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold text-muted">Phòng ban</span>
                  <select
                    value={editingPerson.p.dept ?? ""}
                    onChange={(e) => setEditingPerson({ ...editingPerson, p: { ...editingPerson.p, dept: e.target.value || null, extraDepts: [] } })}
                    className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
                  >
                    <option value="">Lãnh đạo (trên cùng)</option>
                    {view.departments.map((d) => <option key={d.key} value={d.key}>{d.name}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold text-muted">Cấp trên trực tiếp</span>
                  <select
                    value={editingPerson.p.parent ?? ""}
                    onChange={(e) => setEditingPerson({ ...editingPerson, p: { ...editingPerson.p, parent: e.target.value || null } })}
                    className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
                  >
                    <option value="">— Không có —</option>
                    {otherPeople(editingPerson.index).map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.name}{p.dept && deptByKey.get(p.dept) ? ` · ${deptByKey.get(p.dept)!.name}` : " · Lãnh đạo"}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {editingPerson.p.dept && view.departments.length > 1 && (
                <div>
                  <span className="mb-1 block text-[11px] font-semibold text-muted">Kiêm thêm phòng</span>
                  <div className="flex flex-wrap gap-1.5">
                    {view.departments.filter((d) => d.key !== editingPerson.p.dept).map((d) => {
                      const on = editingPerson.p.extraDepts.includes(d.key);
                      return (
                        <button key={d.key} type="button"
                          onClick={() => setEditingPerson({
                            ...editingPerson,
                            p: { ...editingPerson.p, extraDepts: on ? editingPerson.p.extraDepts.filter((k) => k !== d.key) : [...editingPerson.p.extraDepts, d.key] },
                          })}
                          className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${on ? "border-ink bg-ink text-white" : "border-line bg-paper text-muted hover:text-ink"}`}
                        >
                          {d.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {err && <p className="mt-2 text-[11px] font-semibold text-bad">{err}</p>}

            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => { setEditingPerson(null); setErr(null); }}
                className="flex-1 rounded-xl2 border border-line py-2 text-xs font-semibold text-muted transition-colors hover:bg-paper hover:text-ink">
                Huỷ
              </button>
              <button type="button" onClick={commitPerson}
                className="flex-1 rounded-xl2 bg-ink py-2 text-xs font-semibold text-white transition-colors hover:bg-steel">
                {editingPerson.index < 0 ? "Thêm vào sơ đồ" : "Cập nhật"}
              </button>
            </div>
            <p className="mt-2 text-center text-[10px] text-muted">Thay đổi chỉ được ghi lại khi bấm <b className="text-ink">Lưu sơ đồ</b>.</p>
          </div>
        </div>
      )}

      {/* ---------------- Hộp thoại THÊM / SỬA PHÒNG BAN ---------------- */}
      {editingDept && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-line/60 bg-white p-5 shadow-2xl">
            <h3 className="text-sm font-bold text-ink">{editingDept.index < 0 ? "Thêm phòng ban" : "Sửa phòng ban"}</h3>

            <div className="mt-3 space-y-2.5">
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold text-muted">Tên phòng *</span>
                  <input
                    autoFocus
                    value={editingDept.d.name}
                    onChange={(e) => setEditingDept({ ...editingDept, d: { ...editingDept.d, name: e.target.value } })}
                    onKeyDown={(e) => { if (e.key === "Enter") commitDept(); }}
                    placeholder="VD: Cầu đường"
                    className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold text-muted">Tiếng Nhật</span>
                  <input
                    value={editingDept.d.jpName}
                    onChange={(e) => setEditingDept({ ...editingDept, d: { ...editingDept.d, jpName: e.target.value } })}
                    placeholder="VD: 土木設計"
                    className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
                  />
                </label>
              </div>
              <div>
                <span className="mb-1 block text-[11px] font-semibold text-muted">Màu làn</span>
                <div className="flex flex-wrap gap-1.5">
                  {COLORS.map((c) => (
                    <button key={c} type="button" title={COLOR_STYLE[c].label}
                      onClick={() => setEditingDept({ ...editingDept, d: { ...editingDept.d, color: c } })}
                      className={`h-7 w-7 rounded-lg ${COLOR_STYLE[c].swatch} transition-transform hover:scale-110 ${editingDept.d.color === c ? "ring-2 ring-ink ring-offset-1" : ""}`}
                    />
                  ))}
                </div>
              </div>
            </div>

            {err && <p className="mt-2 text-[11px] font-semibold text-bad">{err}</p>}

            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => { setEditingDept(null); setErr(null); }}
                className="flex-1 rounded-xl2 border border-line py-2 text-xs font-semibold text-muted transition-colors hover:bg-paper hover:text-ink">
                Huỷ
              </button>
              <button type="button" onClick={commitDept}
                className="flex-1 rounded-xl2 bg-ink py-2 text-xs font-semibold text-white transition-colors hover:bg-steel">
                {editingDept.index < 0 ? "Thêm phòng" : "Cập nhật"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Hồ sơ nhân sự (chế độ xem) ---------------- */}
      {selectedUser && (
        <div className="animate-fade-in absolute inset-0 z-30 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="animate-scale-up relative w-full max-w-sm rounded-2xl border border-line/60 bg-white p-5 shadow-2xl">
            <button
              type="button"
              onClick={() => setSelectedUser(null)}
              className="absolute right-3 top-3 rounded-full p-1.5 text-muted transition-colors hover:bg-slate-100 hover:text-ink"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-3.5 border-b border-line pb-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-indigo-100 bg-indigo-50 text-indigo-600">
                <UserIcon className="h-6 w-6" />
              </span>
              <div className="min-w-0">
                <h3 className="truncate text-base font-bold text-ink">{selectedUser.full_name}</h3>
                <p className="text-xs font-medium text-muted">{selectedUser.department || "—"}</p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <div className="flex items-start gap-2.5 text-xs text-ink">
                <BriefcaseIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                <div>
                  <span className="block text-[10px] font-semibold uppercase text-muted">Chức vụ</span>
                  <span className="font-semibold text-slate-800">
                    {selectedUser.id > 0
                      ? roleTitle(selectedUser.role, selectedUser.has_subordinates, !selectedUser.manager_id && !selectedUser.manager_ids)
                      : "—"}
                  </span>
                </div>
              </div>

              {selectedUser.id > 0 ? (
                <>
                  <div className="flex items-start gap-2.5 text-xs text-ink">
                    <EnvelopeIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                    <div>
                      <span className="block text-[10px] font-semibold uppercase text-muted">Email</span>
                      <span className="font-medium text-slate-800">{selectedUser.email || "—"}</span>
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5 text-xs text-ink">
                    <PhoneIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                    <div>
                      <span className="block text-[10px] font-semibold uppercase text-muted">Số điện thoại</span>
                      <span className="font-medium text-slate-800">{selectedUser.phone || "—"}</span>
                    </div>
                  </div>
                </>
              ) : (
                <div className="rounded-lg border border-line/50 bg-slate-50 p-2.5 text-[11px] italic text-muted">
                  Người này chưa được liên kết với tài khoản ERP nào — chỉ hiện tên trên sơ đồ.
                </div>
              )}

              <div className="flex items-start gap-2.5 border-t border-line/45 pt-2.5 text-xs text-ink">
                <AcademicCapIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                <div>
                  <span className="block text-[10px] font-semibold uppercase text-muted">Người quản lý trực tiếp</span>
                  {selectedUser.manager_ids ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {selectedUser.manager_ids.split(",").map((mid) => {
                        const m = colleagues.find((c) => String(c.id) === mid.trim());
                        return m ? (
                          <span key={mid} className="inline-block rounded border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700">
                            {m.full_name}
                          </span>
                        ) : null;
                      })}
                    </div>
                  ) : selectedUser.manager_name ? (
                    <span className="mt-1 inline-block font-semibold text-slate-800">{selectedUser.manager_name}</span>
                  ) : (
                    <span className="italic text-muted">Không có quản lý</span>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setSelectedUser(null)}
                className="w-full rounded-xl2 bg-slate-100 py-2 text-xs font-bold text-muted transition-colors hover:bg-slate-200 hover:text-ink"
              >
                Đóng
              </button>
              {selectedUser.id > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedUser(null);
                    window.location.href = `/attendance?userId=${selectedUser.id}`;
                  }}
                  className="w-full rounded-xl2 bg-steel py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-steel/90"
                >
                  Xem chấm công
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
