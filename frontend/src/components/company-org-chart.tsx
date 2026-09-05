"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { roleTitle, isSeniorManagerUp } from "@/lib/roles";
import type { Colleague, OrgChartData, OrgChartNode, User } from "@/lib/types";
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
} from "@heroicons/react/24/outline";

/** Các CỤM ô — trùng tên với backend (OrgChartData). */
type GroupKey = keyof OrgChartData;

const DARK = "text-slate-900";
const LIGHT = "text-white";

/**
 * BẢNG MÀU CỐ ĐỊNH.
 * Tailwind chỉ sinh ra class nào XUẤT HIỆN TRONG MÃ NGUỒN, nên KHÔNG được cho
 * người dùng gõ class tự do — phải chọn từ danh sách viết sẵn dưới đây, nếu
 * không ô sẽ mất màu.
 */
const PALETTE: { label: string; bgClass: string; textClass: string; borderColor: string }[] = [
  { label: "Xanh ngọc", bgClass: "bg-cyan-400", textClass: DARK, borderColor: "border-cyan-500" },
  { label: "Xanh lá", bgClass: "bg-emerald-500", textClass: DARK, borderColor: "border-emerald-600" },
  { label: "Cam", bgClass: "bg-amber-500", textClass: DARK, borderColor: "border-amber-600" },
  { label: "Lục", bgClass: "bg-green-500", textClass: DARK, borderColor: "border-green-600" },
  { label: "Xanh dương", bgClass: "bg-blue-500", textClass: LIGHT, borderColor: "border-blue-600" },
  { label: "Xanh nhạt", bgClass: "bg-blue-100", textClass: DARK, borderColor: "border-blue-300" },
  { label: "Vàng nhạt", bgClass: "bg-amber-100", textClass: DARK, borderColor: "border-amber-300" },
  { label: "Lục nhạt", bgClass: "bg-emerald-100", textClass: DARK, borderColor: "border-emerald-300" },
];

const nd = (
  key: string, name: string, deptLabel: string, jpDeptLabel: string,
  bgClass: string, textClass: string, borderColor: string,
): OrgChartNode => ({ key, name, deptLabel, jpDeptLabel, bgClass, textClass, borderColor });

/**
 * Sơ đồ MẶC ĐỊNH — dùng khi chưa gọi được API (mất mạng / backend chưa lên).
 * Phải khớp DEFAULT_CHART ở backend/app/routers/org_chart.py.
 */
const DEFAULT_CHART: OrgChartData = {
  level1: [
    nd("Giang", "GIANG", "Địa hình", "地形解析", "bg-cyan-400", DARK, "border-cyan-500"),
    nd("Nhung", "NHUNG", "Địa hình", "地形解析", "bg-emerald-500", DARK, "border-emerald-600"),
    nd("Đạt", "ĐẠT", "Địa hình", "地形解析", "bg-amber-500", DARK, "border-amber-600"),
    nd("Dũng", "DŨNG", "Địa hình", "地形解析", "bg-green-500", DARK, "border-green-600"),
  ],
  level2: [
    nd("Cường", "CƯỜNG", "Địa hình", "地形解析", "bg-cyan-400", DARK, "border-cyan-500"),
    nd("Phú", "PHÚ", "Địa hình", "地形解析", "bg-amber-500", DARK, "border-amber-600"),
  ],
  level3: [nd("Sơn", "SƠN", "Địa hình", "地形解析", "bg-green-500", DARK, "border-green-600")],
  level4Left: [nd("Lâm", "LÂM", "3D & Cầu đường", "3次設計、土木設計", "bg-blue-100", DARK, "border-blue-300")],
  level4Right: [nd("Bính", "BÍNH", "Cầu đường", "土木設計", "bg-blue-100", DARK, "border-blue-300")],
  level5Left: [nd("Quang", "QUANG", "Thiết kế 3D", "3次設計", "bg-amber-100", DARK, "border-amber-300")],
  level5Right: [
    nd("Cao", "CAO", "Cầu đường", "土木設計", "bg-emerald-100", DARK, "border-emerald-300"),
    nd("Đức", "ĐỨC", "Cầu đường", "土木設計", "bg-emerald-100", DARK, "border-emerald-300"),
    nd("Hùng", "HÙNG", "Cầu đường", "土木設計", "bg-blue-500", LIGHT, "border-blue-600"),
  ],
  level6Left: [
    nd("Hoàn", "HOÀN", "Thiết kế 3D", "3次設計", "bg-amber-100", DARK, "border-amber-300"),
    nd("Duy", "DUY", "Thiết kế 3D", "3次設計", "bg-amber-100", DARK, "border-amber-300"),
  ],
  level6Right: [
    nd("Linh37", "LINH37", "Cầu đường", "土木設計", "bg-emerald-100", DARK, "border-emerald-300"),
    nd("Quân", "QUÂN", "Cầu đường", "土木設計", "bg-emerald-100", DARK, "border-emerald-300"),
    nd("Dương", "DƯƠNG", "Cầu đường", "土木設計", "bg-emerald-100", DARK, "border-emerald-300"),
    nd("?????", "?????", "Cầu đường", "土木設計", "bg-blue-500", LIGHT, "border-blue-600"),
    nd("Khải", "KHẢI", "Cầu đường", "土木設計", "bg-blue-500", LIGHT, "border-blue-600"),
  ],
};

