"use client";

import { useEffect, useState } from "react";
import { XMarkIcon, ArrowPathIcon, ArchiveBoxIcon, FolderIcon, QueueListIcon } from "@heroicons/react/24/outline";
import { api } from "@/lib/api";
import { useEscapeKey } from "@/lib/use-escape-key";
import { formatDate } from "@/lib/format";
import type { DeletedProject, DeletedItem } from "@/lib/types";

interface ArchiveModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId?: number;
  onRestored?: () => void;
}

export default function ArchiveModal({ isOpen, onClose, projectId, onRestored }: ArchiveModalProps) {
  const [activeTab, setActiveTab] = useState<"items" | "projects">("items");
  const [deletedProjects, setDeletedProjects] = useState<DeletedProject[]>([]);
  const [deletedItems, setDeletedItems] = useState<DeletedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEscapeKey(onClose, isOpen);

  const loadArchiveData = async () => {
    if (!isOpen) return;
    setLoading(true);
    setError(null);
    try {
      const [projList, itemList] = await Promise.all([
        api.getDeletedProjects().catch(() => []),
        api.getDeletedItems(projectId).catch(() => []),
      ]);
      setDeletedProjects(projList);
      setDeletedItems(itemList);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tải dữ liệu thùng rác thất bại.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadArchiveData();
    }
  }, [isOpen, projectId]);

  const handleRestoreProject = async (proj: DeletedProject) => {
    setRestoringId(`proj-${proj.id}`);
    setError(null);
    try {
      await api.restoreProject(proj.id);
      setSuccessMsg(`Đã khôi phục thành công dự án "${proj.name}".`);
      await loadArchiveData();
      if (onRestored) onRestored();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Khôi phục dự án thất bại.");
    } finally {
      setRestoringId(null);
    }
  };

  const handleRestoreItem = async (item: DeletedItem) => {
    setRestoringId(`item-${item.id}`);
    setError(null);
    try {
      await api.restoreItem(item.id);
      setSuccessMsg(`Đã khôi phục thành công hạng mục "${item.name}".`);
      await loadArchiveData();
      if (onRestored) onRestored();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Khôi phục hạng mục thất bại.");
    } finally {
      setRestoringId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-4xl max-h-[85vh] flex flex-col rounded-2xl bg-white shadow-2xl overflow-hidden border border-line">
        {/* Header Modal */}
        <div className="flex items-center justify-between border-b border-line bg-paper px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber/15 text-amber-deep">
              <ArchiveBoxIcon className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-base font-bold text-ink">Thùng rác & Khôi phục dữ liệu</h3>
              <p className="text-xs text-muted">Lưu trữ các dự án & hạng mục đã xóa để dễ dàng tìm và khôi phục nhầm</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted hover:bg-line/60 hover:text-ink transition-colors"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Thông báo phân quyền phòng ban */}
        <div className="bg-steel/10 px-5 py-2 text-[11px] text-steel font-medium border-b border-steel/20 flex items-center gap-1.5">
          <span>ℹ️</span>
          <span>Dữ liệu đã xóa được tự động lọc theo đúng phòng ban và phân công của bạn để bạn khôi phục nhanh nhất.</span>
        </div>

        {/* Tabs navigation */}
        <div className="flex border-b border-line px-5 pt-3 gap-3 bg-white">
          <button
            type="button"
            onClick={() => setActiveTab("items")}
            className={`flex items-center gap-2 border-b-2 pb-2 text-xs font-bold transition-all ${
              activeTab === "items"
                ? "border-amber text-amber-deep"
                : "border-transparent text-muted hover:text-ink"
            }`}
          >
            <QueueListIcon className="h-4 w-4" />
            Hạng mục đã xóa ({deletedItems.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("projects")}
            className={`flex items-center gap-2 border-b-2 pb-2 text-xs font-bold transition-all ${
              activeTab === "projects"
                ? "border-amber text-amber-deep"
                : "border-transparent text-muted hover:text-ink"
            }`}
          >
            <FolderIcon className="h-4 w-4" />
            Dự án đã xóa ({deletedProjects.length})
          </button>
        </div>

        {/* Thông báo Lỗi / Thành công */}
        {error && (
          <div className="mx-5 mt-3 rounded-lg bg-bad/10 p-2.5 text-xs font-medium text-bad border border-bad/30">
            ❌ {error}
          </div>
        )}
        {successMsg && (
          <div className="mx-5 mt-3 rounded-lg bg-ok/10 p-2.5 text-xs font-medium text-ok border border-ok/30 flex items-center justify-between">
            <span>✅ {successMsg}</span>
            <button onClick={() => setSuccessMsg(null)} className="text-muted hover:text-ink">
              <XMarkIcon className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Nội dung danh sách theo Tab */}
        <div className="flex-1 overflow-auto p-5">
          {loading ? (
            <div className="py-12 text-center text-xs text-muted flex items-center justify-center gap-2">
              <ArrowPathIcon className="h-5 w-5 animate-spin text-steel" />
              <span>Đang tải dữ liệu thùng rác...</span>
            </div>
          ) : activeTab === "items" ? (
            /* Tab Hạng mục đã xóa */
            deletedItems.length === 0 ? (
              <div className="py-12 text-center text-xs text-muted">
                Không có hạng mục nào trong thùng rác.
              </div>
            ) : (
              <div className="overflow-auto rounded-xl border border-line">
                <table className="w-full border-collapse text-[11px]">
                  <thead>
                    <tr className="bg-paper text-left text-muted font-bold border-b border-line">
                      <th className="p-2.5">Tên hạng mục</th>
                      <th className="p-2.5">Dự án</th>
                      <th className="p-2.5">Phòng ban</th>
                      <th className="p-2.5">Người xóa</th>
                      <th className="p-2.5 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {deletedItems.map((item) => (
                      <tr key={item.id} className="hover:bg-amber/5">
                        <td className="p-2.5 font-semibold text-ink">
                          {item.name}
                          {item.parent_id == null && (
                            <span className="ml-1.5 rounded bg-steel/15 px-1.5 py-0.5 text-[9px] text-steel uppercase font-extrabold">
                              Nhóm cha
                            </span>
                          )}
                        </td>
                        <td className="p-2.5 text-muted">
                          <span className="font-mono text-bad font-bold">{item.project_code}</span> - {item.project_name}
                        </td>
                        <td className="p-2.5 text-muted">{item.department || "—"}</td>
                        <td className="p-2.5 text-muted">
                          {item.deleted_by_name || "—"}
                          {item.deleted_at && (
                            <div className="text-[10px] text-muted/70">{formatDate(item.deleted_at)}</div>
                          )}
                        </td>
                        <td className="p-2.5 text-right">
                          <button
                            type="button"
                            disabled={restoringId === `item-${item.id}`}
                            onClick={() => handleRestoreItem(item)}
                            className="inline-flex items-center gap-1 rounded-lg bg-ok/15 px-2.5 py-1 text-xs font-bold text-ok hover:bg-ok hover:text-white transition-all shadow-sm disabled:opacity-50"
                          >
                            <ArrowPathIcon className={`h-3.5 w-3.5 ${restoringId === `item-${item.id}` ? "animate-spin" : ""}`} />
                            Khôi phục
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            /* Tab Dự án đã xóa */
            deletedProjects.length === 0 ? (
              <div className="py-12 text-center text-xs text-muted">
                Không có dự án nào trong thùng rác.
              </div>
            ) : (
              <div className="overflow-auto rounded-xl border border-line">
                <table className="w-full border-collapse text-[11px]">
                  <thead>
                    <tr className="bg-paper text-left text-muted font-bold border-b border-line">
                      <th className="p-2.5">Mã QL</th>
                      <th className="p-2.5">Tên dự án</th>
                      <th className="p-2.5">Nhóm / Phòng</th>
                      <th className="p-2.5">Người xóa</th>
                      <th className="p-2.5 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {deletedProjects.map((proj) => (
                      <tr key={proj.id} className="hover:bg-amber/5">
                        <td className="p-2.5 font-mono text-bad font-bold">{proj.code}</td>
                        <td className="p-2.5 font-semibold text-ink">{proj.name}</td>
                        <td className="p-2.5 text-muted">{proj.group_name || "—"}</td>
                        <td className="p-2.5 text-muted">
                          {proj.deleted_by_name || "—"}
                          {proj.deleted_at && (
                            <div className="text-[10px] text-muted/70">{formatDate(proj.deleted_at)}</div>
                          )}
                        </td>
                        <td className="p-2.5 text-right">
                          <button
                            type="button"
                            disabled={restoringId === `proj-${proj.id}`}
                            onClick={() => handleRestoreProject(proj)}
                            className="inline-flex items-center gap-1 rounded-lg bg-ok/15 px-2.5 py-1 text-xs font-bold text-ok hover:bg-ok hover:text-white transition-all shadow-sm disabled:opacity-50"
                          >
                            <ArrowPathIcon className={`h-3.5 w-3.5 ${restoringId === `proj-${proj.id}` ? "animate-spin" : ""}`} />
                            Khôi phục
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-line bg-paper px-5 py-3 text-right">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-line bg-white px-4 py-1.5 text-xs font-semibold text-ink hover:bg-paper"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
