import Link from "next/link";

import { AppShell } from "@/components/AppShell";
import { EmptyState, Panel, ProgressBar, RequestLink, StatusBadge } from "@/components/ui";
import { getActiveProject, requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

export default async function DashboardPage() {
  const user = await requireUser();
  const { project } = await getActiveProject(user);

  if (!project) {
    return (
      <AppShell>
        <EmptyState title="No hay proyecto activo">
          {user.is_admin ? (
            <Link className="button" href="/admin/projects">
              Crear proyecto
            </Link>
          ) : (
            "Solicita al administrador que te asigne a un proyecto."
          )}
        </EmptyState>
      </AppShell>
    );
  }

  const [requestCounts, workCounts, hoursRows, progressRows, latestRequests, latestUpdates] =
    await Promise.all([
      query<{ status: string; total: number }>(
        "SELECT status, COUNT(*) AS total FROM change_requests WHERE project_id = ? GROUP BY status",
        [project.id]
      ),
      query<{ type: string; status: string; total: number }>(
        "SELECT type, status, COUNT(*) AS total FROM work_items WHERE project_id = ? GROUP BY type, status",
        [project.id]
      ),
      query<{ total_hours: string | null }>(
        `SELECT SUM(wu.hours_spent) AS total_hours
         FROM work_item_updates wu
         INNER JOIN work_items wi ON wi.id = wu.work_item_id
         WHERE wi.project_id = ?`,
        [project.id]
      ),
      query<{ avg_progress: string | null; avg_remaining: string | null }>(
        `SELECT AVG(progress_percent) AS avg_progress, AVG(remaining_percent) AS avg_remaining
         FROM work_items
         WHERE project_id = ? AND type = 'DEV'`,
        [project.id]
      ),
      query<{
        id: number;
        change_code: string;
        title: string;
        status: string;
        requester_name: string;
        updated_at: string;
      }>(
        `SELECT cr.id, cr.change_code, cr.title, cr.status, u.name AS requester_name, cr.updated_at
         FROM change_requests cr
         INNER JOIN users u ON u.id = cr.requester_id
         WHERE cr.project_id = ?
         ORDER BY cr.updated_at DESC
         LIMIT 8`,
        [project.id]
      ),
      query<{
        id: number;
        work_item_id: number;
        title: string;
        user_name: string;
        hours_spent: string;
        progress_percent: number;
        created_at: string;
      }>(
        `SELECT wu.id, wi.id AS work_item_id, wi.title, u.name AS user_name,
                wu.hours_spent, wu.progress_percent, wu.created_at
         FROM work_item_updates wu
         INNER JOIN work_items wi ON wi.id = wu.work_item_id
         INNER JOIN users u ON u.id = wu.user_id
         WHERE wi.project_id = ?
         ORDER BY wu.created_at DESC
         LIMIT 8`,
        [project.id]
      )
    ]);

  const totalRequests = requestCounts.reduce((sum, item) => sum + Number(item.total), 0);
  const closed = requestCounts
    .filter((item) => item.status === "CLOSED_APPROVED")
    .reduce((sum, item) => sum + Number(item.total), 0);
  const devCards = workCounts
    .filter((item) => item.type === "DEV")
    .reduce((sum, item) => sum + Number(item.total), 0);
  const qaReady = workCounts
    .filter((item) => item.type === "QA" && ["QA_READY", "QA_ACTIVE"].includes(item.status))
    .reduce((sum, item) => sum + Number(item.total), 0);
  const totalHours = Number(hoursRows[0]?.total_hours || 0);
  const avgProgress = Math.round(Number(progressRows[0]?.avg_progress || 0));

  return (
    <AppShell>
      <section className="grid grid-4">
        <div className="metric">
          <span>Solicitudes</span>
          <strong>{totalRequests}</strong>
        </div>
        <div className="metric">
          <span>Cerradas</span>
          <strong>{closed}</strong>
        </div>
        <div className="metric">
          <span>Tarjetas DEV</span>
          <strong>{devCards}</strong>
        </div>
        <div className="metric">
          <span>Horas reportadas</span>
          <strong>{totalHours.toFixed(1)}</strong>
        </div>
      </section>

      <section className="grid grid-2">
        <Panel title="Avance de desarrollo" eyebrow="Backlog">
          <div className="detail-list">
            <div className="detail-item">
              <span>Promedio completado</span>
              <strong>{avgProgress}%</strong>
              <ProgressBar value={avgProgress} />
            </div>
            <div className="detail-item">
              <span>Listas para QA</span>
              <strong>{qaReady}</strong>
            </div>
          </div>
        </Panel>

        <Panel title="Estados de solicitudes" eyebrow="Trazabilidad">
          {requestCounts.length ? (
            <div className="grid">
              {requestCounts.map((item) => (
                <div className="detail-item" key={item.status}>
                  <span>{Number(item.total)} solicitudes</span>
                  <StatusBadge status={item.status} compact />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="Sin solicitudes">Las solicitudes apareceran aqui.</EmptyState>
          )}
        </Panel>
      </section>

      <Panel title="Solicitudes recientes">
        {latestRequests.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Solicitud</th>
                  <th>Solicitante</th>
                  <th>Estado</th>
                  <th>Actualizacion</th>
                </tr>
              </thead>
              <tbody>
                {latestRequests.map((request) => (
                  <tr key={request.id}>
                    <td>
                      <RequestLink id={request.id} code={request.change_code} title={request.title} />
                    </td>
                    <td>{request.requester_name}</td>
                    <td>
                      <StatusBadge status={request.status} compact />
                    </td>
                    <td>{formatDateTime(request.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Sin actividad">Aun no se han registrado solicitudes.</EmptyState>
        )}
      </Panel>

      <Panel title="Ultimos avances reportados">
        {latestUpdates.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tarjeta</th>
                  <th>Usuario</th>
                  <th>Horas</th>
                  <th>Avance</th>
                  <th>Registro</th>
                </tr>
              </thead>
              <tbody>
                {latestUpdates.map((update) => (
                  <tr key={update.id}>
                    <td>#{update.work_item_id} {update.title}</td>
                    <td>{update.user_name}</td>
                    <td>{Number(update.hours_spent).toFixed(1)}</td>
                    <td>
                      <ProgressBar value={update.progress_percent} />
                    </td>
                    <td>{formatDateTime(update.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Sin avances">El equipo aun no registra horas.</EmptyState>
        )}
      </Panel>
    </AppShell>
  );
}
