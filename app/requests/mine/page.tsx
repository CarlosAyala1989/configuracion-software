import Link from "next/link";

import { AppShell } from "@/components/AppShell";
import { EmptyState, Panel, PriorityBadge, RequestLink, StatusBadge } from "@/components/ui";
import { canUseRole, getActiveProject, requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDateTime, formatMoney } from "@/lib/format";
import type { ChangeRequestRow } from "@/lib/types";

export default async function MyRequestsPage({
  searchParams
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const user = await requireUser();
  const { project, role } = await getActiveProject(user);
  const params = await searchParams;

  if (!project) {
    return (
      <AppShell>
        <EmptyState title="Sin proyecto activo">No hay proyectos disponibles para revisar solicitudes.</EmptyState>
      </AppShell>
    );
  }

  const canRequest = canUseRole(user, role, ["SOLICITANTE"]);
  if (!canRequest) {
    return (
      <AppShell>
        <EmptyState title="Sin permisos">Tu rol no permite ver solicitudes como solicitante.</EmptyState>
      </AppShell>
    );
  }

  const requests = await query<ChangeRequestRow>(
    `SELECT cr.*, u.name AS requester_name
     FROM change_requests cr
     INNER JOIN users u ON u.id = cr.requester_id
     WHERE cr.project_id = ? AND cr.requester_id = ?
     ORDER BY cr.updated_at DESC`,
    [project.id, user.id]
  );

  return (
    <AppShell>
      {params.ok ? <div className="ok-banner">Solicitud enviada correctamente.</div> : null}
      {params.error ? <div className="error-banner">No se pudo completar la operacion.</div> : null}

      <Panel title="Mis solicitudes" eyebrow="Backlog de cambios">
        {requests.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Solicitud</th>
                  <th>Estado</th>
                  <th>Prioridad</th>
                  <th>Riesgo</th>
                  <th>Presupuesto</th>
                  <th>Version</th>
                  <th>Actualizacion</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => (
                  <tr key={request.id}>
                    <td>
                      <RequestLink id={request.id} code={request.change_code} title={request.title} />
                    </td>
                    <td>
                      <StatusBadge status={request.status} compact />
                    </td>
                    <td>
                      <PriorityBadge value={request.priority} />
                    </td>
                    <td>
                      <PriorityBadge value={request.risk_level} />
                    </td>
                    <td>{formatMoney(request.budget_impact)}</td>
                    <td>V{request.current_version}</td>
                    <td>{formatDateTime(request.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Sin solicitudes">Crea la primera solicitud para iniciar el flujo.</EmptyState>
        )}
      </Panel>

      <div className="button-row">
        <Link className="button" href="/requests">
          Crear solicitud
        </Link>
        <Link className="button button-secondary" href="/dashboard">
          Volver al dashboard
        </Link>
      </div>
    </AppShell>
  );
}
