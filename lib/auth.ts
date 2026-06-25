import "server-only";

import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { execute, query } from "@/lib/db";
import { parseRoleCapabilities } from "@/lib/roles";
import type { AuthUser, ProjectRole, ProjectSummary } from "@/lib/types";

const SESSION_DAYS = 7;

function cookieName() {
  return process.env.SESSION_COOKIE_NAME || "sgcs_session";
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: number) {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  await execute("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)", [
    tokenHash,
    userId,
    expiresAt
  ]);

  const store = await cookies();
  store.set(cookieName(), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt
  });
}

export async function destroySession() {
  const store = await cookies();
  const token = store.get(cookieName())?.value;
  if (token) {
    await execute("DELETE FROM sessions WHERE token_hash = ?", [hashToken(token)]);
  }
  store.delete(cookieName());
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const store = await cookies();
  const token = store.get(cookieName())?.value;
  if (!token) return null;

  const users = await query<AuthUser & { active: number }>(
    `SELECT u.id, u.name, u.email, u.is_admin, u.active
     FROM sessions s
     INNER JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > NOW() AND u.active = 1
     LIMIT 1`,
    [hashToken(token)]
  );

  if (!users[0]) return null;
  return {
    id: Number(users[0].id),
    name: users[0].name,
    email: users[0].email,
    is_admin: Boolean(users[0].is_admin)
  };
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (!user.is_admin) redirect("/dashboard");
  return user;
}

export async function getVisibleProjects(user: AuthUser) {
  if (user.is_admin) {
    return query<ProjectSummary>(
      `SELECT p.id, p.title, p.description, p.methodology, p.start_date, p.end_date, p.status,
              NULL AS role, NULL AS role_labels
       FROM projects p
       ORDER BY p.created_at DESC`
    );
  }

  return query<ProjectSummary>(
    `SELECT p.id, p.title, p.description, p.methodology, p.start_date, p.end_date, p.status,
            member_roles.role, member_roles.role_labels
     FROM projects p
     INNER JOIN (
       SELECT pm.project_id,
              GROUP_CONCAT(DISTINCT COALESCE(rd.base_role, pm.role) ORDER BY COALESCE(rd.base_role, pm.role) SEPARATOR ',') AS role,
              GROUP_CONCAT(DISTINCT COALESCE(rd.name, pm.role) ORDER BY COALESCE(rd.name, pm.role) SEPARATOR ', ') AS role_labels
       FROM project_members pm
       LEFT JOIN role_definitions rd ON rd.code = pm.role
       WHERE pm.user_id = ?
       GROUP BY pm.project_id
     ) member_roles ON member_roles.project_id = p.id
     ORDER BY p.created_at DESC`,
    [user.id]
  );
}

export async function getActiveProject(user: AuthUser) {
  const projects = await getVisibleProjects(user);
  if (projects.length === 0) return { project: null, projects, role: null as string | null };

  const store = await cookies();
  const selectedId = Number(store.get("sgcs_project")?.value || 0);
  const project = projects.find((item) => item.id === selectedId) || projects[0];

  let role = project.role;
  if (user.is_admin && !role) {
    const rows = await query<{ role: string | null; role_labels: string | null }>(
      `SELECT GROUP_CONCAT(DISTINCT COALESCE(rd.base_role, pm.role) ORDER BY COALESCE(rd.base_role, pm.role) SEPARATOR ',') AS role,
              GROUP_CONCAT(DISTINCT COALESCE(rd.name, pm.role) ORDER BY COALESCE(rd.name, pm.role) SEPARATOR ', ') AS role_labels
       FROM project_members pm
       LEFT JOIN role_definitions rd ON rd.code = pm.role
       WHERE pm.project_id = ? AND pm.user_id = ?`,
      [project.id, user.id]
    );
    role = rows[0]?.role ?? null;
    project.role = role;
    project.role_labels = rows[0]?.role_labels ?? null;
  }

  return { project, projects, role };
}

export async function setActiveProject(projectId: number, user: AuthUser) {
  const projects = await getVisibleProjects(user);
  if (!projects.some((project) => project.id === projectId)) return;

  const store = await cookies();
  store.set("sgcs_project", String(projectId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 90
  });
}

export function canUseRole(user: AuthUser, role: string | null, allowed: ProjectRole[]) {
  const capabilities = parseRoleCapabilities(role);
  return allowed.some((item) => capabilities.has(item));
}

export async function requireProjectRole(allowed: ProjectRole[]) {
  const user = await requireUser();
  const { project, role } = await getActiveProject(user);
  if (!project) redirect("/dashboard");
  if (!canUseRole(user, role, allowed)) redirect("/dashboard");
  return { user, project, role };
}
