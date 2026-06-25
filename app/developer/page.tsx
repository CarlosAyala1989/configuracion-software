import Link from "next/link";

import { developerProgressAction } from "@/app/actions/work-items";
import { AppShell } from "@/components/AppShell";
import { EmptyState, Field, Panel, ProgressBar, StatusBadge, TextArea } from "@/components/ui";
import { requireProjectRole } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDate, formatDateTime } from "@/lib/format";
import type { WorkItemRow } from "@/lib/types";

export default async function DeveloperPage({
  searchParams
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { user, project } = await requireProjectRole(["DESARROLLADOR"]);
  const params = await searchParams;

  const [items, updates] = await Promise.all([
    query<WorkItemRow>(
      `SELECT wi.*, u.name AS assignee_name, cr.change_code, cr.title AS request_title
       FROM work_items wi
       INNER JOIN change_requests cr ON cr.id = wi.change_request_id
       LEFT JOIN users u ON u.id = wi.assigned_to
       WHERE wi.project_id = ?
         AND wi.type = 'DEV'
         AND wi.status IN ('NEW','ACTIVE','COMPLETED')
         ${user.is_admin ? "" : "AND (wi.assigned_to IS NULL OR wi.assigned_to = ?)"}
       ORDER BY FIELD(wi.status, 'ACTIVE', 'NEW', 'COMPLETED'), wi.updated_at DESC`,
      user.is_admin ? [project.id] : [project.id, user.id]
    ),
    query<{
      id: number;
      work_item_id: number;
      title: string;
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
      `SELECT wu.*, wi.title
       FROM work_item_updates wu
       INNER JOIN work_items wi ON wi.id = wu.work_item_id
       WHERE wi.project_id = ?
         AND wi.type = 'DEV'
         ${user.is_admin ? "" : "AND wu.user_id = ?"}
       ORDER BY wu.created_at DESC
       LIMIT 20`,
      user.is_admin ? [project.id] : [project.id, user.id]
    )
  ]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <AppShell>
      {params.ok ? <div className="ok-banner">Avance registrado correctamente.</div> : null}
      {params.error ? <div className="error-banner">Revisa los datos del reporte diario.</div> : null}

      <Panel id="backlog-dev" title="Backlog de desarrollo" eyebrow="Desarrollador">
        {items.length ? (
          <div className="grid grid-2">
            {items.map((item) => (
              <article className="work-card" key={item.id}>
                <header>
                  <div>
                    <h3>#{item.id} {item.title}</h3>
                    <p className="muted">
                      <Link href={`/requests/${item.change_request_id}`}>{item.change_code}</Link> ·{" "}
                      {item.assignee_name || "Sin asignar"} · V{item.version}
                    </p>
                  </div>
                  <StatusBadge status={item.status} compact />
                </header>

                <p>{item.description}</p>
                <div className="detail-list">
                  <div className="detail-item">
                    <span>Avance</span>
                    <strong>{item.progress_percent}%</strong>
                    <ProgressBar value={item.progress_percent} />
                  </div>
                  <div className="detail-item">
                    <span>Restante</span>
                    <strong>{item.remaining_percent}%</strong>
                  </div>
                  <div className="detail-item">
                    <span>Rama GitHub</span>
                    <strong>{item.github_branch || "Pendiente"}</strong>
                  </div>
                  <div className="detail-item">
                    <span>Solicitud</span>
                    <strong>{item.request_title}</strong>
                  </div>
                </div>

                {item.status !== "COMPLETED" ? (
                  <form action={developerProgressAction} className="form-grid">
                    <input type="hidden" name="work_item_id" value={item.id} />
                    <Field label="Fecha de trabajo" name="work_date" type="date" required defaultValue={today} />
                    <Field label="Horas trabajadas hoy" name="hours_spent" type="number" required placeholder="0.0" />
                    <Field
                      label="Porcentaje avanzado"
                      name="progress_percent"
                      type="number"
                      required
                      defaultValue={item.progress_percent}
                    />
                    <Field
                      label="Porcentaje restante"
                      name="remaining_percent"
                      type="number"
                      required
                      defaultValue={item.remaining_percent}
                    />
                    <Field label="Rama GitHub" name="github_branch" defaultValue={item.github_branch} />
                    <TextArea label="Que avance hoy" name="today_done" required rows={3} />
                    <TextArea label="Que avanzare manana" name="tomorrow_plan" required rows={3} />
                    <TextArea label="Bloqueos u observaciones" name="blockers" rows={3} />
                    <label className="field field-wide">
                      <span>Documentacion tecnica (obligatoria al completar)</span>
                      <input name="documentation" type="file" accept=".pdf,.doc,.docx" />
                    </label>
                    <label className="field field-wide checkbox-field">
                      <input name="mark_complete" type="checkbox" />
                      <span>Marcar como completado y activar QA</span>
                    </label>
                    <div className="button-row field-wide">
                      <button type="submit">Registrar avance</button>
                    </div>
                  </form>
                ) : (
                  <p className="muted">La tarjeta ya fue enviada a QA.</p>
                )}
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="Sin tarjetas asignadas">El lider tecnico aun no asigna trabajo de desarrollo.</EmptyState>
        )}
      </Panel>

      <Panel id="mis-reportes" title="Mis reportes recientes" eyebrow="Horas y avance">
        {updates.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tarjeta</th>
                  <th>Fecha</th>
                  <th>Horas</th>
                  <th>Avance</th>
                  <th>Restante</th>
                  <th>Hoy</th>
                  <th>Manana</th>
                  <th>Registro</th>
                </tr>
              </thead>
              <tbody>
                {updates.map((update) => (
                  <tr key={update.id}>
                    <td>#{update.work_item_id} {update.title}</td>
                    <td>{formatDate(update.work_date)}</td>
                    <td>{Number(update.hours_spent).toFixed(1)}</td>
                    <td>{update.progress_percent}%</td>
                    <td>{update.remaining_percent}%</td>
                    <td>{update.today_done}</td>
                    <td>{update.tomorrow_plan}</td>
                    <td>{formatDateTime(update.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Sin reportes">Registra tu primer avance desde una tarjeta.</EmptyState>
        )}
      </Panel>
    </AppShell>
  );
}
