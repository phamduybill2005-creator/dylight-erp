"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Colleague } from "@/lib/types";
import { 
  UserIcon, 
  EnvelopeIcon, 
  PhoneIcon, 
  BriefcaseIcon,
  XMarkIcon,
  AcademicCapIcon
} from "@heroicons/react/24/outline";

// Definition of each person in the org chart structure
interface NodeDef {
  key: string;
  name: string;
  deptLabel: string;
  jpDeptLabel: string;
  bgClass: string;
  textClass: string;
  borderColor: string;
}

// Predefined chart structure
const LEVEL_1: NodeDef[] = [
  { key: "Giang", name: "GIANG", deptLabel: "Địa hình", jpDeptLabel: "地形解析", bgClass: "bg-cyan-400", textClass: "text-slate-900", borderColor: "border-cyan-500" },
  { key: "Nhung", name: "NHUNG", deptLabel: "Địa hình", jpDeptLabel: "地形解析", bgClass: "bg-emerald-500", textClass: "text-slate-900", borderColor: "border-emerald-600" },
  { key: "Đạt", name: "ĐẠT", deptLabel: "Địa hình", jpDeptLabel: "地形解析", bgClass: "bg-amber-500", textClass: "text-slate-900", borderColor: "border-amber-600" },
  { key: "Dũng", name: "DŨNG", deptLabel: "Địa hình", jpDeptLabel: "地形解析", bgClass: "bg-green-500", textClass: "text-slate-900", borderColor: "border-green-600" },
];

const LEVEL_2: NodeDef[] = [
  { key: "Cường", name: "CƯỜNG", deptLabel: "Địa hình", jpDeptLabel: "地形解析", bgClass: "bg-cyan-400", textClass: "text-slate-900", borderColor: "border-cyan-500" },
  { key: "Phú", name: "PHÚ", deptLabel: "Địa hình", jpDeptLabel: "地形解析", bgClass: "bg-amber-500", textClass: "text-slate-900", borderColor: "border-amber-600" },
];

const LEVEL_3: NodeDef[] = [
  { key: "Sơn", name: "SƠN", deptLabel: "Địa hình", jpDeptLabel: "地形解析", bgClass: "bg-green-500", textClass: "text-slate-900", borderColor: "border-green-600" },
];

const LEVEL_4: NodeDef[] = [
  { key: "Lâm", name: "LÂM", deptLabel: "3D & Cầu đường", jpDeptLabel: "3次設計、土木設計", bgClass: "bg-blue-100", textClass: "text-slate-900", borderColor: "border-blue-300" },
  { key: "Bính", name: "BÍNH", deptLabel: "Cầu đường", jpDeptLabel: "土木設計", bgClass: "bg-blue-100", textClass: "text-slate-900", borderColor: "border-blue-300" },
];

const LEVEL_5: NodeDef[] = [
  { key: "Quang", name: "QUANG", deptLabel: "Thiết kế 3D", jpDeptLabel: "3次設計", bgClass: "bg-amber-100", textClass: "text-slate-900", borderColor: "border-amber-300" },
  { key: "Cao", name: "CAO", deptLabel: "Cầu đường", jpDeptLabel: "土木設計", bgClass: "bg-emerald-100", textClass: "text-slate-900", borderColor: "border-emerald-300" },
  { key: "Đức", name: "ĐỨC", deptLabel: "Cầu đường", jpDeptLabel: "土木設計", bgClass: "bg-emerald-100", textClass: "text-slate-900", borderColor: "border-emerald-300" },
  { key: "Hùng", name: "HÙNG", deptLabel: "Cầu đường", jpDeptLabel: "土木設計", bgClass: "bg-blue-500", textClass: "text-white", borderColor: "border-blue-600" },
];

const LEVEL_6_LEFT: NodeDef[] = [
  { key: "Hoàn", name: "HOÀN", deptLabel: "Thiết kế 3D", jpDeptLabel: "3次設計", bgClass: "bg-amber-100", textClass: "text-slate-900", borderColor: "border-amber-300" },
  { key: "Duy", name: "DUY", deptLabel: "Thiết kế 3D", jpDeptLabel: "3次設計", bgClass: "bg-amber-100", textClass: "text-slate-900", borderColor: "border-amber-300" },
];

const LEVEL_6_RIGHT: NodeDef[] = [
  { key: "Linh37", name: "LINH37", deptLabel: "Cầu đường", jpDeptLabel: "土木設計", bgClass: "bg-emerald-100", textClass: "text-slate-900", borderColor: "border-emerald-300" },
  { key: "Quân", name: "QUÂN", deptLabel: "Cầu đường", jpDeptLabel: "土木設計", bgClass: "bg-emerald-100", textClass: "text-slate-900", borderColor: "border-emerald-300" },
  { key: "Dương", name: "DƯƠNG", deptLabel: "Cầu đường", jpDeptLabel: "土木設計", bgClass: "bg-emerald-100", textClass: "text-slate-900", borderColor: "border-emerald-300" },
  { key: "?????", name: "?????", deptLabel: "Cầu đường", jpDeptLabel: "土木設計", bgClass: "bg-blue-500", textClass: "text-white", borderColor: "border-blue-600" },
  { key: "Khải", name: "KHẢI", deptLabel: "Cầu đường", jpDeptLabel: "土木設計", bgClass: "bg-blue-500", textClass: "text-white", borderColor: "border-blue-600" },
];

