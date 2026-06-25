import Link from "next/link";

import { ccbDecisionAction } from "@/app/actions/requests";
import { AppShell } from "@/components/AppShell";
import { EmptyState, Panel, PriorityBadge, RequestLink, StatusBadge, TextArea } from "@/components/ui";
import { requireProjectRole } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDateTime, formatMoney } from "@/lib/format";
import type { ChangeRequestRow } from "@/lib/types";

export default async function CcbPage({
  searchParams
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { project } = await requireProjectRole(["CCB"]);
  const params = await searchParams;
  const pending = await query<ChangeRequestRow>(
    `SELECT cr.*, u.name AS requester_name
     FROM change_requests cr
     INNER JOIN users u ON u.id = cr.requester_id
     WHERE cr.project_id = ? AND cr.status = 'CCB_REVIEW'
     ORDER BY cr.updated_at ASC`,
    [project.id]
  );

  return (
    <AppShell>
      {params.ok ? <div className="ok-banner">Decision del CCB registrada.</div> : null}
      {params.error ? <div className="error-banner">El CCB debe adjuntar un documento PDF, DOC o DOCX.</div> : null}

      <Panel id="revision-ccb" title="Comite de Control de Cambios" eyebrow="Solicitudes escaladas">
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
                    <span>Fecha requerida</span>
                    <strong>{request.requested_deadline || "Sin fecha"}</strong>
                  </div>
                </div>
                <p>{request.business_reason}</p>
                <form action={ccbDecisionAction} className="grid">
                  <input type="hidden" name="request_id" value={request.id} />
                  <TextArea label="Sustento del comite" name="comment" rows={4} required />
                  <label className="field">
                    <span>Documento obligatorio de decision</span>
                    <input name="document" type="file" required accept=".pdf,.doc,.docx" />
                  </label>
                  <div className="button-row">
                    <button type="submit" name="decision" value="approve">
                      Aprobar y devolver al PM
                    </button>
                    <button className="button-danger" type="submit" name="decision" value="reject">
                      Rechazar y devolver al solicitante
                    </button>
                  </div>
                </form>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="Sin solicitudes CCB">No hay solicitudes escaladas al comite.</EmptyState>
        )}
      </Panel>

      <Link className="button button-secondary" href="/dashboard">
        Volver al dashboard
      </Link>
    </AppShell>
  );
}
