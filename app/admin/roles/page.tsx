import { createRoleAction } from "@/app/actions/admin";
import { AppShell } from "@/components/AppShell";
import { EmptyState, Field, Panel, SelectField, TextArea } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { getAllRoles } from "@/lib/roles";
import { PROJECT_ROLES, ROLE_LABELS, type ProjectRole } from "@/lib/types";

export default async function AdminRolesPage({
  searchParams
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const roles = await getAllRoles();
  const baseRoleOptions = PROJECT_ROLES.map((role) => ({ label: ROLE_LABELS[role], value: role }));

  return (
    <AppShell>
      {params.ok ? <div className="ok-banner">Rol creado correctamente.</div> : null}
      {params.error ? <div className="error-banner">Revisa el nombre, codigo o rol heredado.</div> : null}

      <Panel title="Crear rol" eyebrow="Herencia de vistas">
        <form action={createRoleAction} className="form-grid">
          <Field label="Nombre del rol" name="name" required placeholder="Analista QA Senior" />
          <Field label="Codigo" name="code" placeholder="ANALISTA_QA_SENIOR" />
          <SelectField label="Heredar vistas de" name="base_role" options={baseRoleOptions} />
          <TextArea label="Descripcion" name="description" rows={3} />
          <div className="button-row field-wide">
            <button type="submit">Crear rol</button>
          </div>
        </form>
      </Panel>

      <Panel title="Roles disponibles">
        {roles.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Rol</th>
                  <th>Codigo</th>
                  <th>Vista heredada</th>
                  <th>Tipo</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {roles.map((role) => (
                  <tr key={role.code}>
                    <td>
                      {role.name}
                      {role.description ? (
                        <>
                          <br />
                          <span className="muted">{role.description}</span>
                        </>
                      ) : null}
                    </td>
                    <td>{role.code}</td>
                    <td>{ROLE_LABELS[role.base_role as ProjectRole]}</td>
                    <td>{role.is_system ? "Predefinido" : "Personalizado"}</td>
                    <td>{role.active ? "Activo" : "Inactivo"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Sin roles">Ejecuta la inicializacion de base de datos.</EmptyState>
        )}
      </Panel>
    </AppShell>
  );
}
