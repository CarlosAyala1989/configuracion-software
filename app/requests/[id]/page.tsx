import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { requesterFinalDecisionAction, requesterResubmitAction } from "@/app/actions/requests";
import { AppShell } from "@/components/AppShell";
import {
  EmptyState,
  Field,
  Panel,
  PriorityBadge,
  ProgressBar,
  SelectField,
  StatusBadge,
  TextArea
} from "@/components/ui";
import { canUseRole, getActiveProject, requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { getDocumentsForChange } from "@/lib/documents";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import type { ChangeRequestRow, WorkItemRow } from "@/lib/types";

const priorityOptions = [
  { label: "Baja", value: "LOW" },
  { label: "Media", value: "MEDIUM" },
  { label: "Alta", value: "HIGH" },
  { label: "Critica", value: "CRITICAL" }
];

export default async function RequestDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const user = await requireUser();
  const { project, role } = await getActiveProject(user);
  const { id } = await params;
  const requestId = Number(id);
  if (!requestId) notFound();

  const rows = await query<ChangeRequestRow & { project_title: string }>(
    `SELECT cr.*, u.name AS requester_name, p.title AS project_title
     FROM change_requests cr
     INNER JOIN users u ON u.id = cr.requester_id
     INNER JOIN projects p ON p.id = cr.project_id
     WHERE cr.id = ?
     LIMIT 1`,
    [requestId]
  );
  const request = rows[0];
  if (!request) notFound();

  if (!user.is_admin && project?.id !== request.project_id) {
    redirect("/dashboard");
  }

  const [audit, workItems, updates, reviews, documents, paramsValue] = await Promise.all([
    query<{
      id: number;
      action: string;
      from_status: string | null;
      to_status: string | null;
      comment: string | null;
      actor_name: string;
      created_at: string;
    }>(
      `SELECT ae.*, u.name AS actor_name
       FROM audit_events ae
       INNER JOIN users u ON u.id = ae.actor_id
       WHERE ae.change_request_id = ?
       ORDER BY ae.created_at DESC`,
      [requestId]
    ),
    query<WorkItemRow>(
      `SELECT wi.*, u.name AS assignee_name
       FROM work_items wi
       LEFT JOIN users u ON u.id = wi.assigned_to
       WHERE wi.change_request_id = ?
       ORDER BY wi.type, wi.created_at`,
      [requestId]
    ),
    query<{
      id: number;
      work_item_id: number;
      title: string;
      user_name: string;
      work_date: string;
      hours_spent: string;
      today_done: string;
      tomorrow_plan: string;
      blockers: string | null;
      progress_percent: number;
      remaining_percent: number;
      github_branch: string | null;
      created_at: string;
    }>(
      `SELECT wu.*, wi.title, u.name AS user_name
       FROM work_item_updates wu
       INNER JOIN work_items wi ON wi.id = wu.work_item_id
       INNER JOIN users u ON u.id = wu.user_id
       WHERE wi.change_request_id = ?
       ORDER BY wu.created_at DESC`,
      [requestId]
    ),
    query<{
      id: number;
      qa_work_item_id: number;
      dev_work_item_id: number;
      reviewer_name: string;
      verdict: string;
      comments: string;
      version: number;
      created_at: string;
    }>(
      `SELECT qr.*, u.name AS reviewer_name
       FROM qa_reviews qr
       INNER JOIN users u ON u.id = qr.reviewer_id
       INNER JOIN work_items wi ON wi.id = qr.qa_work_item_id
       WHERE wi.change_request_id = ?
       ORDER BY qr.created_at DESC`,
      [requestId]
    ),
    getDocumentsForChange(requestId),
    searchParams
  ]);

  const paramsOk = paramsValue.ok;
  const paramsError = paramsValue.error;
  const requesterCanAct =
    canUseRole(user, role, ["SOLICITANTE"]) && request.requester_id === user.id;

  return (
    <AppShell>
      {paramsOk ? <div className="ok-banner">Operacion registrada correctamente.</div> : null}
      {paramsError ? <div className="error-banner">Completa los campos obligatorios antes de continuar.</div> : null}

      <Panel
        title={`${request.change_code} · ${request.title}`}
        eyebrow={`Proyecto: ${request.project_title}`}
        actions={<StatusBadge status={request.status} compact />}
      >
        <div className="detail-list">
          <div className="detail-item">
            <span>Solicitante</span>
            <strong>{request.requester_name}</strong>
          </div>
          <div className="detail-item">
            <span>Version</span>
            <strong>V{request.current_version}</strong>
          </div>
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
            <strong>{formatDate(request.requested_deadline)}</strong>
          </div>
        </div>
      </Panel>

      <section className="grid grid-2">
        <Panel title="Detalle funcional">
          <div className="grid">
            <div>
              <h3>Resumen</h3>
              <p>{request.summary}</p>
            </div>
            <div>
              <h3>Justificacion</h3>
              <p>{request.business_reason}</p>
            </div>
            <div>
              <h3>Criterios de aceptacion</h3>
              <p>{request.acceptance_criteria || "Sin criterios registrados."}</p>
            </div>
          </div>
        </Panel>

        <Panel title="Impacto y rollback">
          <div className="grid">
            <div>
              <h3>Alcance funcional</h3>
              <p>{request.functional_scope || "Sin alcance registrado."}</p>
            </div>
            <div>
              <h3>Contexto tecnico</h3>
              <p>{request.technical_context || "Sin contexto registrado."}</p>
            </div>
            <div>
              <h3>Plan de contingencia</h3>
              <p>{request.rollback_plan || "Sin plan registrado."}</p>
            </div>
          </div>
        </Panel>
      </section>

      {requesterCanAct && request.status === "REQUESTER_NEGOTIATION" ? (
        <Panel title="Responder observaciones y reenviar" eyebrow="Miniflujo de acuerdo">
          <form action={requesterResubmitAction} className="form-grid">
            <input type="hidden" name="request_id" value={request.id} />
            <Field label="Titulo" name="title" required defaultValue={request.title} />
            <Field label="Area afectada" name="affected_area" required defaultValue={request.affected_area} />
            <TextArea label="Resumen detallado" name="summary" required rows={4} defaultValue={request.summary} />
            <TextArea
              label="Justificacion de negocio"
              name="business_reason"
              required
              rows={4}
              defaultValue={request.business_reason}
            />
            <SelectField label="Prioridad" name="priority" options={priorityOptions} defaultValue={request.priority} />
            <SelectField label="Riesgo" name="risk_level" options={priorityOptions} defaultValue={request.risk_level} />
            <Field label="Impacto presupuestal" name="budget_impact" type="number" defaultValue={request.budget_impact} />
            <Field
              label="Fecha requerida"
              name="requested_deadline"
              type="date"
              defaultValue={request.requested_deadline}
            />
            <TextArea label="Alcance funcional" name="functional_scope" rows={3} required defaultValue={request.functional_scope} />
            <TextArea label="Contexto tecnico" name="technical_context" rows={3} defaultValue={request.technical_context} />
            <TextArea
              label="Criterios de aceptacion"
              name="acceptance_criteria"
              rows={3}
              required
              defaultValue={request.acceptance_criteria}
            />
            <TextArea label="Analisis de impacto" name="impact_analysis" rows={3} required defaultValue={request.impact_analysis} />
            <TextArea label="Plan de rollback" name="rollback_plan" rows={3} required defaultValue={request.rollback_plan} />
            <TextArea label="Respuesta al rechazo" name="comment" required rows={3} />
            <label className="field field-wide">
              <span>Nuevo documento de soporte</span>
              <input name="attachment" type="file" accept=".pdf,.doc,.docx" />
            </label>
            <div className="button-row field-wide">
              <button type="submit">Reenviar a Jefe de Proyectos</button>
            </div>
          </form>
        </Panel>
      ) : null}

      {requesterCanAct && request.status === "REQUESTER_VALIDATION" ? (
        <Panel title="Validacion final del solicitante" eyebrow="Recepcion del cambio final">
          <form action={requesterFinalDecisionAction} className="form-grid">
            <input type="hidden" name="request_id" value={request.id} />
            <TextArea label="Comentario u observaciones" name="comment" rows={4} />
            <label className="field">
              <span>Documento de observacion</span>
              <input name="document" type="file" accept=".pdf,.doc,.docx" />
            </label>
            <div className="button-row field-wide">
              <button type="submit" name="decision" value="approve">
                Aprobar y cerrar
              </button>
              <button className="button-danger" type="submit" name="decision" value="reject">
                Observar y reiniciar flujo
              </button>
            </div>
          </form>
        </Panel>
      ) : null}

      <Panel title="Backlog relacionado">
        {workItems.length ? (
          <div className="grid grid-2">
            {workItems.map((item) => (
              <article className="work-card" key={item.id}>
                <header>
                  <div>
                    <h3>#{item.id} {item.title}</h3>
                    <p className="muted">{item.type} · {item.assignee_name || "Sin asignar"} · V{item.version}</p>
                  </div>
                  <StatusBadge status={item.status} compact />
                </header>
                <p>{item.description}</p>
                <ProgressBar value={item.progress_percent} />
                <p className="muted">Rama: {item.github_branch || "Pendiente"}</p>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="Sin tarjetas">El lider tecnico aun no crea tarjetas de backlog.</EmptyState>
        )}
      </Panel>

      <section className="grid grid-2">
        <Panel title="Documentos">
          {documents.length ? (
            <div className="doc-list">
              {documents.map((doc) => (
                <Link key={doc.id} href={`/api/documents/${doc.id}`}>
                  <span>{doc.file_name}</span>
                  <small>{doc.doc_type} · {doc.uploaded_by_name}</small>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState title="Sin documentos">No hay archivos asociados.</EmptyState>
          )}
        </Panel>

        <Panel title="Revisiones QA">
          {reviews.length ? (
            <div className="audit-list">
              {reviews.map((review) => (
                <div className="audit-event" key={review.id}>
                  <strong>{review.verdict} · V{review.version}</strong>
                  <p>{review.comments}</p>
                  <span className="muted">{review.reviewer_name} · {formatDateTime(review.created_at)}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="Sin revisiones">QA aun no registra decisiones.</EmptyState>
          )}
        </Panel>
      </section>

      <Panel title="Avances diarios">
        {updates.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tarjeta</th>
                  <th>Usuario</th>
                  <th>Fecha</th>
                  <th>Horas</th>
                  <th>Avance</th>
                  <th>Hoy</th>
                  <th>Manana</th>
                </tr>
              </thead>
              <tbody>
                {updates.map((update) => (
                  <tr key={update.id}>
                    <td>#{update.work_item_id} {update.title}</td>
                    <td>{update.user_name}</td>
                    <td>{formatDate(update.work_date)}</td>
                    <td>{Number(update.hours_spent).toFixed(1)}</td>
                    <td>{update.progress_percent}%</td>
                    <td>{update.today_done}</td>
                    <td>{update.tomorrow_plan}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Sin avances">No se han reportado horas para esta solicitud.</EmptyState>
        )}
      </Panel>

      <Panel title="Trazabilidad">
        {audit.length ? (
          <div className="audit-list">
            {audit.map((event) => (
              <div className="audit-event" key={event.id}>
                <strong>{event.action}</strong>
                <p>
                  {event.from_status || "Inicio"} -&gt; {event.to_status || "Sin cambio"}
                </p>
                {event.comment ? <p>{event.comment}</p> : null}
                <span className="muted">{event.actor_name} · {formatDateTime(event.created_at)}</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="Sin eventos">La trazabilidad iniciara con la primera decision.</EmptyState>
        )}
      </Panel>

      <Link className="button button-secondary" href="/requests">
        Volver a solicitudes
      </Link>
    </AppShell>
  );
}
