import Link from "next/link";

import { pmDecisionAction } from "@/app/actions/requests";
import { AppShell } from "@/components/AppShell";
import { EmptyState, Panel, PriorityBadge, RequestLink, StatusBadge, TextArea } from "@/components/ui";
import { requireProjectRole } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDateTime, formatMoney } from "@/lib/format";
import type { ChangeRequestRow } from "@/lib/types";

export default async function ProjectManagerPage({
  searchParams
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { project } = await requireProjectRole(["JEFE_PROYECTO"]);
  const params = await searchParams;

  const pending = await query<ChangeRequestRow>(
    `SELECT cr.*, u.name AS requester_name
     FROM change_requests cr
     INNER JOIN users u ON u.id = cr.requester_id
     WHERE cr.project_id = ? AND cr.status IN ('PM_REVIEW','CCB_APPROVED_TO_PM')
     ORDER BY cr.updated_at ASC`,
    [project.id]
  );

  return (
    <AppShell>
      {params.ok ? <div className="ok-banner">Decision registrada correctamente.</div> : null}
      {params.error ? <div className="error-banner">El rechazo necesita una explicacion.</div> : null}

      <Panel id="revision-solicitudes" title="Revision de solicitudes" eyebrow="Jefe de Proyectos">
        {pending.length ? (
          <div className="grid grid-2">
            {pending.map((request) => (
              <article className="work-card" key={request.id}>
                <header>
                  <div>
                    <RequestLink id={request.id} code={request.change_code} title={request.title} />
                    <p className="muted">
                      {request.requester_name} · V{request.current_version} · {formatDateTime(request.updated_at)}
                    </p>
                  </div>
                  <StatusBadge status={request.status} compact />
                </header>
                <div className="detail-list">
                  <div className="detail-item">
                    <span>Prioridad</span>
                    <PriorityBadge value={request.priority} />
                  </div>
                  <div className="detail-item">
                    <span>Riesgo</span>
                    <PriorityBadge value={request.risk_level} />
                  </div>
                  <div className="detail-item">
                    <span>Presupuesto</span>
                    <strong>{formatMoney(request.budget_impact)}</strong>
                  </div>
                  <div className="detail-item">
                    <span>Area</span>
                    <strong>{request.affected_area || "No especificada"}</strong>
                  </div>
                </div>
                <p>{request.summary}</p>
                <form action={pmDecisionAction} className="grid">
                  <input type="hidden" name="request_id" value={request.id} />
                  <TextArea label="Comentario de decision" name="comment" rows={3} />
                  <div className="button-row">
                    <button type="submit" name="decision" value="approve">
                      Aprobar para Lider Tecnico
                    </button>
                    {request.status === "PM_REVIEW" ? (
                      <button className="button-secondary" type="submit" name="decision" value="ccb">
                        Escalar a CCB
                      </button>
                    ) : null}
                    {request.status === "PM_REVIEW" ? (
                      <button className="button-danger" type="submit" name="decision" value="reject">
                        Rechazar y negociar
                      </button>
                    ) : null}
                  </div>
                </form>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="Sin solicitudes pendientes">No hay cambios esperando decision del PM.</EmptyState>
        )}
      </Panel>

      <Link className="button button-secondary" href="/dashboard">
        Volver al dashboard
      </Link>
    </AppShell>
  );
}
