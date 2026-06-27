import Link from "next/link";

import {
  assignRequestToDeliveryAction,
  createProjectDeliveryPlanAction
} from "@/app/actions/deliveries";
import { createDevBacklogItemAction } from "@/app/actions/work-items";
import { AppShell } from "@/components/AppShell";
import {
  EmptyState,
  Field,
  Panel,
  RequestLink,
  SelectField,
  StatusBadge,
  TextArea
} from "@/components/ui";
import { requireProjectRole } from "@/lib/auth";
import { query } from "@/lib/db";
import { buildDeliveryPeriods, deliveryCadenceLabel } from "@/lib/deliveries";
import { formatDate, formatDateTime } from "@/lib/format";
import { getProjectUsersByRole } from "@/lib/notifications";
import type { ChangeRequestRow } from "@/lib/types";

const priorityOptions = [
  { label: "Baja", value: "LOW" },
  { label: "Media", value: "MEDIUM" },
  { label: "Alta", value: "HIGH" },
  { label: "Critica", value: "CRITICAL" }
];

type DeliveryRow = {
  id: number;
  sequence_number: number;
  start_date: string;
  end_date: string;
  status: string;
  is_schedulable: number | boolean;
};

type ScheduledRequestRow = ChangeRequestRow & {
  delivery_sequence: number;
  delivery_start_date: string;
  delivery_end_date: string;
  is_overdue: number | boolean;
};

function deliveryWindowLabel(cadence: string | undefined, delivery: {
  sequence_number: number;
  start_date: string;
  end_date: string;
}) {
  const sequence = String(delivery.sequence_number).padStart(2, "0");
  const dates =
    cadence === "DAY"
      ? formatDate(delivery.start_date)
      : `${formatDate(delivery.start_date)} - ${formatDate(delivery.end_date)}`;
  return `Entrega ${sequence} · ${dates}`;
}

