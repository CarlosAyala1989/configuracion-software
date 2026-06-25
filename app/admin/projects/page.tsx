import { createProjectAction } from "@/app/actions/admin";
import { AppShell } from "@/components/AppShell";
import { EmptyState, Field, Panel, TextArea } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDate } from "@/lib/format";

export default async function AdminProjectsPage({
  searchParams
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const projects = await query<{
    id: number;
    title: string;
    methodology: string;
    start_date: string;
    end_date: string;
    status: string;
  }>("SELECT id, title, methodology, start_date, end_date, status FROM projects ORDER BY created_at DESC");

  return (
    <AppShell>
      {params.ok ? <div className="ok-banner">Proyecto actualizado.</div> : null}
      {params.error ? <div className="error-banner">Revisa los campos del proyecto.</div> : null}

      <Panel title="Crear proyecto" eyebrow="Proyecto">
        <form action={createProjectAction} className="form-grid">
          <Field label="Titulo" name="title" required />
          <Field label="Metodologia" name="methodology" required defaultValue="Agile / Scrum" />
          <Field label="Dia de inicio" name="start_date" type="date" required />
          <Field label="Dia de fin" name="end_date" type="date" required />
          <TextArea label="Descripcion" name="description" rows={3} />
          <div className="button-row field-wide">
            <button type="submit">Crear proyecto</button>
          </div>
        </form>
      </Panel>

      <Panel title="Proyectos">
        {projects.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Titulo</th>
                  <th>Metodologia</th>
                  <th>Inicio</th>
                  <th>Fin</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr key={project.id}>
                    <td>{project.title}</td>
                    <td>{project.methodology}</td>
                    <td>{formatDate(project.start_date)}</td>
                    <td>{formatDate(project.end_date)}</td>
                    <td>{project.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Sin proyectos">Crea un proyecto para asignar roles.</EmptyState>
        )}
      </Panel>
    </AppShell>
  );
}
