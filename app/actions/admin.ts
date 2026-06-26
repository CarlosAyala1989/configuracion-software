"use server";

import bcrypt from "bcryptjs";
import { ResultSetHeader } from "mysql2/promise";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAdmin } from "@/lib/auth";
import {
  configurationCodesFromForm,
  insertProjectConfigurationItems,
  methodologyForStorage,
  replaceProjectConfigurationItems,
  saveConfigurationTemplate
} from "@/lib/configuration-server";
import { execute, query, transaction } from "@/lib/db";
import { nullableText, numberValue, textValue } from "@/lib/forms";
import { getRoleByCode, isBaseProjectRole, normalizeRoleCode } from "@/lib/roles";

type TeamMemberInput = {
  userId: number;
  role: string;
};

function parseTeamMembers(formData: FormData) {
  const userIds = formData.getAll("member_user_id");
  const roles = formData.getAll("member_role");
  const byUser = new Map<number, TeamMemberInput>();

  userIds.forEach((rawUserId, index) => {
    const userId = Number(rawUserId);
    const role = typeof roles[index] === "string" ? roles[index].trim() : "";
    if (Number.isFinite(userId) && userId > 0 && role) {
      byUser.set(userId, { userId, role });
    }
  });

  return [...byUser.values()];
}

async function validateActiveRole(role: string) {
  const row = await getRoleByCode(role);
  return Boolean(row?.active);
}

async function validateActiveRoles(roles: string[]) {
  const uniqueRoles = [...new Set(roles)];
  if (uniqueRoles.length === 0) return false;

  for (const role of uniqueRoles) {
    if (!(await validateActiveRole(role))) return false;
  }

  return true;
}

export async function createUserAction(formData: FormData) {
  await requireAdmin();
  const name = textValue(formData, "name");
  const email = textValue(formData, "email").toLowerCase();
  const password = textValue(formData, "password");
  const isAdmin = formData.get("is_admin") === "on";

  if (!name || !email || password.length < 8) {
    redirect("/admin?error=user");
  }

  const hash = await bcrypt.hash(password, 12);
  await execute(
    "INSERT INTO users (name, email, password_hash, is_admin) VALUES (?, ?, ?, ?)",
    [name, email, hash, isAdmin ? 1 : 0]
  );

  revalidatePath("/admin/users");
  redirect("/admin/users?ok=user-created");
}

export async function createProjectAction(formData: FormData) {
  const admin = await requireAdmin();
  const title = textValue(formData, "title");
  const description = nullableText(formData, "description");
  const methodology = methodologyForStorage(textValue(formData, "methodology", "AGILE_SCRUM"));
  const startDate = textValue(formData, "start_date");
  const endDate = textValue(formData, "end_date");
  const configurationCodes = configurationCodesFromForm(formData);

  if (!title || !startDate || !endDate || configurationCodes.length === 0) {
    redirect("/admin/projects?error=project");
  }

  await transaction(async (connection) => {
    const [projectInsert] = await connection.execute<ResultSetHeader>(
      `INSERT INTO projects (title, description, methodology, start_date, end_date)
       VALUES (?, ?, ?, ?, ?)`,
      [title, description, methodology, startDate, endDate]
    );

    await insertProjectConfigurationItems(connection, projectInsert.insertId, methodology, configurationCodes);

    if (formData.get("save_template") === "on") {
      await saveConfigurationTemplate(connection, {
        name: textValue(formData, "template_name") || `${title} - ECS`,
        description: nullableText(formData, "template_description"),
        methodology,
        codes: configurationCodes,
        createdBy: admin.id
      });
    }
  });

  revalidatePath("/admin/projects");
  revalidatePath("/configuration");
  redirect("/admin/projects?ok=project-created");
}

export async function updateProjectAction(formData: FormData) {
  const admin = await requireAdmin();
  const projectId = numberValue(formData, "project_id");
  const title = textValue(formData, "title");
  const description = nullableText(formData, "description");
  const methodology = methodologyForStorage(textValue(formData, "methodology", "AGILE_SCRUM"));
  const startDate = textValue(formData, "start_date");
  const endDate = textValue(formData, "end_date");
  const configurationCodes = configurationCodesFromForm(formData);

  if (!projectId || !title || !startDate || !endDate || configurationCodes.length === 0) {
    redirect("/admin/projects?error=project");
  }

  const lockRows = await query<{ total: number }>(
    "SELECT COUNT(*) AS total FROM change_requests WHERE project_id = ?",
    [projectId]
  );
  if (Number(lockRows[0]?.total || 0) > 0) {
    redirect("/admin/projects?error=locked");
  }

  await transaction(async (connection) => {
    await connection.execute(
      `UPDATE projects
       SET title = ?, description = ?, methodology = ?, start_date = ?, end_date = ?
       WHERE id = ?`,
      [title, description, methodology, startDate, endDate, projectId]
    );
    await replaceProjectConfigurationItems(connection, projectId, methodology, configurationCodes);

    if (formData.get("save_template") === "on") {
      await saveConfigurationTemplate(connection, {
        name: textValue(formData, "template_name") || `${title} - ECS`,
        description: nullableText(formData, "template_description"),
        methodology,
        codes: configurationCodes,
        createdBy: admin.id
      });
    }
  });

  revalidatePath("/admin/projects");
  revalidatePath("/dashboard");
  revalidatePath("/configuration");
  redirect("/admin/projects?ok=project-updated");
}

