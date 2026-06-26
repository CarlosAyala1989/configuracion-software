import { AppShell } from "@/components/AppShell";
import { ProjectManager, type AdminProjectRow, type ConfigurationTemplateRow } from "@/components/admin/ProjectForm";
import { EmptyState, Panel } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";

export default async function AdminProjectsPage({
  searchParams
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const [projects, templates] = await Promise.all([
    query<AdminProjectRow>(
      `SELECT p.id, p.title, p.description, p.methodology, p.start_date, p.end_date, p.status,
              COUNT(DISTINCT cr.id) AS request_count,
              GROUP_CONCAT(DISTINCT pci.element_code ORDER BY pci.element_code SEPARATOR ',') AS item_codes
       FROM projects p
       LEFT JOIN change_requests cr ON cr.project_id = p.id
       LEFT JOIN project_configuration_items pci ON pci.project_id = p.id AND pci.active = 1
       GROUP BY p.id, p.title, p.description, p.methodology, p.start_date, p.end_date, p.status
       ORDER BY p.created_at DESC`
    ),
    query<ConfigurationTemplateRow>(
      `SELECT ct.id, ct.name, ct.methodology, ct.description,
              GROUP_CONCAT(cti.element_code ORDER BY cti.element_code SEPARATOR ',') AS item_codes
       FROM configuration_templates ct
       LEFT JOIN configuration_template_items cti ON cti.template_id = ct.id
       WHERE ct.active = 1
       GROUP BY ct.id, ct.name, ct.methodology, ct.description
       ORDER BY ct.methodology, ct.name`
    )
  ]);

  return (
    <AppShell>
      {params.ok ? <div className="ok-banner">Proyecto actualizado.</div> : null}
      {params.error ? (
        <div className="error-banner">
          {params.error === "locked"
            ? "El proyecto ya tiene solicitudes y no puede modificarse."
            : "Revisa los campos del proyecto y selecciona al menos un ECS."}
        </div>
      ) : null}

      <Panel title="Proyectos" eyebrow="Administrador">
        {projects.length ? (
          <ProjectManager projects={projects} templates={templates} />
        ) : (
          <div className="grid">
            <ProjectManager projects={projects} templates={templates} />
            <EmptyState title="Sin proyectos">Crea un proyecto para asignar roles.</EmptyState>
          </div>
        )}
      </Panel>
    </AppShell>
  );
}
