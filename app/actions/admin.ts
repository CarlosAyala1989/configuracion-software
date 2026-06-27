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
import { buildDeliveryPeriods, parseDeliveryCadence } from "@/lib/deliveries";
import { replaceProjectDeliveryPlan } from "@/lib/deliveries-server";
import { nullableText, numberValue, textValue } from "@/lib/forms";
import {
  createGithubRepository,
  encryptGithubToken,
  getGithubAuthenticatedUser,
  githubErrorParam,
  normalizeGithubRepositoryName
} from "@/lib/github";
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

export async function loadGithubTokenOwnerAction(token: string) {
  await requireAdmin();
  if (!token.trim()) return { ok: false as const, error: "invalid-token" };
  try {
    const owner = await getGithubAuthenticatedUser({ token: token.trim() });
    return { ok: true as const, owner };
  } catch (error) {
    return { ok: false as const, error: githubErrorParam(error) };
  }
}

export async function createProjectAction(formData: FormData) {
  const admin = await requireAdmin();
  const title = textValue(formData, "title");
  const description = nullableText(formData, "description");
  const methodology = methodologyForStorage(textValue(formData, "methodology", "AGILE_SCRUM"));
  const startDate = textValue(formData, "start_date");
  const endDate = textValue(formData, "end_date");
  const configurationCodes = configurationCodesFromForm(formData);
  const createDeliveryPlan = formData.get("create_delivery_plan") === "on";
  const deliveryCadence = parseDeliveryCadence(textValue(formData, "delivery_cadence"));
  const githubEnabled = formData.get("github_enabled") === "on";
  const githubToken = textValue(formData, "github_token");
  let githubOwnerLogin: string | null = null;
  let githubRepository: string | null = null;
  let githubDevelopmentBranch: string | null = null;
  let githubTokenEncrypted: string | null = null;

  if (
    !title ||
    buildDeliveryPeriods(startDate, endDate, "DAY").length === 0 ||
    configurationCodes.length === 0 ||
    (createDeliveryPlan && !deliveryCadence)
  ) {
    redirect("/admin/projects?error=project");
  }

  if (githubEnabled) {
    try {
      if (!githubToken) throw new Error("Falta token GitHub");
      const repositoryName = normalizeGithubRepositoryName(textValue(formData, "github_repository_name"));
      const created = await createGithubRepository({
        name: repositoryName,
        description: title,
        token: githubToken
      });
      githubOwnerLogin = created.owner.login;
      githubRepository = created.repository;
      githubDevelopmentBranch = created.developmentBranch;
      githubTokenEncrypted = encryptGithubToken(githubToken);
    } catch (error) {
      redirect(`/admin/projects?error=${githubErrorParam(error)}`);
    }
  }

  await transaction(async (connection) => {
    const [projectInsert] = await connection.execute<ResultSetHeader>(
      `INSERT INTO projects
       (title, description, methodology, start_date, end_date,
        github_owner_login, github_repository, github_development_branch, github_token_encrypted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title,
        description,
        methodology,
        startDate,
        endDate,
        githubOwnerLogin,
        githubRepository,
        githubDevelopmentBranch,
        githubTokenEncrypted
      ]
    );

    await insertProjectConfigurationItems(connection, projectInsert.insertId, methodology, configurationCodes);
    if (createDeliveryPlan && deliveryCadence) {
      await replaceProjectDeliveryPlan(connection, {
        projectId: projectInsert.insertId,
        startDate,
        endDate,
        cadence: deliveryCadence,
        createdBy: admin.id
      });
    }

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
  const createDeliveryPlan = formData.get("create_delivery_plan") === "on";
  const deliveryCadence = parseDeliveryCadence(textValue(formData, "delivery_cadence"));

  if (
    !projectId ||
    !title ||
    buildDeliveryPeriods(startDate, endDate, "DAY").length === 0 ||
    configurationCodes.length === 0 ||
    (createDeliveryPlan && !deliveryCadence)
  ) {
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
    if (createDeliveryPlan && deliveryCadence) {
      await replaceProjectDeliveryPlan(connection, {
        projectId,
        startDate,
        endDate,
        cadence: deliveryCadence,
        createdBy: admin.id
      });
    } else {
      await connection.execute("DELETE FROM project_delivery_plans WHERE project_id = ?", [projectId]);
    }

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
  revalidatePath("/tech-lead/backlog");
  revalidatePath("/tech-lead/release");
  revalidatePath("/tech-lead/work-items");
  redirect("/admin/projects?ok=project-updated");
}

export async function updateProjectGithubAction(formData: FormData) {
  await requireAdmin();
  const projectId = numberValue(formData, "project_id");
  const enabled = formData.get("github_enabled") === "on";
  if (!projectId) redirect("/admin/projects?error=project");

  if (!enabled) {
    await execute(
      `UPDATE projects
       SET github_owner_login = NULL,
           github_repository = NULL,
           github_development_branch = NULL,
           github_token_encrypted = NULL
       WHERE id = ?`,
      [projectId]
    );
    revalidatePath("/admin/projects");
    revalidatePath("/developer");
    revalidatePath("/qa");
    redirect("/admin/projects?ok=github-disabled");
  }

  const rows = await query<{ github_repository: string | null }>(
    "SELECT github_repository FROM projects WHERE id = ? LIMIT 1",
    [projectId]
  );
  if (!rows[0]) redirect("/admin/projects?error=project");

  const replaceIntegration = formData.get("replace_github_integration") === "on" || !rows[0].github_repository;
  if (replaceIntegration) {
    try {
      const token = textValue(formData, "github_token");
      if (!token) throw new Error("Falta token GitHub");
      const repositoryName = normalizeGithubRepositoryName(textValue(formData, "github_repository_name"));
      const created = await createGithubRepository({
        name: repositoryName,
        description: textValue(formData, "project_title"),
        token
      });
      const encryptedToken = encryptGithubToken(token);
      await execute(
        `UPDATE projects
         SET github_owner_login = ?, github_repository = ?,
             github_development_branch = ?, github_token_encrypted = ?
         WHERE id = ?`,
        [
          created.owner.login,
          created.repository,
          created.developmentBranch,
          encryptedToken,
          projectId
        ]
      );
    } catch (error) {
      redirect(`/admin/projects?error=${githubErrorParam(error)}`);
    }
  }

  revalidatePath("/admin/projects");
  revalidatePath("/developer");
  revalidatePath("/qa");
  redirect("/admin/projects?ok=github-updated");
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
