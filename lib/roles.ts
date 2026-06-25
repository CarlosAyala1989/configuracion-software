import "server-only";

import { query } from "@/lib/db";
import { PROJECT_ROLES, ROLE_LABELS, type ProjectRole, type RoleDefinition } from "@/lib/types";

export function isBaseProjectRole(value: string): value is ProjectRole {
  return PROJECT_ROLES.includes(value as ProjectRole);
}

export function normalizeRoleCode(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase()
    .slice(0, 80);
}

export async function getActiveRoles() {
  return query<RoleDefinition>(
    `SELECT code, name, base_role, description, is_system, active
     FROM role_definitions
     WHERE active = 1
     ORDER BY is_system DESC, name`
  );
}

export async function getAllRoles() {
  return query<RoleDefinition>(
    `SELECT code, name, base_role, description, is_system, active
     FROM role_definitions
     ORDER BY is_system DESC, active DESC, name`
  );
}

export async function getRoleByCode(code: string) {
  const rows = await query<RoleDefinition>(
    `SELECT code, name, base_role, description, is_system, active
     FROM role_definitions
     WHERE code = ?
     LIMIT 1`,
    [code]
  );
  return rows[0] || null;
}

export async function getRoleOptions() {
  const roles = await getActiveRoles();
  return roles.map((role) => ({
    label: role.is_system ? ROLE_LABELS[role.base_role] : `${role.name} (${ROLE_LABELS[role.base_role]})`,
    value: role.code
  }));
}

export function parseRoleCapabilities(role: string | null | undefined) {
  return new Set(
    String(role || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );
}
