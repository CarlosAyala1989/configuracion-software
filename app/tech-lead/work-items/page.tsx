import Link from "next/link";

import { AppShell } from "@/components/AppShell";
import { EmptyState, Panel, ProgressBar, StatusBadge } from "@/components/ui";
import { requireProjectRole } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDate } from "@/lib/format";
import type { WorkItemRow } from "@/lib/types";

type ScheduledWorkItemRow = WorkItemRow & {
  delivery_sequence: number | null;
  delivery_start_date: string | null;
  delivery_end_date: string | null;
  delivery_cadence: string | null;
  is_overdue: number | boolean;
};

function deliveryWindowLabel(item: ScheduledWorkItemRow) {
  if (!item.delivery_sequence || !item.delivery_start_date || !item.delivery_end_date) {
    return "Sin entrega asignada";
  }
  const sequence = String(item.delivery_sequence).padStart(2, "0");
  const dates =
    item.delivery_cadence === "DAY"
      ? formatDate(item.delivery_start_date)
      : `${formatDate(item.delivery_start_date)} - ${formatDate(item.delivery_end_date)}`;
  return `Entrega ${sequence} · ${dates}`;
}

export default async function TechLeadWorkItemsPage() {
  const { project } = await requireProjectRole(["LIDER_TECNICO"]);
  const workItems = await query<ScheduledWorkItemRow>(
    `SELECT wi.*, u.name AS assignee_name, cr.change_code, cr.title AS request_title,
            pd.sequence_number AS delivery_sequence,
            pd.start_date AS delivery_start_date,
            pd.end_date AS delivery_end_date,
            pdp.cadence AS delivery_cadence,
            (pd.end_date < CURDATE() AND cr.status <> 'CLOSED_APPROVED') AS is_overdue
     FROM work_items wi
     INNER JOIN change_requests cr ON cr.id = wi.change_request_id
     LEFT JOIN users u ON u.id = wi.assigned_to
     LEFT JOIN project_deliveries pd ON pd.id = cr.delivery_id
     LEFT JOIN project_delivery_plans pdp ON pdp.project_id = cr.project_id
     WHERE wi.project_id = ?
     ORDER BY wi.updated_at DESC
     LIMIT 40`,
    [project.id]
  );

  return (
    <AppShell>
      <Panel title="Backlogs DEV y QA" eyebrow="Vista tecnica">
        {workItems.length ? (
          <div className="grid grid-2">
            {workItems.map((item) => (
              <article className="work-card" key={item.id}>
                <header>
                  <div>
                    <h3>#{item.id} {item.title}</h3>
                    <p className="muted">
                      {item.type} · {item.change_code} · {item.assignee_name || "Sin asignar"} · V{item.version}
                    </p>
                    <p className="muted">{deliveryWindowLabel(item)}</p>
                  </div>
                  <div className="button-row">
                    {item.is_overdue ? <span className="badge badge-danger">En tardanza</span> : null}
                    <StatusBadge status={item.status} compact />
                  </div>
                </header>
                <p>{item.description}</p>
                <ProgressBar value={item.progress_percent} />
                <p className="muted">Solicitud: {item.request_title}</p>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="Sin tarjetas">Crea una tarjeta DEV para generar su QA automatica.</EmptyState>
        )}
      </Panel>

      <Link className="button button-secondary" href="/dashboard">
        Volver al dashboard
      </Link>
    </AppShell>
  );
}
