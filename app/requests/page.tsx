import Link from "next/link";

import { createChangeRequestAction } from "@/app/actions/requests";
import { AppShell } from "@/components/AppShell";
import {
  EmptyState,
  Field,
  Panel,
  PriorityBadge,
  RequestLink,
  SelectField,
  StatusBadge,
  TextArea
} from "@/components/ui";
import { canUseRole, getActiveProject, requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDateTime, formatMoney } from "@/lib/format";
import type { ChangeRequestRow } from "@/lib/types";

const priorityOptions = [
  { label: "Baja", value: "LOW" },
  { label: "Media", value: "MEDIUM" },
  { label: "Alta", value: "HIGH" },
  { label: "Critica", value: "CRITICAL" }
];

export default async function RequestsPage({
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
        <EmptyState title="Sin proyecto activo">No hay proyectos disponibles para registrar cambios.</EmptyState>
      </AppShell>
    );
  }

  const canRequest = canUseRole(user, role, ["SOLICITANTE"]);
  const [requests, configurationItems] = await Promise.all([
    query<ChangeRequestRow>(
      `SELECT cr.*, u.name AS requester_name
       FROM change_requests cr
       INNER JOIN users u ON u.id = cr.requester_id
       WHERE cr.project_id = ? ${user.is_admin ? "" : "AND cr.requester_id = ?"}
       ORDER BY cr.updated_at DESC`,
      user.is_admin ? [project.id] : [project.id, user.id]
    ),
    query<{
      id: number;
      name: string;
      category: string;
      current_version: number;
    }>(
      `SELECT id, name, category, current_version
       FROM project_configuration_items
       WHERE project_id = ? AND active = 1
       ORDER BY category, name`,
      [project.id]
    )
  ]);
  const configurationItemsByCategory = configurationItems.reduce<
    Record<string, typeof configurationItems>
  >((groups, item) => {
    groups[item.category] = groups[item.category] || [];
    groups[item.category].push(item);
    return groups;
  }, {});

  return (
    <AppShell>
      {params.ok ? <div className="ok-banner">Operacion registrada correctamente.</div> : null}
      {params.error ? <div className="error-banner">Revisa los campos obligatorios.</div> : null}

      {canRequest ? (
        <Panel id="crear-solicitud" title="Solicitar cambio" eyebrow="Solicitante">
          <form action={createChangeRequestAction} className="form-grid">
            <Field label="Titulo" name="title" required placeholder="Ej. Ajustar flujo de aprobacion" />
            <Field label="Area afectada" name="affected_area" required placeholder="Modulo, proceso o sistema" />
            <TextArea
              label="Resumen detallado"
              name="summary"
              required
              rows={5}
              placeholder="Describe el cambio, alcance, usuarios afectados, datos involucrados y contexto operativo."
            />
            <TextArea
              label="Justificacion de negocio"
              name="business_reason"
              required
              rows={5}
              placeholder="Explica por que se necesita, beneficio esperado, urgencia y riesgo de no hacerlo."
            />
            <SelectField label="Prioridad" name="priority" options={priorityOptions} defaultValue="MEDIUM" />
            <SelectField label="Riesgo" name="risk_level" options={priorityOptions} defaultValue="MEDIUM" />
            <Field label="Impacto presupuestal estimado" name="budget_impact" type="number" placeholder="0.00" />
            <Field label="Fecha requerida" name="requested_deadline" type="date" />
            <TextArea label="Alcance funcional" name="functional_scope" rows={4} required />
            <TextArea label="Contexto tecnico conocido" name="technical_context" rows={4} />
            <TextArea label="Criterios de aceptacion" name="acceptance_criteria" rows={4} required />
            <TextArea label="Analisis de impacto" name="impact_analysis" rows={4} required />
            <div className="field field-wide">
              <span>Elementos de configuracion que cambian</span>
              {configurationItems.length ? (
                <div className="config-category-list">
                  {Object.entries(configurationItemsByCategory).map(([category, items]) => (
                    <section key={category} className="config-category">
                      <h3>{category}</h3>
                      <div className="config-checkbox-grid">
                        {items.map((item) => (
                          <label className="config-check" key={item.id}>
                            <input name="configuration_item_id" type="checkbox" value={item.id} />
                            <span>
                              <strong>{item.name}</strong>
                              <small>V{item.current_version}</small>
                            </span>
                          </label>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <EmptyState title="Sin ECS">Configura los elementos del proyecto antes de solicitar cambios.</EmptyState>
              )}
            </div>
            <TextArea label="Plan de rollback o contingencia" name="rollback_plan" rows={4} required />
            <label className="field field-wide">
              <span>Documento de soporte (PDF, DOC, DOCX)</span>
              <input name="attachment" type="file" accept=".pdf,.doc,.docx" />
            </label>
            <div className="button-row field-wide">
              <button type="submit">Enviar solicitud</button>
            </div>
          </form>
        </Panel>
      ) : null}

      <Panel id="mis-solicitudes" title="Mis solicitudes" eyebrow="Backlog de cambios">
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
          <EmptyState title="Sin solicitudes">
            {canRequest ? "Crea la primera solicitud para iniciar el flujo." : "No hay solicitudes visibles."}
          </EmptyState>
        )}
      </Panel>

      <Link className="button button-secondary" href="/dashboard">
        Volver al dashboard
      </Link>
    </AppShell>
  );
}
