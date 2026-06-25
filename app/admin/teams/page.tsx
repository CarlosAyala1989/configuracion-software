import { TeamManager } from "@/components/admin/TeamForm";
import { AppShell } from "@/components/AppShell";
import { Panel } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { getRoleOptions } from "@/lib/roles";
import { ROLE_LABELS, type ProjectRole } from "@/lib/types";

export default async function AdminTeamsPage({
  searchParams
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;

  const [users, roleOptions, teams, members] = await Promise.all([
    query<{ id: number; name: string; email: string }>(
      "SELECT id, name, email FROM users WHERE active = 1 ORDER BY name"
    ),
    getRoleOptions(),
    query<{ id: number; name: string; description: string | null }>(
      "SELECT id, name, description FROM work_teams ORDER BY name"
    ),
    query<{
      id: number;
      team_id: number;
      user_id: number;
      role: string;
      user_name: string;
      email: string;
      role_name: string | null;
      base_role: ProjectRole | null;
    }>(
      `SELECT wtm.id, wtm.team_id, wtm.user_id, wtm.role, u.name AS user_name, u.email,
              rd.name AS role_name, rd.base_role
       FROM work_team_members wtm
       INNER JOIN users u ON u.id = wtm.user_id
       LEFT JOIN role_definitions rd ON rd.code = wtm.role
       ORDER BY u.name`
    )
  ]);

  const userOptions = users.map((user) => ({ label: `${user.name} · ${user.email}`, value: user.id }));
  const serializedTeams = teams.map((team) => ({
    ...team,
    members: members
      .filter((member) => member.team_id === team.id)
      .map((member) => ({
        id: member.id,
        user_id: member.user_id,
        role: member.role,
        user_name: member.user_name,
        email: member.email,
        role_name: member.role_name || member.role,
        base_role_label: member.base_role ? ROLE_LABELS[member.base_role] : member.role
      }))
  }));

  return (
    <AppShell>
      {params.ok ? <div className="ok-banner">Equipo de trabajo actualizado.</div> : null}
      {params.error ? <div className="error-banner">Revisa el nombre, usuarios y roles del equipo.</div> : null}

      <Panel title="Equipos de Trabajo" eyebrow="Administrador">
        <TeamManager users={userOptions} roleOptions={roleOptions} teams={serializedTeams} />
      </Panel>
    </AppShell>
  );
}
