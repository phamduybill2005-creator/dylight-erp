// DOSCO担当 (phía Việt) = NGƯỜI CHỦ TRÌ dự án.
//
// Ô DOSCO担当 lưu dạng TEXT (dán từ Excel) nên phải dò ngược về tài khoản công ty.
// Logic ở đây PHẢI khớp `_resolve_dosco_lead` bên backend (app/routers/projects.py)
// để UI hiện đúng người mà backend sẽ chốt làm lead_id khi lưu.
import type { Project, User } from "@/lib/types";

/** Tìm tài khoản ứng với tên DOSCO担当: trùng khít trước, rồi mới trùng một phần. */
export function resolveDoscoLead<T extends { id: number; full_name: string }>(
  users: T[],
  doscoManager?: string | null,
): T | null {
  const name = (doscoManager || "").trim().toLowerCase();
  if (!name) return null;

  const exact = users.find((u) => (u.full_name || "").trim().toLowerCase() === name);
  if (exact) return exact;

  const partial = users.filter((u) => {
    const fn = (u.full_name || "").trim().toLowerCase();
    return !!fn && (name.includes(fn) || fn.includes(name));
  });
  // Nhiều người cùng khớp một phần -> mơ hồ, không đoán bừa (giống backend).
  return partial.length === 1 ? partial[0] : null;
}

/** Tên người chủ trì để hiển thị: ưu tiên DOSCO担当, thiếu thì lấy lead_name đã lưu. */
export function leadDisplayName(project: Project): string | null {
  const dosco = (project.dosco_manager || "").trim();
  if (dosco) return dosco;
  return (project.lead_name || "").trim() || null;
}

/** Người này có phải chủ trì dự án không (theo lead_id, fallback so tên DOSCO担当). */
export function isProjectLead(project: Project, user: Pick<User, "id" | "full_name">): boolean {
  if (project.lead_id != null) return project.lead_id === user.id;
  return resolveDoscoLead([user], project.dosco_manager)?.id === user.id;
}
