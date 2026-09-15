import type { Project, User } from "./types";

/** Dự án đang tham gia trực tiếp; quyền xem theo phòng ban/cấp quản lý không phải phân công. */
export function personalProjects(projects: Project[], user: Pick<User, "id" | "company_id">): Project[] {
  return projects.filter((project) =>
    project.company_id === user.company_id &&
    !project.is_deleted &&
    project.status !== "COMPLETED" &&
    project.status !== "CLOSED" &&
    (project.lead_id === user.id || project.members?.some((member) => member.id === user.id)),
  );
}