const clone = (c: OrgChartData): OrgChartData => JSON.parse(JSON.stringify(c));

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

  // Ô đang mở hộp thoại sửa/thêm. group = cụm, index = -1 nghĩa là THÊM MỚI.
  const [editing, setEditing] = useState<{ group: GroupKey; index: number; node: OrgChartNode } | null>(null);

  useEffect(() => {
    api.colleagues().then(setColleagues).catch(() => {});

    api.orgChart()
      .then((res) => {
        // Backend lỗi/trả thiếu `data` -> KHÔNG được setChart(undefined), vì
        // view[group] sẽ ném lỗi và làm TRẮNG CẢ TRANG CHỦ.
        setChart(res?.data ?? DEFAULT_CHART);
        setCanEdit(res.can_edit);
        setUpdatedBy(res.updated_by_name || null);
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

  // ------------------------------------------------------------ tra cứu ERP
  const getMatchedUser = (node: OrgChartNode) =>
    colleagues.find((c) => c.full_name.toLowerCase() === node.key.toLowerCase());

  const handleNodeClick = (node: OrgChartNode) => {
    const matched = getMatchedUser(node);
    setSelectedUser(
      matched ?? {
        id: 0,
        full_name: node.name,
        role: "FIELD_STAFF",
        department: node.deptLabel + " / " + node.jpDeptLabel,
        in_my_team: false,
        manager_name: "Nhiều quản lý",
      },
    );
  };

  // ------------------------------------------------------------ thao tác sửa
  const startEdit = () => setDraft(clone(chart));
  const cancelEdit = () => { setDraft(null); setEditing(null); setErr(null); };

  const removeNode = (group: GroupKey, index: number) => {
    if (!draft) return;
    const node = draft[group][index];
    if (!window.confirm(`Xoá "${node.name}" khỏi sơ đồ?`)) return;
    const next = clone(draft);
    next[group].splice(index, 1);
    setDraft(next);
  };

  /** Sinh mã liên kết chưa trùng với ô nào khác trong sơ đồ. */
  const uniqueKey = (base: string, group: GroupKey, index: number) => {
    const src = draft ?? chart;
    const taken = new Set<string>();
    (Object.keys(src) as GroupKey[]).forEach((g) =>
      src[g].forEach((n, i) => {
        if (!(g === group && i === index)) taken.add(n.key.toLowerCase());
      }),
    );
    const root = (base || "Nhân sự").trim();
    if (!taken.has(root.toLowerCase())) return root;
    let i = 2;
    while (taken.has(`${root} ${i}`.toLowerCase())) i++;
    return `${root} ${i}`;
  };

  const commitNode = () => {
    if (!draft || !editing) return;
    const name = editing.node.name.trim();
    if (!name) { setErr("Tên nhân sự không được để trống."); return; }

    const next = clone(draft);
    const node: OrgChartNode = {
      ...editing.node,
      name,
      key: uniqueKey(editing.node.key.trim() || name, editing.group, editing.index),
    };
    if (editing.index < 0) next[editing.group].push(node);
    else next[editing.group][editing.index] = node;

    setDraft(next);
    setEditing(null);
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
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Không lưu được sơ đồ.");
    } finally {
      setSaving(false);
    }
  };

  // ------------------------------------------------------------------ render
  const renderNode = (node: OrgChartNode, group: GroupKey, index: number) => {
    const hasDbRecord = !!getMatchedUser(node);

    return (
      <div key={`${group}-${index}-${node.key}`} className="relative">
        <button
          onClick={() =>
            isEditMode ? setEditing({ group, index, node: { ...node } }) : handleNodeClick(node)
          }
          title={isEditMode ? "Bấm để sửa ô này" : "Xem chi tiết nhân sự"}
          className={`group relative flex w-28 flex-col items-center justify-center rounded-xl border-2 px-3 py-2 text-center shadow-md transition-all duration-200 hover:-translate-y-1 hover:shadow-lg active:scale-95 sm:w-32 ${node.bgClass} ${node.borderColor} ${node.textClass} ${
            isEditMode ? "ring-2 ring-indigo-300 ring-offset-1" : ""
          }`}
        >
          <span className="text-xs font-black tracking-wide">{node.name}</span>
          <span className="mt-0.5 text-[9px] font-semibold leading-tight opacity-85">{node.deptLabel}</span>
          <span className="text-[8px] leading-none opacity-70">{node.jpDeptLabel}</span>

          {/* Chấm xanh: ô này đã khớp một tài khoản ERP */}
          {hasDbRecord && !isEditMode && (
            <span className="absolute -right-1 -top-1 flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-600" />
            </span>
          )}
        </button>

        {isEditMode && (
          <button
            onClick={() => removeNode(group, index)}
            title={`Xoá ${node.name}`}
            className="absolute -right-2 -top-2 z-10 rounded-full border border-bad/40 bg-white p-1 text-bad shadow-sm transition-colors hover:bg-bad hover:text-white"
          >
            <TrashIcon className="h-3 w-3" />
          </button>
        )}
      </div>
    );
  };

  /** Nút "+" thêm ô vào cuối một cụm (chỉ hiện khi đang sửa). */
  const addButton = (group: GroupKey) =>
    isEditMode ? (
      <button
        key={`add-${group}`}
        onClick={() =>
          setEditing({
            group,
            index: -1,
            node: nd("", "", "", "", PALETTE[5].bgClass, PALETTE[5].textClass, PALETTE[5].borderColor),
          })
        }
        title="Thêm nhân sự vào hàng này"
        className="flex w-28 flex-col items-center justify-center rounded-xl border-2 border-dashed border-indigo-300 bg-indigo-50/50 px-3 py-2 text-indigo-600 transition-colors hover:border-indigo-500 hover:bg-indigo-100 sm:w-32"
      >
        <PlusIcon className="h-4 w-4" />
        <span className="mt-0.5 text-[9px] font-bold">Thêm</span>
      </button>
    ) : null;

  const renderGroup = (group: GroupKey) => (
    <>
      {(view?.[group] ?? []).map((n, i) => renderNode(n, group, i))}
      {addButton(group)}
    </>
  );

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center rounded-xl2 bg-white shadow-card">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-steel border-t-amber" />
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-xl2 border border-line/45 bg-white p-5 shadow-card">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-steel">Sơ đồ tổ chức công ty</h2>
          <p className="text-[10px] text-muted">
            {isEditMode
              ? "Đang sửa — bấm vào ô để đổi tên, bấm thùng rác để xoá, bấm Thêm để chèn nhân sự mới."
              : "Bấm vào từng nhân sự để xem chi tiết thông tin quản lý & liên hệ"}
          </p>
          {!isEditMode && updatedBy && (
            <p className="mt-0.5 text-[10px] text-muted italic">Cập nhật gần nhất bởi {updatedBy}</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {!isEditMode && (
            <div className="flex items-center gap-1.5 rounded bg-slate-50 px-2 py-1 text-[9px] text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-600" />
              <span>Đã liên kết tài khoản ERP</span>
            </div>
          )}

          {/* Thêm/sửa/xoá nhân sự: CHỈ Giám đốc, Quản trị hệ thống, Quản lý cấp cao.
              Backend chặn lần nữa ở PUT /org-chart nên ẩn nút chỉ là cho gọn UI. */}
          {canEdit && !isEditMode && (
            <button
              onClick={startEdit}
              className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-100 px-3 py-1 text-[11px] font-bold text-slate-700 shadow-sm transition-colors hover:bg-slate-200 hover:text-ink"
            >
              <PencilSquareIcon className="h-3.5 w-3.5 text-steel" />
              Sửa sơ đồ
            </button>
          )}

          {isEditMode && (
            <>
              <button
                onClick={cancelEdit}
                disabled={saving}
                className="rounded-full border border-line px-3 py-1 text-[11px] font-semibold text-muted transition-colors hover:bg-paper hover:text-ink disabled:opacity-50"
              >
                Huỷ bỏ
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="inline-flex items-center gap-1 rounded-full bg-ink px-3 py-1 text-[11px] font-bold text-white transition-colors hover:bg-steel disabled:opacity-50"
              >
                {saving ? (
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-amber" />
                ) : (
                  <CheckIcon className="h-3.5 w-3.5" />
                )}
                Lưu sơ đồ
              </button>
            </>
          )}
        </div>
      </div>

      {err && !editing && (
        <p className="mb-3 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-[11px] font-semibold text-bad">{err}</p>
      )}

      {/* Khung cuộn ngang của sơ đồ */}
      {/* Không ép min-width nữa: trước đây min-w-[1200px] làm sơ đồ LUÔN rộng hơn
          khung -> lúc nào cũng hiện thanh kéo ngang dù nội dung thật hẹp hơn nhiều.
          Giờ sơ đồ tự co về CHÍNH GIỮA; overflow-x-auto chỉ để phòng màn hình quá
          hẹp (điện thoại) thì mới xuất hiện thanh kéo. */}
      <div className="overflow-x-auto pb-2">
        <div className="flex w-full min-w-fit flex-col items-center space-y-6 py-2">

          {/* Hàng 1 */}
          <div className="flex justify-center gap-4 sm:gap-6">{renderGroup("level1")}</div>

          <div className="relative h-6 w-0.5 bg-slate-300">
            <div className="absolute top-0 -left-20 w-40 border-t-2 border-slate-300" />
          </div>

          {/* Hàng 2 */}
          <div className="flex justify-center gap-12 sm:gap-16">{renderGroup("level2")}</div>

          <div className="h-6 w-0.5 bg-slate-300" />

          {/* Hàng 3 */}
          <div className="flex justify-center gap-4">{renderGroup("level3")}</div>

          <div className="relative h-6 w-0.5 bg-slate-300">
            <div className="absolute top-0 -left-[230px] w-[460px] border-t-2 border-slate-300" />
          </div>

          {/* Hai nhánh: trái = Thiết kế 3D, phải = Cầu đường */}
          <div className="flex items-start justify-center gap-20">

            {/* Nhánh TRÁI */}
            <div className="flex flex-col items-center">
              <div className="mb-6 flex justify-center gap-3">{renderGroup("level4Left")}</div>
              <div className="h-6 w-0.5 bg-slate-300" />
              <div className="mb-6 mt-1 flex justify-center gap-3">{renderGroup("level5Left")}</div>
              <div className="relative h-6 w-0.5 bg-slate-300">
                <div className="absolute top-0 -left-16 w-32 border-t-2 border-slate-300" />
              </div>
              <div className="mt-1.5 flex justify-center gap-3">{renderGroup("level6Left")}</div>
            </div>

            {/* Nhánh PHẢI */}
            <div className="flex flex-col items-center">
              <div className="mb-6 flex justify-center gap-3">{renderGroup("level4Right")}</div>
              <div className="relative h-6 w-0.5 bg-slate-300">
                <div className="absolute top-0 -left-20 w-40 border-t-2 border-slate-300" />
              </div>
              <div className="mb-6 mt-1 flex justify-center gap-4">{renderGroup("level5Right")}</div>
              <div className="relative h-6 w-0.5 bg-slate-300">
                <div className="absolute top-0 -left-[240px] w-[480px] border-t-2 border-slate-300" />
              </div>
              <div className="mt-1.5 flex justify-center gap-3">{renderGroup("level6Right")}</div>
            </div>

          </div>
        </div>
      </div>

      {/* ---------------- Hộp thoại THÊM / SỬA một ô ---------------- */}
      {editing && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-line/60 bg-white p-5 shadow-2xl">
            <h3 className="text-sm font-bold text-ink">
              {editing.index < 0 ? "Thêm nhân sự vào sơ đồ" : "Sửa ô nhân sự"}
            </h3>

            <div className="mt-3 space-y-2.5">
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-muted">Tên hiển thị *</span>
                <input
                  autoFocus
                  value={editing.node.name}
                  onChange={(e) => setEditing({ ...editing, node: { ...editing.node, name: e.target.value } })}
                  onKeyDown={(e) => { if (e.key === "Enter") commitNode(); }}
                  placeholder="VD: HÙNG"
                  className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-muted">Mã liên kết tài khoản ERP</span>
                <input
                  value={editing.node.key}
                  onChange={(e) => setEditing({ ...editing, node: { ...editing.node, key: e.target.value } })}
                  placeholder="Để trống sẽ lấy theo tên hiển thị"
                  className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
                />
                <span className="mt-1 block text-[10px] text-muted">
                  Trùng <b className="text-ink">Họ tên</b> trong danh sách nhân viên thì ô sẽ hiện chấm xanh và bấm vào xem được hồ sơ.
                </span>
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold text-muted">Phòng ban</span>
                  <input
                    value={editing.node.deptLabel}
                    onChange={(e) => setEditing({ ...editing, node: { ...editing.node, deptLabel: e.target.value } })}
                    placeholder="VD: Cầu đường"
                    className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold text-muted">Tiếng Nhật</span>
                  <input
                    value={editing.node.jpDeptLabel}
                    onChange={(e) => setEditing({ ...editing, node: { ...editing.node, jpDeptLabel: e.target.value } })}
                    placeholder="VD: 土木設計"
                    className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-xs outline-none focus:border-steel"
                  />
                </label>
              </div>

              <div>
                <span className="mb-1 block text-[11px] font-semibold text-muted">Màu ô</span>
                <div className="flex flex-wrap gap-1.5">
                  {PALETTE.map((p) => {
                    const active = editing.node.bgClass === p.bgClass;
                    return (
                      <button
                        key={p.bgClass}
                        type="button"
                        title={p.label}
                        onClick={() =>
                          setEditing({
                            ...editing,
                            node: { ...editing.node, bgClass: p.bgClass, textClass: p.textClass, borderColor: p.borderColor },
                          })
                        }
                        className={`h-7 w-7 rounded-lg border-2 transition-transform hover:scale-110 ${p.bgClass} ${p.borderColor} ${
                          active ? "ring-2 ring-ink ring-offset-1" : ""
                        }`}
                      />
                    );
                  })}
                </div>
              </div>
            </div>

            {err && <p className="mt-2 text-[11px] font-semibold text-bad">{err}</p>}

            <div className="mt-4 flex gap-2">
              <button
                onClick={() => { setEditing(null); setErr(null); }}
                className="flex-1 rounded-xl2 border border-line py-2 text-xs font-semibold text-muted transition-colors hover:bg-paper hover:text-ink"
              >
                Huỷ
              </button>
              <button
                onClick={commitNode}
                className="flex-1 rounded-xl2 bg-ink py-2 text-xs font-semibold text-white transition-colors hover:bg-steel"
              >
                {editing.index < 0 ? "Thêm vào sơ đồ" : "Cập nhật"}
              </button>
            </div>
            <p className="mt-2 text-center text-[10px] text-muted">
              Thay đổi chỉ được ghi lại khi bấm <b className="text-ink">Lưu sơ đồ</b>.
            </p>
          </div>
        </div>
      )}

      {/* ---------------- Hồ sơ nhân sự (chế độ xem) ---------------- */}
      {selectedUser && (
        <div className="animate-fade-in absolute inset-0 z-30 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="animate-scale-up relative w-full max-w-sm rounded-2xl border border-line/60 bg-white p-5 shadow-2xl">
            <button
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
                    {roleTitle(selectedUser.role, selectedUser.has_subordinates, !selectedUser.manager_id && !selectedUser.manager_ids)}
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
                  Tài khoản này là mẫu trên sơ đồ, chưa đăng ký tài khoản ERP chính thức trong danh sách nhân viên.
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
                onClick={() => setSelectedUser(null)}
                className="w-full rounded-xl2 bg-slate-100 py-2 text-xs font-bold text-muted transition-colors hover:bg-slate-200 hover:text-ink"
              >
                Đóng
              </button>
              {selectedUser.id > 0 && (
                <button
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
