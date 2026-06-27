import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/AppShell";
import { EmptyState, Panel, RequestLink, StatusBadge } from "@/components/ui";
import { canUseRole, getActiveProject, requireUser } from "@/lib/auth";
import {
  CONFIGURATION_IMPACT_STATUS_LABELS,
  CONFIGURATION_IMPACT_TYPE_LABELS,
  methodologyLabel
} from "@/lib/configuration";
import { query } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import type { ProjectRole } from "@/lib/types";

const configurationRoles: ProjectRole[] = [
  "JEFE_PROYECTO",
  "CCB",
  "LIDER_TECNICO",
  "DESARROLLADOR",
  "QA",
  "BIBLIOTECARIO"
];

export default async function ConfigurationPage() {
  const user = await requireUser();
  const { project, role } = await getActiveProject(user);

  if (!project) {
    return (
      <AppShell>
        <EmptyState title="Sin proyecto activo">Selecciona o crea un proyecto para ver sus elementos SCM.</EmptyState>
      </AppShell>
    );
  }

  if (!user.is_admin && !canUseRole(user, role, configurationRoles)) {
    redirect("/dashboard");
  }

  const [items, dependencies, impacts] = await Promise.all([
    query<{
      id: number;
      name: string;
      category: string;
      current_version: number;
      current_document_id: number | null;
      current_document_file_name: string | null;
      updated_at: string;
    }>(
      `SELECT pci.id, pci.name, pci.category, pci.current_version, pci.current_document_id,
              d.file_name AS current_document_file_name, pci.updated_at
       FROM project_configuration_items pci
       LEFT JOIN documents d ON d.id = pci.current_document_id
       WHERE pci.project_id = ? AND pci.active = 1
       ORDER BY pci.category, pci.name`,
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
                  <th>Documento vigente</th>
                  <th>Actualizacion</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td>{item.category}</td>
                    <td>{item.current_document_id ? `V${item.current_version}` : "Sin entrega"}</td>
                    <td>
                      {item.current_document_id ? (
                        <Link href={`/api/documents/${item.current_document_id}`}>
                          {item.current_document_file_name || "Ver documento vigente"}
                        </Link>
                      ) : (
                        <span className="muted">Pendiente</span>
                      )}
                    </td>
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
                        {impact.old_version ? `V${impact.old_version}` : "Sin entrega"}
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