export default async function TechLeadPage({
  searchParams
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { project } = await requireProjectRole(["LIDER_TECNICO"]);
  const params = await searchParams;

  const [
    deliveryPlans,
    deliveries,
    unscheduledRequests,
    requests,
    overdueRequests,
    developers,
    qaUsers
  ] = await Promise.all([
    query<{ cadence: string; creator_name: string; created_at: string }>(
      `SELECT pdp.cadence, u.name AS creator_name, pdp.created_at
       FROM project_delivery_plans pdp
       INNER JOIN users u ON u.id = pdp.created_by
       WHERE pdp.project_id = ?`,
      [project.id]
    ),
    query<DeliveryRow>(
      `SELECT id, sequence_number, start_date, end_date, status,
              end_date >= CURDATE() AS is_schedulable
       FROM project_deliveries
       WHERE project_id = ?
       ORDER BY sequence_number`,
      [project.id]
    ),
    query<ChangeRequestRow>(
      `SELECT cr.*, u.name AS requester_name
       FROM change_requests cr
       INNER JOIN users u ON u.id = cr.requester_id
       WHERE cr.project_id = ?
         AND cr.delivery_id IS NULL
         AND cr.status IN ('TECH_LEAD_REQUIREMENTS','DEV_IN_PROGRESS')
       ORDER BY cr.updated_at ASC`,
      [project.id]
    ),
    query<ScheduledRequestRow>(
      `SELECT cr.*, u.name AS requester_name,
              pd.sequence_number AS delivery_sequence,
              pd.start_date AS delivery_start_date,
              pd.end_date AS delivery_end_date,
              pd.end_date < CURDATE() AS is_overdue
       FROM change_requests cr
       INNER JOIN users u ON u.id = cr.requester_id
       INNER JOIN project_deliveries pd ON pd.id = cr.delivery_id
       WHERE cr.project_id = ?
         AND cr.status = 'TECH_LEAD_REQUIREMENTS'
       ORDER BY cr.updated_at ASC`,
      [project.id]
    ),
    query<ScheduledRequestRow>(
      `SELECT cr.*, u.name AS requester_name,
              pd.sequence_number AS delivery_sequence,
              pd.start_date AS delivery_start_date,
              pd.end_date AS delivery_end_date,
              1 AS is_overdue
       FROM change_requests cr
       INNER JOIN users u ON u.id = cr.requester_id
       INNER JOIN project_deliveries pd ON pd.id = cr.delivery_id
       WHERE cr.project_id = ?
         AND cr.status <> 'CLOSED_APPROVED'
         AND pd.end_date < CURDATE()
       ORDER BY pd.end_date, cr.updated_at`,
      [project.id]
    ),
    getProjectUsersByRole(project.id, "DESARROLLADOR"),
    getProjectUsersByRole(project.id, "QA")
  ]);
  const deliveryPlan = deliveryPlans[0];
  const weeklyDeliveryCount = buildDeliveryPeriods(project.start_date, project.end_date, "WEEK").length;
  const dailyDeliveryCount = buildDeliveryPeriods(project.start_date, project.end_date, "DAY").length;
  const deliveryOptions = deliveries
    .filter((delivery) => Boolean(delivery.is_schedulable))
    .map((delivery) => ({
      label: deliveryWindowLabel(deliveryPlan?.cadence, delivery),
      value: delivery.id
    }));

  const developerOptions = [
    { label: "Sin asignar", value: "" },
    ...developers.map((dev) => ({ label: dev.name, value: dev.id }))
  ];
  const qaOptions = [
    { label: "Sin asignar", value: "" },
    ...qaUsers.map((qa) => ({ label: qa.name, value: qa.id }))
  ];

  return (
    <AppShell>
      {params.ok ? <div className="ok-banner">Operacion tecnica registrada.</div> : null}
      {params.error ? (
        <div className="error-banner">
          {params.error === "delivery-plan"
            ? "Debes crear el plan de entregas antes de continuar."
            : params.error === "delivery-required"
            ? "Selecciona una entrega vigente para programar la solicitud."
            : params.error === "config-impacts"
            ? "Resuelve los impactos de elementos SCM antes de enviar el cambio al PM."
            : "Completa los campos obligatorios."}
        </div>
      ) : null}

      <Panel
        title="Plan de entregas"
        eyebrow="Calendario del proyecto"
        actions={
          deliveryPlan ? (
            <span className="badge badge-success">{deliveryCadenceLabel(deliveryPlan.cadence)}</span>
          ) : (
            <span className="badge badge-warning">Obligatorio</span>
          )
        }
      >
        {deliveryPlan ? (
          <div className="grid">
            <p className="muted">
              Creado por {deliveryPlan.creator_name} · {formatDateTime(deliveryPlan.created_at)}
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Entrega</th>
                    <th>Inicio</th>
                    <th>Fin</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.map((delivery) => (
                    <tr key={delivery.id}>
                      <td>Entrega {String(delivery.sequence_number).padStart(2, "0")}</td>
                      <td>{formatDate(delivery.start_date)}</td>
                      <td>{formatDate(delivery.end_date)}</td>
                      <td>
                        <span className={`badge ${delivery.is_schedulable ? "badge-neutral" : "badge-warning"}`}>
                          {delivery.status === "COMPLETED"
                            ? "Completada"
                            : delivery.is_schedulable
                            ? "Planificada"
                            : "Vencida"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <form action={createProjectDeliveryPlanAction} className="form-grid">
            <SelectField
              label="Separar entregas por"
              name="delivery_cadence"
              options={[
                { label: `Semanas (${weeklyDeliveryCount} entregas)`, value: "WEEK" },
                { label: `Dias (${dailyDeliveryCount} entregas)`, value: "DAY" }
              ]}
              defaultValue="WEEK"
            />
            <div className="button-row field-wide">
              <button type="submit">Crear plan de entregas</button>
            </div>
          </form>
        )}
      </Panel>

      {deliveryPlan ? (
        <>
          <Panel
            id="programar-solicitudes"
            title="Solicitudes por programar"
            eyebrow="Asignacion a entregas"
            actions={
              unscheduledRequests.length ? (
                <span className="badge badge-warning">{unscheduledRequests.length} pendientes</span>
              ) : null
            }
          >
            {unscheduledRequests.length ? (
              <div className="grid grid-2">
                {unscheduledRequests.map((request) => (
                  <article className="work-card" key={request.id}>
                    <header>
                      <RequestLink id={request.id} code={request.change_code} title={request.title} />
                      <StatusBadge status={request.status} compact />
                    </header>
                    <p>{request.summary}</p>
                    {deliveryOptions.length ? (
                      <form action={assignRequestToDeliveryAction} className="form-grid">
                        <input type="hidden" name="request_id" value={request.id} />
                        <SelectField
                          label="Entrega"
                          name="delivery_id"
                          options={deliveryOptions}
                        />
                        <div className="button-row field-wide">
                          <button type="submit">Programar solicitud</button>
                        </div>
                      </form>
                    ) : (
                      <EmptyState title="Sin entregas vigentes">
                        El calendario del proyecto no tiene periodos disponibles.
                      </EmptyState>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState title="Sin solicitudes pendientes">
                Todas las solicitudes tecnicas tienen una entrega asignada.
              </EmptyState>
            )}
          </Panel>

          <Panel
            title="Solicitudes en tardanza"
            eyebrow="Entregas vencidas"
            actions={
              overdueRequests.length ? (
                <span className="badge badge-danger">{overdueRequests.length} en tardanza</span>
              ) : null
            }
          >
            {overdueRequests.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Solicitud</th>
                      <th>Entrega</th>
                      <th>Vencio</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overdueRequests.map((request) => (
                      <tr key={request.id}>
                        <td>
                          <RequestLink id={request.id} code={request.change_code} title={request.title} />
                        </td>
                        <td>
                          {deliveryWindowLabel(deliveryPlan.cadence, {
                            sequence_number: request.delivery_sequence,
                            start_date: request.delivery_start_date,
                            end_date: request.delivery_end_date
                          })}
                        </td>
                        <td>{formatDate(request.delivery_end_date)}</td>
                        <td>
                          <StatusBadge status={request.status} compact />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="Sin tardanzas">No hay solicitudes asignadas a entregas vencidas.</EmptyState>
            )}
          </Panel>

      <Panel id="crear-backlog" title="Crear tarjetas de backlog" eyebrow="Solicitudes aprobadas">
        {requests.length ? (
          <div className="grid">
            {requests.map((request) => (
              <article className="work-card" key={request.id}>
                <header>
                  <div>
                    <RequestLink id={request.id} code={request.change_code} title={request.title} />
                    <p className="muted">
                      {request.requester_name} · V{request.current_version} · {formatDateTime(request.updated_at)}
                    </p>
                    <p className="muted">
                      {deliveryWindowLabel(deliveryPlan.cadence, {
                        sequence_number: request.delivery_sequence,
                        start_date: request.delivery_start_date,
                        end_date: request.delivery_end_date
                      })}
                    </p>
                  </div>
                  <div className="button-row">
                    {request.is_overdue ? <span className="badge badge-danger">En tardanza</span> : null}
                    <StatusBadge status={request.status} compact />
                  </div>
                </header>
                <form action={createDevBacklogItemAction} className="form-grid">
                  <input type="hidden" name="request_id" value={request.id} />
                  <Field label="Titulo de tarjeta DEV" name="title" required defaultValue={request.title} />
                  <SelectField label="Desarrollador" name="developer_id" options={developerOptions} />
                  <SelectField label="QA asignado" name="qa_id" options={qaOptions} />
                  <SelectField label="Prioridad" name="priority" options={priorityOptions} defaultValue={request.priority} />
                  <Field label="Story points" name="story_points" type="number" />
                  <TextArea
                    label="Descripcion tecnica para DEV"
                    name="description"
                    required
                    rows={4}
                    defaultValue={request.technical_context || request.summary}
                  />
                  <TextArea
                    label="Criterios de aceptacion"
                    name="acceptance_criteria"
                    rows={3}
                    defaultValue={request.acceptance_criteria}
                  />
                  <TextArea label="Definition of done" name="definition_of_done" rows={3} />
                  <div className="button-row field-wide">
                    <button type="submit">Crear tarjeta DEV y QA</button>
                  </div>
                </form>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="Sin solicitudes aprobadas">No hay solicitudes listas para convertir en backlog.</EmptyState>
        )}
      </Panel>

        </>
      ) : null}

      <Link className="button button-secondary" href="/dashboard">
        Volver al dashboard
      </Link>
    </AppShell>
  );
}
