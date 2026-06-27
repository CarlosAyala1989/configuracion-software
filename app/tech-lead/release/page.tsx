import Link from "next/link";

import { tlSendToPmAction } from "@/app/actions/work-items";
import { AppShell } from "@/components/AppShell";
import { EmptyState, Panel, RequestLink, StatusBadge, TextArea } from "@/components/ui";
import { requireProjectRole } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDate } from "@/lib/format";
import type { ChangeRequestRow } from "@/lib/types";

type ReadyRequestRow = ChangeRequestRow & {
  delivery_sequence: number;
  delivery_start_date: string;
  delivery_end_date: string;
  is_overdue: number | boolean;
};

function deliveryWindowLabel(cadence: string | undefined, request: ReadyRequestRow) {
  const sequence = String(request.delivery_sequence).padStart(2, "0");
  const dates =
    cadence === "DAY"
      ? formatDate(request.delivery_start_date)
      : `${formatDate(request.delivery_start_date)} - ${formatDate(request.delivery_end_date)}`;
  return `Entrega ${sequence} · ${dates}`;
}

export default async function TechLeadReleasePage({
  searchParams
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { project } = await requireProjectRole(["LIDER_TECNICO"]);
  const params = await searchParams;
  const [plans, requests] = await Promise.all([
    query<{ cadence: string }>(
      "SELECT cadence FROM project_delivery_plans WHERE project_id = ? LIMIT 1",
      [project.id]
    ),
    query<ReadyRequestRow>(
      `SELECT cr.*, u.name AS requester_name,
              pd.sequence_number AS delivery_sequence,
              pd.start_date AS delivery_start_date,
              pd.end_date AS delivery_end_date,
              pd.end_date < CURDATE() AS is_overdue
       FROM change_requests cr
       INNER JOIN users u ON u.id = cr.requester_id
       INNER JOIN project_deliveries pd ON pd.id = cr.delivery_id
       WHERE cr.project_id = ? AND cr.status = 'TECH_LEAD_REVIEW'
       ORDER BY cr.updated_at ASC`,
      [project.id]
    )
  ]);
  const cadence = plans[0]?.cadence;

  return (
    <AppShell>
      {params.ok ? <div className="ok-banner">Solicitud enviada al jefe de proyectos.</div> : null}
      {params.error ? (
        <div className="error-banner">
          {params.error === "config-impacts"
            ? "Resuelve los impactos de elementos SCM antes de enviar el cambio al PM."
            : "No se pudo completar la operacion."}
        </div>
      ) : null}

      <Panel title="Liberar hacia Jefe de Proyectos" eyebrow="QA aprobado">
        {requests.length ? (
          <div className="grid grid-2">
            {requests.map((request) => (
              <article className="work-card" key={request.id}>
                <header>
                  <div>
                    <RequestLink id={request.id} code={request.change_code} title={request.title} />
                    <p className="muted">{deliveryWindowLabel(cadence, request)}</p>
                  </div>
                  <div className="button-row">
                    {request.is_overdue ? <span className="badge badge-danger">En tardanza</span> : null}
                    <StatusBadge status={request.status} compact />
                  </div>
                </header>
                <form action={tlSendToPmAction} className="grid">
                  <input type="hidden" name="request_id" value={request.id} />
                  <TextArea label="Comentario tecnico final" name="comment" rows={3} />
                  <button type="submit">Enviar al Jefe de Proyectos</button>
                </form>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="Sin cambios listos">Las tarjetas deben ser aprobadas por QA.</EmptyState>
        )}
      </Panel>

      <Link className="button button-secondary" href="/dashboard">
        Volver al dashboard
      </Link>
    </AppShell>
  );
}
