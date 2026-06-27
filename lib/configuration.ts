import configurationData from "@/lib/configuration-data.json";

export type MethodologyCode = "RUP" | "AGILE_SCRUM";

export type ConfigurationItemDefinition = {
  code: string;
  name: string;
  category: string;
  methodologies: MethodologyCode[];
  description: string;
};

export type ConfigurationRelationDefinition = {
  methodologies: MethodologyCode[];
  source: string;
  target: string;
  relationType: string;
  required: boolean;
  rationale: string;
};

export type MethodologyOption = {
  code: MethodologyCode;
  label: string;
};

export const METHODOLOGY_OPTIONS = configurationData.methodologies as MethodologyOption[];
export const CONFIGURATION_ITEMS = configurationData.items as ConfigurationItemDefinition[];
export const CONFIGURATION_RELATIONS = configurationData.relations as ConfigurationRelationDefinition[];

export const DEVELOPER_CONFIGURATION_CODES = [
  "SOURCE_CODE",
  "OBJECT_EXECUTABLES",
  "AUTOMATION_SCRIPTS",
  "THIRD_PARTY_LIBRARIES",
  "SAD",
  "UML_MODELS",
  "DB_DESIGN_MODEL",
  "TECHNICAL_DOCUMENTATION",
  "DATA_DICTIONARY",
  "INSTALLATION_MANUAL",
  "ADR",
  "RELEASE_INCREMENT",
  "CONFIG_FILES",
  "DB_SCHEMA",
  "BUILD_SCRIPTS",
  "IAC",
  "CI_CD_PIPELINES",
  "AUDIT_LOGS"
] as const;

export const QA_CONFIGURATION_CODES = [
  "TRACEABILITY_MATRIX",
  "QA_EVIDENCE",
  "TEST_DATA",
  "TEST_CASES",
  "AUTOMATED_TESTS",
  "DEFECT_REPORTS"
] as const;

export function isDeveloperConfigurationCode(code: string) {
  return (DEVELOPER_CONFIGURATION_CODES as readonly string[]).includes(code);
}

export function isQaConfigurationCode(code: string) {
  return (QA_CONFIGURATION_CODES as readonly string[]).includes(code);
}

export const CONFIGURATION_IMPACT_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pendiente",
  CHANGED: "Cambiado",
  NO_CHANGE: "Sin cambio requerido"
};

export const CONFIGURATION_IMPACT_TYPE_LABELS: Record<string, string> = {
  DIRECT: "Cambio directo",
  RELATED: "Relacionado"
};

export function normalizeMethodology(value: string | null | undefined): MethodologyCode {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("rup")) return "RUP";
  return "AGILE_SCRUM";
}

export function methodologyLabel(value: string | null | undefined) {
  const code = normalizeMethodology(value);
  return METHODOLOGY_OPTIONS.find((item) => item.code === code)?.label || "Agile / Scrum";
}

export function getConfigurationItemsForMethodology(value: string | null | undefined) {
  const code = normalizeMethodology(value);
  return CONFIGURATION_ITEMS.filter((item) => item.methodologies.includes(code));
}

export function getConfigurationRelationsForMethodology(value: string | null | undefined) {
  const code = normalizeMethodology(value);
  return CONFIGURATION_RELATIONS.filter((item) => item.methodologies.includes(code));
}

export function getConfigurationItemDefinition(code: string) {
  return CONFIGURATION_ITEMS.find((item) => item.code === code);
}

export function getConfigurationItemMap() {
  return new Map(CONFIGURATION_ITEMS.map((item) => [item.code, item]));
}

export function getDefaultConfigurationCodes(value: string | null | undefined) {
  return getConfigurationItemsForMethodology(value).map((item) => item.code);
}
