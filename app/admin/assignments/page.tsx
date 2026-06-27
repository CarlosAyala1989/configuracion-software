import {
  applyTeamToProjectAction,
  assignMemberAction,
  removeMemberAction
} from "@/app/actions/admin";
import { AppShell } from "@/components/AppShell";
import { EmptyState, Panel, SelectField } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { getRoleOptions } from "@/lib/roles";
import { ROLE_LABELS, type ProjectRole } from "@/lib/types";

export default async function AdminAssignmentsPage({
  searchParams
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;

  const [users, projects, memberships, roleOptions, teams] = await Promise.all([
    query<{ id: number; name: string; email: string; active: number }>(
      "SELECT id, name, email, active FROM users ORDER BY name"
    ),
    query<{ id: number; title: string }>("SELECT id, title FROM projects ORDER BY title"),
    query<{
      id: number;
      project_title: string;
      user_name: string;
      email: string;
      role: string;
      role_name: string | null;
      base_role: ProjectRole | null;
      created_at: string;
    }>(
      `SELECT pm.id, p.title AS project_title, u.name AS user_name, u.email, pm.role,
              rd.name AS role_name, rd.base_role, pm.created_at
       FROM project_members pm
       INNER JOIN projects p ON p.id = pm.project_id
       INNER JOIN users u ON u.id = pm.user_id
       LEFT JOIN role_definitions rd ON rd.code = pm.role
       ORDER BY p.title, COALESCE(rd.base_role, pm.role), u.name`
    ),
    getRoleOptions(),
    query<{ id: number; name: string }>("SELECT id, name FROM work_teams ORDER BY name")
  ]);

  const userOptions = users
    .filter((user) => user.active)
    .map((user) => ({ label: `${user.name} · ${user.email}`, value: user.id }));
  const projectOptions = projects.map((project) => ({ label: project.title, value: project.id }));
  const teamOptions = teams.map((team) => ({ label: team.name, value: team.id }));

  return (
    <AppShell showProjectHeader={false}>
      {params.ok ? <div className="ok-banner">Asignaciones actualizadas.</div> : null}
      {params.error ? <div className="error-banner">Revisa los datos de asignacion.</div> : null}

      <section className="grid grid-2">
        <Panel title="Asignar usuario a proyecto" eyebrow="Roles por proyecto">
          {users.length && projects.length && roleOptions.length ? (
            <form action={assignMemberAction} className="form-grid">
              <SelectField label="Proyecto" name="project_id" options={projectOptions} />
              <SelectField label="Usuario" name="user_id" options={userOptions} />
              <SelectField label="Rol en este proyecto" name="role" options={roleOptions} />
              <div className="button-row field-wide">
                <button type="submit">Asignar rol</button>
              </div>
            </form>
          ) : (
            <EmptyState title="Faltan datos">Crea usuarios, proyectos y roles activos.</EmptyState>
          )}
        </Panel>

        <Panel title="Asignar equipo a proyecto" eyebrow="Equipo reutilizable">
          {projects.length && teams.length ? (
            <form action={applyTeamToProjectAction} className="form-grid">
              <SelectField label="Proyecto" name="project_id" options={projectOptions} />
              <SelectField label="Equipo de trabajo" name="team_id" options={teamOptions} />
              <div className="button-row field-wide">
                <button type="submit">Asignar equipo</button>
              </div>
            </form>
          ) : (
            <EmptyState title="Faltan datos">Crea un proyecto y un equipo de trabajo.</EmptyState>
          )}
        </Panel>
      </section>

      <Panel title="Asignaciones actuales">
        {memberships.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Proyecto</th>
                  <th>Usuario</th>
                  <th>Rol</th>
                  <th>Vista heredada</th>
                  <th>Accion</th>
                </tr>
              </thead>
              <tbody>
                {memberships.map((member) => (
                  <tr key={member.id}>
                    <td>{member.project_title}</td>
                    <td>
                      {member.user_name}
                      <br />
                      <span className="muted">{member.email}</span>
                    </td>
                    <td>{member.role_name || member.role}</td>
                    <td>{member.base_role ? ROLE_LABELS[member.base_role] : member.role}</td>
                    <td>
                      <form action={removeMemberAction}>
                        <input type="hidden" name="membership_id" value={member.id} />
                        <button className="button-danger" type="submit">
                          Quitar
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Sin asignaciones">Asigna roles o aplica un equipo reutilizable.</EmptyState>
        )}
      </Panel>
    </AppShell>
  );
}
