import Link from "next/link";

import { createDevBacklogItemAction, tlSendToPmAction } from "@/app/actions/work-items";
import { AppShell } from "@/components/AppShell";
import {
  EmptyState,
  Field,
  Panel,
  ProgressBar,
  RequestLink,
  SelectField,
  StatusBadge,
  TextArea
} from "@/components/ui";
import { requireProjectRole } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { getProjectUsersByRole } from "@/lib/notifications";
import type { ChangeRequestRow, WorkItemRow } from "@/lib/types";

const priorityOptions = [
  { label: "Baja", value: "LOW" },
  { label: "Media", value: "MEDIUM" },
  { label: "Alta", value: "HIGH" },
  { label: "Critica", value: "CRITICAL" }
];

export default async function TechLeadPage({
  searchParams
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { project } = await requireProjectRole(["LIDER_TECNICO"]);
  const params = await searchParams;

  const [requests, readyRequests, workItems, developers, qaUsers] = await Promise.all([
    query<ChangeRequestRow>(
      `SELECT cr.*, u.name AS requester_name
       FROM change_requests cr
       INNER JOIN users u ON u.id = cr.requester_id
       WHERE cr.project_id = ? AND cr.status IN ('TECH_LEAD_REQUIREMENTS','DEV_IN_PROGRESS')
       ORDER BY cr.updated_at ASC`,
      [project.id]
    ),
    query<ChangeRequestRow>(
      `SELECT cr.*, u.name AS requester_name
       FROM change_requests cr
       INNER JOIN users u ON u.id = cr.requester_id
       WHERE cr.project_id = ? AND cr.status = 'TECH_LEAD_REVIEW'
       ORDER BY cr.updated_at ASC`,
      [project.id]
    ),
    query<WorkItemRow>(
      `SELECT wi.*, u.name AS assignee_name, cr.change_code, cr.title AS request_title
       FROM work_items wi
       INNER JOIN change_requests cr ON cr.id = wi.change_request_id
       LEFT JOIN users u ON u.id = wi.assigned_to
       WHERE wi.project_id = ?
       ORDER BY wi.updated_at DESC
       LIMIT 40`,
      [project.id]
    ),
    getProjectUsersByRole(project.id, "DESARROLLADOR"),
    getProjectUsersByRole(project.id, "QA")
  ]);

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
          {params.error === "config-impacts"
            ? "Resuelve los impactos de elementos SCM antes de enviar el cambio al PM."
            : "Completa los campos obligatorios."}
        </div>
      ) : null}

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
                  </div>
                  <StatusBadge status={request.status} compact />
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

      <Panel id="liberar-pm" title="Liberar hacia Jefe de Proyectos" eyebrow="QA aprobado">
        {readyRequests.length ? (
          <div className="grid grid-2">
            {readyRequests.map((request) => (
              <article className="work-card" key={request.id}>
                <header>
                  <RequestLink id={request.id} code={request.change_code} title={request.title} />
                  <StatusBadge status={request.status} compact />
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

      <Panel id="backlogs" title="Backlogs DEV y QA" eyebrow="Vista tecnica">
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
                  </div>
                  <StatusBadge status={item.status} compact />
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
