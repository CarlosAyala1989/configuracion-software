import Link from "next/link";

import { AppShell } from "@/components/AppShell";
import { EmptyState, Panel, RequestLink, StatusBadge } from "@/components/ui";
import { getActiveProject, requireUser } from "@/lib/auth";
import {
  CONFIGURATION_IMPACT_STATUS_LABELS,
  CONFIGURATION_IMPACT_TYPE_LABELS,
  methodologyLabel
} from "@/lib/configuration";
import { query } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

export default async function ConfigurationPage() {
  const user = await requireUser();
  const { project } = await getActiveProject(user);

  if (!project) {
    return (
      <AppShell>
        <EmptyState title="Sin proyecto activo">Selecciona o crea un proyecto para ver sus elementos SCM.</EmptyState>
      </AppShell>
    );
  }

  const [items, dependencies, impacts] = await Promise.all([
    query<{
      id: number;
      name: string;
      category: string;
      current_version: number;
      updated_at: string;
    }>(
      `SELECT id, name, category, current_version, updated_at
       FROM project_configuration_items
       WHERE project_id = ? AND active = 1
       ORDER BY category, name`,
      [project.id]
    ),
    query<{
      id: number;
      source_name: string;
      source_category: string;
      target_name: string;
      target_category: string;
      relation_type: string;
      required: number;
      rationale: string | null;
    }>(
      `SELECT dep.id, source.name AS source_name, source.category AS source_category,
              target.name AS target_name, target.category AS target_category,
              dep.relation_type, dep.required, dep.rationale
       FROM project_configuration_dependencies dep
       INNER JOIN project_configuration_items source ON source.id = dep.source_item_id
       INNER JOIN project_configuration_items target ON target.id = dep.target_item_id
       WHERE dep.project_id = ?
       ORDER BY source.category, source.name, target.name`,
      [project.id]
    ),
    query<{
      id: number;
      change_request_id: number;
      change_code: string;
      request_title: string;
      request_status: string;
      item_name: string;
      impact_type: string;
      status: string;
      old_version: number;
      new_version: number | null;
      updated_at: string;
    }>(
      `SELECT cri.id, cri.change_request_id, cr.change_code, cr.title AS request_title,
              cr.status AS request_status, pci.name AS item_name, cri.impact_type,
              cri.status, cri.old_version, cri.new_version, cri.updated_at
       FROM change_request_configuration_impacts cri
       INNER JOIN change_requests cr ON cr.id = cri.change_request_id
       INNER JOIN project_configuration_items pci ON pci.id = cri.configuration_item_id
       WHERE cr.project_id = ? AND cr.status <> 'CLOSED_APPROVED'
       ORDER BY FIELD(cri.status, 'PENDING', 'CHANGED', 'NO_CHANGE'), cr.updated_at DESC`,
      [project.id]
    )
  ]);

  const pending = impacts.filter((impact) => impact.status === "PENDING").length;
  const changed = impacts.filter((impact) => impact.status === "CHANGED").length;
  const categories = new Set(items.map((item) => item.category)).size;

  return (
    <AppShell>
      <section className="grid grid-4">
        <div className="metric">
          <span>Metodologia</span>
          <strong>{methodologyLabel(project.methodology)}</strong>
        </div>
        <div className="metric">
          <span>ECS activos</span>
          <strong>{items.length}</strong>
        </div>
        <div className="metric">
          <span>Categorias</span>
          <strong>{categories}</strong>
        </div>
        <div className="metric">
          <span>Impactos pendientes</span>
          <strong>{pending}</strong>
        </div>
      </section>

      <Panel title="Elementos de configuracion" eyebrow="Versiones del proyecto">
        {items.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Elemento</th>
                  <th>Categoria</th>
                  <th>Version</th>
                  <th>Actualizacion</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td>{item.category}</td>
                    <td>V{item.current_version}</td>
                    <td>{formatDateTime(item.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Sin ECS">El proyecto no tiene elementos de configuracion registrados.</EmptyState>
        )}
      </Panel>

      <Panel title="Relaciones de impacto" eyebrow="Si cambia origen, revisar destino">
        {dependencies.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Origen</th>
                  <th>Destino</th>
                  <th>Relacion</th>
                  <th>Tipo</th>
                  <th>Razon</th>
                </tr>
              </thead>
              <tbody>
                {dependencies.map((dependency) => (
                  <tr key={dependency.id}>
                    <td>
                      <strong>{dependency.source_name}</strong>
                      <span className="muted">{dependency.source_category}</span>
                    </td>
                    <td>
                      <strong>{dependency.target_name}</strong>
                      <span className="muted">{dependency.target_category}</span>
                    </td>
                    <td>{dependency.relation_type}</td>
                    <td>{dependency.required ? "Obligatoria" : "Recomendada"}</td>
                    <td>{dependency.rationale || "Relacion SCM"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Sin relaciones">La seleccion actual no genero dependencias automaticas.</EmptyState>
        )}
      </Panel>

      <Panel title="Impactos activos" eyebrow="Solicitudes en curso">
        {impacts.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Solicitud</th>
                  <th>Elemento</th>
                  <th>Impacto</th>
                  <th>Estado ECS</th>
                  <th>Version</th>
                  <th>Estado solicitud</th>
                </tr>
              </thead>
              <tbody>
                {impacts.map((impact) => {
                  const tone =
                    impact.status === "CHANGED"
                      ? "success"
                      : impact.status === "NO_CHANGE"
                        ? "neutral"
                        : "warning";

                  return (
                    <tr key={impact.id}>
                      <td>
                        <RequestLink id={impact.change_request_id} code={impact.change_code} title={impact.request_title} />
                      </td>
                      <td>{impact.item_name}</td>
                      <td>{CONFIGURATION_IMPACT_TYPE_LABELS[impact.impact_type] || impact.impact_type}</td>
                      <td>
                        <span className={`badge badge-${tone}`}>
                          {CONFIGURATION_IMPACT_STATUS_LABELS[impact.status] || impact.status}
                        </span>
                      </td>
                      <td>
                        V{impact.old_version}
                        {impact.new_version ? ` -> V${impact.new_version}` : ""}
                      </td>
                      <td>
                        <StatusBadge status={impact.request_status} compact />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Sin impactos activos">No hay solicitudes abiertas con impacto SCM.</EmptyState>
        )}
      </Panel>

      <div className="button-row">
        <Link className="button button-secondary" href="/dashboard">
          Volver al dashboard
        </Link>
        <span className="muted">ECS versionados en esta etapa: {changed}</span>
      </div>
    </AppShell>
  );
}