export default function CompanyOrgChart() {
  const [colleagues, setColleagues] = useState<Colleague[]>([]);
  const [selectedUser, setSelectedUser] = useState<Colleague | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.colleagues()
      .then((data) => {
        setColleagues(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load colleagues for org chart:", err);
        setLoading(false);
      });
  }, []);

  // Find db user matching a node key name
  const getMatchedUser = (node: NodeDef) => {
    return colleagues.find(
      (c) => c.full_name.toLowerCase() === node.key.toLowerCase()
    );
  };

  const handleNodeClick = (node: NodeDef) => {
    const matched = getMatchedUser(node);
    if (matched) {
      setSelectedUser(matched);
    } else {
      // Mock user details if not found in live DB (fallbacks)
      setSelectedUser({
        id: 0,
        full_name: node.name,
        role: "FIELD_STAFF",
        department: node.deptLabel + " / " + node.jpDeptLabel,
        in_my_team: false,
        manager_name: "Nhiều quản lý",
      });
    }
  };

  const renderNode = (node: NodeDef) => {
    const matched = getMatchedUser(node);
    const hasDbRecord = !!matched;

    return (
      <button
        key={node.key}
        onClick={() => handleNodeClick(node)}
        className={`group relative flex flex-col items-center justify-center rounded-xl border-2 px-3 py-2 text-center shadow-md transition-all duration-200 hover:-translate-y-1 hover:shadow-lg active:scale-95 ${node.bgClass} ${node.borderColor} ${node.textClass} w-28 sm:w-32`}
      >
        <span className="text-xs font-black tracking-wide">{node.name}</span>
        <span className="mt-0.5 text-[9px] font-semibold opacity-85 leading-tight">{node.deptLabel}</span>
        <span className="text-[8px] opacity-70 leading-none">{node.jpDeptLabel}</span>
        
        {/* Live indicator if synced with DB */}
        {hasDbRecord && (
          <span className="absolute -right-1 -top-1 flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-600"></span>
          </span>
        )}
      </button>
    );
  };

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center rounded-xl2 bg-white shadow-card">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-steel border-t-amber" />
      </div>
    );
  }

  return (
    <div className="rounded-xl2 bg-white p-5 shadow-card border border-line/45 relative overflow-hidden">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-ink uppercase tracking-wider text-steel">Sơ đồ tổ chức công ty</h2>
          <p className="text-[10px] text-muted">Bấm vào từng nhân sự để xem chi tiết thông tin quản lý & liên hệ</p>
        </div>
        <div className="flex items-center gap-1.5 text-[9px] text-muted bg-slate-50 px-2 py-1 rounded">
          <span className="h-1.5 w-1.5 rounded-full bg-indigo-600"></span>
          <span>Đã liên kết tài khoản ERP</span>
        </div>
      </div>

      {/* Org Chart Scroll Wrapper */}
      <div className="overflow-x-auto pb-4">
        <div className="min-w-[800px] flex flex-col items-center py-2 space-y-6">
          
          {/* Level 1: GIANG, NHUNG, ĐẠT, DŨNG */}
          <div className="flex gap-4 sm:gap-6 justify-center">
            {LEVEL_1.map(renderNode)}
          </div>

          {/* Connection Line 1 -> 2 */}
          <div className="w-0.5 h-6 bg-slate-300 relative">
            <div className="absolute top-0 -left-20 w-40 border-t-2 border-slate-300"></div>
          </div>

          {/* Level 2: CƯỜNG, PHÚ */}
          <div className="flex gap-12 sm:gap-16 justify-center">
            {LEVEL_2.map(renderNode)}
          </div>

          {/* Connection Line 2 -> 3 */}
          <div className="w-0.5 h-6 bg-slate-300"></div>

          {/* Level 3: SƠN */}
          <div className="flex justify-center">
            {LEVEL_3.map(renderNode)}
          </div>

          {/* Connection Line 3 -> 4 */}
          <div className="w-0.5 h-6 bg-slate-300"></div>

          {/* Level 4: LÂM, BÍNH */}
          <div className="flex gap-16 sm:gap-20 justify-center">
            {LEVEL_4.map(renderNode)}
          </div>

          {/* Connection Line 4 -> 5 */}
          <div className="w-0.5 h-6 bg-slate-300 relative">
            <div className="absolute top-0 -left-32 w-64 border-t-2 border-slate-300"></div>
          </div>

          {/* Level 5: QUANG, CAO, ĐỨC, HÙNG */}
          <div className="flex gap-6 sm:gap-8 justify-center">
            {LEVEL_5.map(renderNode)}
          </div>

          {/* Level 5 to Level 6 split connection */}
          <div className="w-full flex justify-between px-16 xl:px-24">
            {/* Left section connection (Quang -> Hoàn, Duy) */}
            <div className="flex flex-col items-center w-1/3">
              <div className="w-0.5 h-6 bg-slate-300 relative">
                <div className="absolute top-0 -left-12 w-24 border-t-2 border-slate-300"></div>
              </div>
              <div className="flex gap-3 mt-1.5 justify-center">
                {LEVEL_6_LEFT.map(renderNode)}
              </div>
            </div>

            {/* Right section connection (Cao, Đức, Hùng -> Linh37, Quân, Dương, ?????, Khải) */}
            <div className="flex flex-col items-center w-2/3">
              <div className="w-0.5 h-6 bg-slate-300 relative">
                <div className="absolute top-0 -left-40 w-80 border-t-2 border-slate-300"></div>
              </div>
              <div className="flex gap-3 mt-1.5 justify-center">
                {LEVEL_6_RIGHT.map(renderNode)}
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Interactive Tooltip Card / Profile Modal */}
      {selectedUser && (
        <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm z-30 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-line/60 relative animate-scale-up">
            <button 
              onClick={() => setSelectedUser(null)}
              className="absolute right-3 top-3 text-muted hover:text-ink hover:bg-slate-100 p-1.5 rounded-full transition-colors"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-3.5 pb-4 border-b border-line">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 border border-indigo-100 shrink-0">
                <UserIcon className="h-6 w-6" />
              </span>
              <div className="min-w-0">
                <h3 className="text-base font-bold text-ink truncate">{selectedUser.full_name}</h3>
                <p className="text-xs text-muted font-medium">{selectedUser.department || "—"}</p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <div className="flex items-start gap-2.5 text-xs text-ink">
                <BriefcaseIcon className="h-4 w-4 text-muted mt-0.5 shrink-0" />
                <div>
                  <span className="font-semibold text-muted block text-[10px] uppercase">Chức vụ</span>
                  <span className="font-semibold text-slate-800">{selectedUser.role === "DIRECTOR" ? "Giám đốc" : selectedUser.role === "MANAGER" ? "Trưởng phòng / Quản lý" : "Nhân viên"}</span>
                </div>
              </div>

              {selectedUser.id > 0 ? (
                <>
                  <div className="flex items-start gap-2.5 text-xs text-ink">
                    <EnvelopeIcon className="h-4 w-4 text-muted mt-0.5 shrink-0" />
                    <div>
                      <span className="font-semibold text-muted block text-[10px] uppercase">Email</span>
                      <span className="text-slate-800 font-medium">{selectedUser.email || "—"}</span>
                    </div>
                  </div>

                  <div className="flex items-start gap-2.5 text-xs text-ink">
                    <PhoneIcon className="h-4 w-4 text-muted mt-0.5 shrink-0" />
                    <div>
                      <span className="font-semibold text-muted block text-[10px] uppercase">Số điện thoại</span>
                      <span className="text-slate-800 font-medium">{selectedUser.phone || "—"}</span>
                    </div>
                  </div>
                </>
              ) : (
                <div className="bg-slate-50 p-2.5 rounded-lg border border-line/50 text-[11px] text-muted italic">
                  Tài khoản này là mẫu trên sơ đồ, chưa đăng ký tài khoản ERP chính thức trong danh sách nhân viên.
                </div>
              )}

              {/* Managers list display */}
              <div className="flex items-start gap-2.5 text-xs text-ink pt-2.5 border-t border-line/45">
                <AcademicCapIcon className="h-4 w-4 text-muted mt-0.5 shrink-0" />
                <div>
                  <span className="font-semibold text-muted block text-[10px] uppercase">Người quản lý trực tiếp</span>
                  {selectedUser.manager_ids ? (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {selectedUser.manager_ids.split(",").map(mid => {
                        const m = colleagues.find(c => String(c.id) === mid.trim());
                        return m ? (
                          <span key={mid} className="inline-block bg-indigo-50 border border-indigo-100 text-indigo-700 px-2 py-0.5 rounded text-[10px] font-bold">
                            {m.full_name}
                          </span>
                        ) : null;
                      })}
                    </div>
                  ) : selectedUser.manager_name ? (
                    <span className="font-semibold text-slate-800 mt-1 inline-block">{selectedUser.manager_name}</span>
                  ) : (
                    <span className="text-muted italic">Không có quản lý</span>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-5 flex gap-2">
              <button
                onClick={() => setSelectedUser(null)}
                className="w-full rounded-xl2 bg-slate-100 hover:bg-slate-200 py-2 text-xs font-bold text-muted hover:text-ink transition-colors"
              >
                Đóng
              </button>
              {selectedUser.id > 0 && (
                <button
                  onClick={() => {
                    setSelectedUser(null);
                    window.location.href = `/attendance?userId=${selectedUser.id}`;
                  }}
                  className="w-full rounded-xl2 bg-steel hover:bg-steel/90 py-2 text-xs font-bold text-white shadow-sm transition-colors"
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
