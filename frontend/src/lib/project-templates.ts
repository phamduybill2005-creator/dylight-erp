import { getProjectDept, normalizeDept } from "./groups";
import type { Project } from "./types";

type TemplateProject = Pick<Project, "id" | "name" | "code" | "group_name" | "lead_department" | "is_deleted">;

const sampleName = (name: string) => name.normalize("NFC").trim().toLocaleLowerCase("vi")
  .replace(/\s*[-–—]\s*/g, "-").replace(/\s+/g, " ");

/** The Bản đồ sample is the only source for that department; other departments
 * may reuse any of their existing projects. No group means no source options. */
export function projectTemplateOptions<T extends TemplateProject>(projects: T[], group: string): T[] {
  const department = normalizeDept(group);
  if (!department) return [];
  const sameDepartment = projects.filter(p => !p.is_deleted && getProjectDept(p) === department);
  if (department !== "Phòng Bản đồ") return sameDepartment;
  const sample = sameDepartment.find(p => sampleName(p.name) === "sample-phòng bản đồ");
  return sample ? [sample] : [];
}

/** Resolve both the select value and the submitted source from the same rules,
 * so a stale ID cannot copy items from a previously selected department. */
export function selectedProjectTemplateId(projects: TemplateProject[], group: string, selectedId: string): string {
  const options = projectTemplateOptions(projects, group);
  if (normalizeDept(group) === "Phòng Bản đồ") return options[0] ? String(options[0].id) : "";
  return options.some(p => String(p.id) === selectedId) ? selectedId : "";
}
