export interface ProjectDetailEditValues {
  memberIds: number[];
  leadId: number | null;
  name: string;
  code: string;
  existingCode: string;
  startDate: string;
  endDate: string;
  internalDeadline: string;
  geoManager: string;
  doscoManager: string;
  groupName: string;
  evaluation: string;
}

export function buildProjectDetailUpdatePayload(values: ProjectDetailEditValues) {
  return {
    member_ids: values.memberIds,
    lead_id: values.leadId,
    name: values.name.trim(),
    code: values.code.trim() || values.existingCode,
    start_date: values.startDate || null,
    end_date: values.endDate || null,
    internal_deadline: values.internalDeadline || null,
    geo_manager: values.geoManager.trim() || null,
    dosco_manager: values.doscoManager.trim() || null,
    group_name: values.groupName.trim() || null,
    evaluation: values.evaluation.trim() || null,
  };
}
