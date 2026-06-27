export const PROJECT_ROLES = [
  "SOLICITANTE",
  "JEFE_PROYECTO",
  "CCB",
  "LIDER_TECNICO",
  "DESARROLLADOR",
  "QA",
  "BIBLIOTECARIO"
] as const;

export type ProjectRole = (typeof PROJECT_ROLES)[number];

export type WorkItemType = "DEV" | "QA";

export const ROLE_LABELS: Record<ProjectRole, string> = {
  SOLICITANTE: "Solicitante",
  JEFE_PROYECTO: "Jefe de proyectos",
  CCB: "CCB",
  LIDER_TECNICO: "Lider tecnico",
  DESARROLLADOR: "Desarrollador",
  QA: "QA",
  BIBLIOTECARIO: "Bibliotecario"
};

export type RoleDefinition = {
  code: string;
  name: string;
  base_role: ProjectRole;
  description: string | null;
  is_system: boolean | number;
  active: boolean | number;
};

export function roleLabel(role: string | null | undefined, inheritedLabels?: string | null) {
  if (inheritedLabels) return inheritedLabels;
  if (!role) return "";
  return role
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => ROLE_LABELS[item as ProjectRole] || item)
    .join(", ");
}

export const CHANGE_STATUS_LABELS: Record<string, string> = {
  PM_REVIEW: "Revision del jefe de proyectos",
  REQUESTER_NEGOTIATION: "Negociacion con solicitante",
  CCB_REVIEW: "Revision CCB",
  CCB_APPROVED_TO_PM: "Aprobado por CCB, pendiente PM",
  TECH_LEAD_REQUIREMENTS: "Listo para backlog tecnico",
  DEV_IN_PROGRESS: "Desarrollo en progreso",
  QA_WAITING: "Esperando QA",
  QA_REJECTED_DEV_REWORK: "Dev corrigiendo observaciones QA",
  TECH_LEAD_REVIEW: "Revision del lider tecnico",
  PM_FINAL_REVIEW: "Revision final del jefe de proyectos",
  REQUESTER_VALIDATION: "Validacion del solicitante",
  CLOSED_APPROVED: "Cerrado aprobado"
};

export const WORK_STATUS_LABELS: Record<string, string> = {
  NEW: "Nuevo",
  ACTIVE: "Activo",
  COMPLETED: "Completado por desarrollo",
  BLOCKED: "Bloqueado",
  QA_READY: "Listo para QA",
  QA_ACTIVE: "QA en revision",
  QA_APPROVED: "QA aprobado",
  QA_REJECTED: "QA rechazado",
  DONE: "Cerrado"
};

export type AuthUser = {
  id: number;
  name: string;
  email: string;
  is_admin: boolean;
};

export type ProjectSummary = {
  id: number;
  title: string;
  description: string | null;
  methodology: string;
  start_date: string;
  end_date: string;
  status: string;
  role: string | null;
  role_labels?: string | null;
};

export type ChangeRequestRow = {
  id: number;
  change_code: string;
  project_id: number;
  request_number: number;
  delivery_id: number | null;
  requester_id: number;
  requester_name?: string;
  title: string;
  summary: string;
  business_reason: string;
  affected_area: string | null;
  priority: string;
  risk_level: string;
  budget_impact: string | null;
  requested_deadline: string | null;
  functional_scope: string | null;
  technical_context: string | null;
  acceptance_criteria: string | null;
  impact_analysis: string | null;
  rollback_plan: string | null;
  status: string;
  current_version: number;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkItemRow = {
  id: number;
  project_id: number;
  change_request_id: number;
  parent_work_item_id: number | null;
  type: WorkItemType;
  title: string;
  description: string;
  acceptance_criteria: string | null;
  definition_of_done: string | null;
  assigned_to: number | null;
  assignee_name?: string | null;
  change_code?: string;
  request_title?: string;
  status: string;
  priority: string;
  story_points: number | null;
  version: number;
  progress_percent: number;
  remaining_percent: number;
  github_branch: string | null;
  completed_at: string | null;
  created_by: number;
  created_at: string;
  updated_at: string;
};
