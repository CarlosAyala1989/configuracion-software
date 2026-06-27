import Link from "next/link";

import {
  DeveloperWorkCard,
  type DeveloperConfigurationImpact
} from "@/components/developer/DeveloperWorkCard";
import { AppShell } from "@/components/AppShell";
import { EmptyState, Panel } from "@/components/ui";
import { requireProjectRole } from "@/lib/auth";
import { DEVELOPER_CONFIGURATION_CODES } from "@/lib/configuration";
import { query } from "@/lib/db";
import type { WorkItemRow } from "@/lib/types";

export default async function DeveloperPage({
  searchParams
}: {
  searchParams: Promise<{ ok?: string; error?: string; item?: string }>;
}) {
  const { user, project } = await requireProjectRole(["DESARROLLADOR"]);
  const params = await searchParams;
  const placeholders = DEVELOPER_CONFIGURATION_CODES.map(() => "?").join(", ");

  const [items, impacts] = await Promise.all([
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
    query<DeveloperConfigurationImpact>(
      `SELECT cri.id, cri.change_request_id, cri.status, cri.old_version, cri.new_version,
              cri.deliverable_notes, cri.document_id,
              pci.name AS item_name, pci.category AS item_category,
              d.file_name AS document_file_name
       FROM change_request_configuration_impacts cri
       INNER JOIN project_configuration_items pci ON pci.id = cri.configuration_item_id
       LEFT JOIN documents d ON d.id = cri.document_id
       WHERE pci.project_id = ?
         AND pci.element_code IN (${placeholders})
       ORDER BY pci.category, pci.name`,
      [project.id, ...DEVELOPER_CONFIGURATION_CODES]
    )
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const openItemId = Number(params.item || 0);

  return (
    <AppShell>
      {params.ok ? <div className="ok-banner">Avance registrado correctamente.</div> : null}
      {params.error ? (
        <div className="error-banner">
          {params.error === "complete-doc"
            ? "Para completar la tarjeta debes registrar la rama y adjuntar la documentacion tecnica."
            : params.error === "config-items"
            ? "Completa todos los elementos SCM del desarrollador antes de activar QA."
            : "Revisa los datos del reporte diario."}
        </div>
      ) : null}

      <Panel title="Backlog de desarrollo" eyebrow="Desarrollador">
        {items.length ? (
          <div className="compact-work-list">
            {items.map((item) => (
              <DeveloperWorkCard
                key={item.id}
                item={item}
                impacts={impacts.filter((impact) => impact.change_request_id === item.change_request_id)}
                today={today}
                defaultOpen={openItemId === item.id}
              />
            ))}
          </div>
        ) : (
          <EmptyState title="Sin tarjetas asignadas">El lider tecnico aun no asigna trabajo de desarrollo.</EmptyState>
        )}
      </Panel>

      <Link className="button button-secondary" href="/dashboard">
        Volver al dashboard
      </Link>
    </AppShell>
  );
}
