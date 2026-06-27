import { createUserAction, toggleUserAction } from "@/app/actions/admin";
import { AppShell } from "@/components/AppShell";
import { EmptyState, Field, Panel } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";

export default async function AdminUsersPage({
  searchParams
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const users = await query<{
    id: number;
    name: string;
    email: string;
    is_admin: number;
    active: number;
    created_at: string;
  }>("SELECT id, name, email, is_admin, active, created_at FROM users ORDER BY created_at DESC");

  return (
    <AppShell showProjectHeader={false}>
      {params.ok ? <div className="ok-banner">Usuario actualizado.</div> : null}
      {params.error ? <div className="error-banner">Revisa los campos del usuario.</div> : null}

      <Panel title="Crear usuario" eyebrow="Administrador">
        <form action={createUserAction} className="form-grid">
          <Field label="Nombre completo" name="name" required />
          <Field label="Correo" name="email" type="email" required />
          <Field label="Contrasena temporal" name="password" type="password" required />
          <label className="field checkbox-field">
            <input name="is_admin" type="checkbox" />
            <span>Administrador global</span>
          </label>
          <div className="button-row field-wide">
            <button type="submit">Crear usuario</button>
          </div>
        </form>
      </Panel>

      <Panel title="Usuarios">
        {users.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Correo</th>
                  <th>Admin</th>
                  <th>Activo</th>
                  <th>Accion</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>{user.name}</td>
                    <td>{user.email}</td>
                    <td>{user.is_admin ? "Si" : "No"}</td>
                    <td>{user.active ? "Si" : "No"}</td>
                    <td>
                      <form action={toggleUserAction}>
                        <input type="hidden" name="user_id" value={user.id} />
                        <input type="hidden" name="active" value={user.active ? 0 : 1} />
                        <button className="button-secondary" type="submit">
                          {user.active ? "Desactivar" : "Activar"}
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Sin usuarios">Crea el primer usuario operativo.</EmptyState>
        )}
      </Panel>
    </AppShell>
  );
}
