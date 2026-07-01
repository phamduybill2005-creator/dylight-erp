"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  ClipboardDocumentListIcon,
  PlusIcon,
  MagnifyingGlassIcon,
  BuildingOfficeIcon,
  BanknotesIcon,
  FolderPlusIcon,
  XMarkIcon,
  ArrowRightIcon,
} from "@heroicons/react/24/outline";
import AppShell from "@/components/app-shell";
import { api } from "@/lib/api";
import { canSeeMoney } from "@/lib/roles";
import { formatVND, formatDate, todayLocal } from "@/lib/format";
import type { Bid, BidStatus, Project, User } from "@/lib/types";

const STATUS_CONFIG: Record<BidStatus, { label: string; cls: string }> = {
  DRAFT: { label: "Nháp", cls: "bg-line text-muted" },
  SUBMITTED: { label: "Đã nộp", cls: "bg-steel/10 text-steel" },
  WON: { label: "Trúng thầu", cls: "bg-ok/15 text-ok" },
  LOST: { label: "Trượt thầu", cls: "bg-bad/15 text-bad" },
  CANCELLED: { label: "Đã hủy", cls: "bg-bad/15 text-bad" },
};

export default function BidsPage() {
  const router = useRouter();
  const [bids, setBids] = useState<Bid[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [me, setMe] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  // Chỉ Giám đốc thấy/đặt giá gói thầu (khớp backend). Quản lý vẫn theo dõi hồ sơ thầu.
  const showMoney = canSeeMoney(me?.role);
  
  // Filter & Search
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  // Modals
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [selectedBid, setSelectedBid] = useState<Bid | null>(null);

  // Form states for new Bid
  const [newBid, setNewBid] = useState({
    code: "",
    name: "",
    investor: "",
    package_value: 0,
    status: "DRAFT" as BidStatus,
    submit_date: "",
    note: "",
  });

  // Form states for new Project from Won Bid
  const [newProject, setNewProject] = useState({
    code: "",
    name: "",
    location: "",
    manager_name: "",
    start_date: "",
  });

  const [error, setError] = useState<string | null>(null);

  function loadData() {
    setLoading(true);
    Promise.all([api.bids(), api.projects(), api.me()])
      .then(([bidsData, projectsData, meData]) => {
        setBids(bidsData);
        setProjects(projectsData);
        setMe(meData);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(loadData, []);

  async function handleCreateBid(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!newBid.code || !newBid.name) {
      setError("Vui lòng điền Mã thầu và Tên gói thầu.");
      return;
    }
    try {
      await api.createBid({
        ...newBid,
        package_value: Number(newBid.package_value),
        submit_date: newBid.submit_date || null,
      });
      setCreateModalOpen(false);
      // Reset form
      setNewBid({
        code: "",
        name: "",
        investor: "",
        package_value: 0,
        status: "DRAFT",
        submit_date: "",
        note: "",
      });
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tạo gói thầu thất bại.");
    }
  }

  async function onSubmitProject(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!selectedBid) return;
    if (!newProject.code || !newProject.name) {
      setError("Vui lòng nhập đầy đủ mã và tên dự án.");
      return;
    }

    try {
      await api.createProject({
        code: newProject.code,
        name: newProject.name,
        location: newProject.location || null,
        manager_name: newProject.manager_name || null,
        status: "ACTIVE",
        start_date: newProject.start_date || null,
        bid_id: selectedBid.id,
      });

      setProjectModalOpen(false);
      setSelectedBid(null);
      loadData();
      router.push("/projects"); // Redirect to projects page to see new project
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tạo dự án thất bại.");
    }
  }

  // Filtered bids
  const filteredBids = bids.filter((b) => {
    const matchesSearch =
      b.name.toLowerCase().includes(search.toLowerCase()) ||
      b.code.toLowerCase().includes(search.toLowerCase()) ||
      (b.investor || "").toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "ALL" || b.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <AppShell>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-ink lg:text-2xl">Quản lý đấu thầu</h1>
          <p className="text-xs text-muted lg:text-sm">Theo dõi và lập hồ sơ đấu thầu.</p>
        </div>
        <button
          onClick={() => setCreateModalOpen(true)}
          className="flex items-center gap-1 rounded-xl2 bg-amber px-3 py-2 text-xs font-semibold text-ink shadow-fab lg:px-4 lg:py-2.5 lg:text-sm"
        >
          <PlusIcon className="h-4 w-4" />
          Thêm gói thầu
        </button>
      </div>

      {/* Tìm kiếm & Lọc */}
      <div className="mt-4 flex gap-2 lg:gap-3">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="absolute left-3 top-2.5 h-4 w-4 text-muted" />
          <input
            type="text"
            placeholder="Tìm theo tên, mã, chủ đầu tư..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl2 border border-line bg-white py-2 pl-9 pr-4 text-xs focus:border-amber focus:outline-none"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-xl2 border border-line bg-white px-3 py-2 text-xs focus:border-amber focus:outline-none"
        >
          <option value="ALL">Tất cả trạng thái</option>
          <option value="DRAFT">Nháp</option>
          <option value="SUBMITTED">Đã nộp</option>
          <option value="WON">Trúng thầu</option>
          <option value="LOST">Trượt thầu</option>
        </select>
      </div>

      {/* Danh sách gói thầu */}
      <div className="mt-4 space-y-3 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0 xl:grid-cols-3">
        {loading ? (
          <p className="py-8 text-center text-xs text-muted lg:col-span-full">Đang tải danh sách...</p>
        ) : filteredBids.length === 0 ? (
          <p className="rounded-xl2 bg-white p-8 text-center text-xs text-muted shadow-card lg:col-span-full">
            Không tìm thấy gói thầu nào.
          </p>
        ) : (
          filteredBids.map((b) => {
            const st = STATUS_CONFIG[b.status] || STATUS_CONFIG.DRAFT;
            const linkedProject = projects.find((p) => p.bid_id === b.id);

            return (
              <div key={b.id} className="rounded-xl2 bg-white p-4 shadow-card border border-line/50 lg:flex lg:flex-col">
                <div className="flex items-start justify-between">
                  <div className="min-w-0">
                    <span className="font-mono text-[10px] text-muted">{b.code}</span>
                    <h3 className="truncate text-sm font-semibold text-ink">{b.name}</h3>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${st.cls}`}>
                    {st.label}
                  </span>
                </div>

                <div className="mt-2 space-y-1 text-xs text-muted">
                  {b.investor && (
                    <p className="flex items-center gap-1.5">
                      <BuildingOfficeIcon className="h-3.5 w-3.5 shrink-0 text-muted/70" />
                      Chủ đầu tư: <span className="font-medium text-ink">{b.investor}</span>
                    </p>
                  )}
                  {showMoney && (
                    <p className="flex items-center gap-1.5">
                      <BanknotesIcon className="h-3.5 w-3.5 shrink-0 text-muted/70" />
                      Giá gói thầu:{" "}
                      <span className="font-semibold text-ink tnum">
                        {formatVND(b.package_value)}
                      </span>
                    </p>
                  )}
                  {b.submit_date && (
                    <p>Ngày nộp thầu: <span className="font-medium text-ink">{formatDate(b.submit_date)}</span></p>
                  )}
                </div>

                {/* Hành động liên quan đến gói thầu trúng */}
                {b.status === "WON" && (
                  <div className="mt-3 border-t border-line pt-3 flex justify-end lg:mt-auto">
                    {linkedProject ? (
                      <button
                        onClick={() => router.push(`/projects`)}
                        className="flex items-center gap-1 text-xs font-semibold text-steel hover:text-ink"
                      >
                        Xem dự án liên kết
                        <ArrowRightIcon className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          setSelectedBid(b);
                          setNewProject({
                            code: `DA-${b.code}`,
                            name: b.name.replace("Gói thầu ", "").replace("gói ", ""),
                            location: "",
                            manager_name: "",
                            start_date: todayLocal(),
                          });
                          setProjectModalOpen(true);
                        }}
                        className="flex items-center gap-1.5 rounded-full bg-ok/10 px-3 py-1.5 text-xs font-semibold text-ok hover:bg-ok/20 transition-all"
                      >
                        <FolderPlusIcon className="h-3.5 w-3.5" />
                        Tạo dự án thi công
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Modal Thêm Gói Thầu */}
      <AnimatePresence>
        {createModalOpen && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 lg:items-center">
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25 }}
              className="w-full max-w-md rounded-t-xl2 bg-white p-5 shadow-card lg:max-w-lg lg:rounded-xl2 lg:p-6"
            >
              <div className="flex items-center justify-between border-b border-line pb-3">
                <h2 className="text-sm font-bold text-ink lg:text-base">Thêm gói thầu mới</h2>
                <button onClick={() => setCreateModalOpen(false)} className="rounded-full p-1 hover:bg-paper">
                  <XMarkIcon className="h-5 w-5 text-muted" />
                </button>
              </div>

              <form onSubmit={handleCreateBid} className="mt-4 space-y-3">
                {error && <p className="text-xs text-bad">{error}</p>}
                
                <div>
                  <label className="text-[11px] font-semibold text-muted block mb-1">Mã hồ sơ thầu *</label>
                  <input
                    type="text"
                    required
                    placeholder="VD: HSDT-2026-03"
                    value={newBid.code}
                    onChange={(e) => setNewBid({ ...newBid, code: e.target.value })}
                    className="w-full rounded-xl2 border border-line bg-paper px-3 py-2 text-xs focus:bg-white focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-muted block mb-1">Tên gói thầu *</label>
                  <input
                    type="text"
                    required
                    placeholder="VD: Thi công kết cấu thép nhà máy A"
                    value={newBid.name}
                    onChange={(e) => setNewBid({ ...newBid, name: e.target.value })}
                    className="w-full rounded-xl2 border border-line bg-paper px-3 py-2 text-xs focus:bg-white focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold text-muted block mb-1">Chủ đầu tư</label>
                    <input
                      type="text"
                      placeholder="VD: Ban QLDA..."
                      value={newBid.investor}
                      onChange={(e) => setNewBid({ ...newBid, investor: e.target.value })}
                      className="w-full rounded-xl2 border border-line bg-paper px-3 py-2 text-xs focus:bg-white focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-muted block mb-1">Trạng thái thầu</label>
                    <select
                      value={newBid.status}
                      onChange={(e) => setNewBid({ ...newBid, status: e.target.value as BidStatus })}
                      className="w-full rounded-xl2 border border-line bg-paper px-3 py-2 text-xs focus:bg-white focus:outline-none"
                    >
                      <option value="DRAFT">Nháp</option>
                      <option value="SUBMITTED">Đã nộp</option>
                      <option value="WON">Trúng thầu</option>
                      <option value="LOST">Trượt thầu</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {showMoney && (
                    <div>
                      <label className="text-[11px] font-semibold text-muted block mb-1">Giá trị gói thầu (VND)</label>
                      <input
                        type="number"
                        placeholder="VD: 5000000000"
                        value={newBid.package_value || ""}
                        onChange={(e) => setNewBid({ ...newBid, package_value: Number(e.target.value) })}
                        className="w-full rounded-xl2 border border-line bg-paper px-3 py-2 text-xs focus:bg-white focus:outline-none"
                      />
                    </div>
                  )}
                  <div className={showMoney ? "" : "col-span-2"}>
                    <label className="text-[11px] font-semibold text-muted block mb-1">Ngày nộp hồ sơ</label>
                    <input
                      type="date"
                      value={newBid.submit_date}
                      onChange={(e) => setNewBid({ ...newBid, submit_date: e.target.value })}
                      className="w-full rounded-xl2 border border-line bg-paper px-3 py-2 text-xs focus:bg-white focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-muted block mb-1">Ghi chú</label>
                  <textarea
                    rows={2}
                    placeholder="Thông tin thêm..."
                    value={newBid.note}
                    onChange={(e) => setNewBid({ ...newBid, note: e.target.value })}
                    className="w-full rounded-xl2 border border-line bg-paper px-3 py-2 text-xs focus:bg-white focus:outline-none"
                  />
                </div>

                <div className="pt-2 flex gap-2">
                  <button
                    type="submit"
                    className="flex-1 rounded-xl2 bg-amber py-2.5 text-xs font-semibold text-ink text-center block shadow-fab"
                  >
                    Tạo gói thầu
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreateModalOpen(false)}
                    className="rounded-xl2 bg-paper px-4 py-2.5 text-xs text-muted font-medium"
                  >
                    Hủy
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal Tạo Dự Án khi Trúng Thầu */}
      <AnimatePresence>
        {projectModalOpen && selectedBid && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 lg:items-center">
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25 }}
              className="w-full max-w-md rounded-t-xl2 bg-white p-5 shadow-card lg:max-w-lg lg:rounded-xl2 lg:p-6"
            >
              <div className="flex items-center justify-between border-b border-line pb-3">
                <div>
                  <h2 className="text-sm font-bold text-ink lg:text-base">Tạo dự án thi công</h2>
                  <p className="text-[10px] text-muted">Khởi tạo dự án từ gói thầu: {selectedBid.name}</p>
                </div>
                <button onClick={() => setProjectModalOpen(false)} className="rounded-full p-1 hover:bg-paper">
                  <XMarkIcon className="h-5 w-5 text-muted" />
                </button>
              </div>

              <form onSubmit={onSubmitProject} className="mt-4 space-y-3">
                {error && <p className="text-xs text-bad">{error}</p>}
                
                <div>
                  <label className="text-[11px] font-semibold text-muted block mb-1">Mã dự án *</label>
                  <input
                    type="text"
                    required
                    value={newProject.code}
                    onChange={(e) => setNewProject({ ...newProject, code: e.target.value })}
                    className="w-full rounded-xl2 border border-line bg-paper px-3 py-2 text-xs focus:bg-white focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-muted block mb-1">Tên dự án *</label>
                  <input
                    type="text"
                    required
                    value={newProject.name}
                    onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                    className="w-full rounded-xl2 border border-line bg-paper px-3 py-2 text-xs focus:bg-white focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-muted block mb-1">Địa điểm công trình</label>
                  <input
                    type="text"
                    placeholder="VD: Sóc Sơn, Hà Nội"
                    value={newProject.location}
                    onChange={(e) => setNewProject({ ...newProject, location: e.target.value })}
                    className="w-full rounded-xl2 border border-line bg-paper px-3 py-2 text-xs focus:bg-white focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold text-muted block mb-1">Chỉ huy trưởng</label>
                    <input
                      type="text"
                      placeholder="VD: KS. Nguyễn Văn A"
                      value={newProject.manager_name}
                      onChange={(e) => setNewProject({ ...newProject, manager_name: e.target.value })}
                      className="w-full rounded-xl2 border border-line bg-paper px-3 py-2 text-xs focus:bg-white focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-muted block mb-1">Ngày bắt đầu</label>
                    <input
                      type="date"
                      value={newProject.start_date}
                      onChange={(e) => setNewProject({ ...newProject, start_date: e.target.value })}
                      className="w-full rounded-xl2 border border-line bg-paper px-3 py-2 text-xs focus:bg-white focus:outline-none"
                    />
                  </div>
                </div>

                <div className="pt-2 flex gap-2">
                  <button
                    type="submit"
                    className="flex-1 rounded-xl2 bg-ok py-2.5 text-xs font-semibold text-white text-center block"
                  >
                    Khởi tạo dự án
                  </button>
                  <button
                    type="button"
                    onClick={() => setProjectModalOpen(false)}
                    className="rounded-xl2 bg-paper px-4 py-2.5 text-xs text-muted font-medium"
                  >
                    Hủy
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </AppShell>
  );
}