export async function assignMemberAction(formData: FormData) {
  await requireAdmin();
  const projectId = numberValue(formData, "project_id");
  const userId = numberValue(formData, "user_id");
  const role = textValue(formData, "role");

  if (!projectId || !userId || !(await validateActiveRole(role))) {
    redirect("/admin/assignments?error=member");
  }

  await execute(
    `INSERT INTO project_members (project_id, user_id, role)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE role = VALUES(role)`,
    [projectId, userId, role]
  );

  revalidatePath("/admin/assignments");
  revalidatePath("/dashboard");
  redirect("/admin/assignments?ok=member-assigned");
}

export async function removeMemberAction(formData: FormData) {
  await requireAdmin();
  const membershipId = numberValue(formData, "membership_id");
  if (!membershipId) redirect("/admin/assignments?error=member");

  await execute("DELETE FROM project_members WHERE id = ?", [membershipId]);
  revalidatePath("/admin/assignments");
  revalidatePath("/dashboard");
  redirect("/admin/assignments?ok=member-removed");
}

export async function createRoleAction(formData: FormData) {
  await requireAdmin();
  const name = textValue(formData, "name");
  const code = normalizeRoleCode(textValue(formData, "code") || name);
  const baseRole = textValue(formData, "base_role");
  const description = nullableText(formData, "description");

  if (!name || !code || !isBaseProjectRole(baseRole)) redirect("/admin/roles?error=role");

  const existing = await getRoleByCode(code);
  if (existing) redirect("/admin/roles?error=duplicate");

  await execute(
    `INSERT INTO role_definitions (code, name, base_role, description, is_system, active)
     VALUES (?, ?, ?, ?, 0, 1)`,
    [code, name, baseRole, description]
  );

  revalidatePath("/admin/roles");
  revalidatePath("/admin/assignments");
  revalidatePath("/admin/teams");
  redirect("/admin/roles?ok=role-created");
}

export async function createTeamAction(formData: FormData) {
  const admin = await requireAdmin();
  const name = textValue(formData, "name");
  const description = nullableText(formData, "description");
  const members = parseTeamMembers(formData);

  if (!name || members.length === 0 || !(await validateActiveRoles(members.map((member) => member.role)))) {
    redirect("/admin/teams?error=team");
  }

  await transaction(async (connection) => {
    const [teamInsert] = await connection.execute<ResultSetHeader>(
      `INSERT INTO work_teams (name, description, created_by)
       VALUES (?, ?, ?)`,
      [name, description, admin.id]
    );

    for (const member of members) {
      await connection.execute(
        `INSERT INTO work_team_members (team_id, user_id, role)
         VALUES (?, ?, ?)`,
        [teamInsert.insertId, member.userId, member.role]
      );
    }
  });

  revalidatePath("/admin/teams");
  revalidatePath("/admin/assignments");
  redirect("/admin/teams?ok=team-created");
}

export async function updateTeamAction(formData: FormData) {
  await requireAdmin();
  const teamId = numberValue(formData, "team_id");
  const name = textValue(formData, "name");
  const description = nullableText(formData, "description");
  const members = parseTeamMembers(formData);

  if (!teamId || !name || members.length === 0 || !(await validateActiveRoles(members.map((member) => member.role)))) {
    redirect("/admin/teams?error=team");
  }

  await transaction(async (connection) => {
    await connection.execute(
      "UPDATE work_teams SET name = ?, description = ? WHERE id = ?",
      [name, description, teamId]
    );
    await connection.execute("DELETE FROM work_team_members WHERE team_id = ?", [teamId]);

    for (const member of members) {
      await connection.execute(
        `INSERT INTO work_team_members (team_id, user_id, role)
         VALUES (?, ?, ?)`,
        [teamId, member.userId, member.role]
      );
    }
  });

  revalidatePath("/admin/teams");
  revalidatePath("/admin/assignments");
  redirect("/admin/teams?ok=team-updated");
}

export async function deleteTeamAction(formData: FormData) {
  await requireAdmin();
  const teamId = numberValue(formData, "team_id");
  if (!teamId) redirect("/admin/teams?error=team");

  await execute("DELETE FROM work_teams WHERE id = ?", [teamId]);
  revalidatePath("/admin/teams");
  revalidatePath("/admin/assignments");
  redirect("/admin/teams?ok=team-deleted");
}

export async function applyTeamToProjectAction(formData: FormData) {
  await requireAdmin();
  const projectId = numberValue(formData, "project_id");
  const teamId = numberValue(formData, "team_id");
  if (!projectId || !teamId) redirect("/admin/assignments?error=team");

  const members = await query<TeamMemberInput>(
    `SELECT user_id AS userId, role
     FROM work_team_members
     WHERE team_id = ?`,
    [teamId]
  );
  if (members.length === 0 || !(await validateActiveRoles(members.map((member) => member.role)))) {
    redirect("/admin/assignments?error=team");
  }

  await transaction(async (connection) => {
    for (const member of members) {
      await connection.execute(
        `INSERT INTO project_members (project_id, user_id, role)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE role = VALUES(role)`,
        [projectId, member.userId, member.role]
      );
    }
  });

  revalidatePath("/admin/assignments");
  revalidatePath("/dashboard");
  redirect("/admin/assignments?ok=team-applied");
}

export async function toggleUserAction(formData: FormData) {
  await requireAdmin();
  const userId = numberValue(formData, "user_id");
  const active = numberValue(formData, "active");
  if (!userId) redirect("/admin/users?error=user");

  await execute("UPDATE users SET active = ? WHERE id = ?", [active ? 1 : 0, userId]);
  revalidatePath("/admin/users");
  redirect("/admin/users?ok=user-updated");
}
