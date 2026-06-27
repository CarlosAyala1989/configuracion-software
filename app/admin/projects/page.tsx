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
              p.github_owner_login, p.github_repository, p.github_development_branch,
              (p.github_token_encrypted IS NOT NULL) AS github_configured,
              COUNT(DISTINCT cr.id) AS request_count,
              pdp.cadence AS delivery_cadence,
              COUNT(DISTINCT pd.id) AS delivery_count,
              GROUP_CONCAT(DISTINCT pci.element_code ORDER BY pci.element_code SEPARATOR ',') AS item_codes
       FROM projects p
       LEFT JOIN change_requests cr ON cr.project_id = p.id
       LEFT JOIN project_delivery_plans pdp ON pdp.project_id = p.id
       LEFT JOIN project_deliveries pd ON pd.project_id = p.id
       LEFT JOIN project_configuration_items pci ON pci.project_id = p.id AND pci.active = 1
       GROUP BY p.id, p.title, p.description, p.methodology, p.start_date, p.end_date, p.status,
                p.github_owner_login, p.github_repository, p.github_development_branch, p.github_token_encrypted,
                pdp.cadence
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
  const errorMessages: Record<string, string> = {
    "invalid-repository": "Ingresa un nombre de repositorio GitHub valido.",
    "invalid-branch": "El nombre de la rama de desarrollo no es valido.",
    "invalid-token": "El token GitHub fue rechazado.",
    "insufficient-permissions": "La API Key necesita permisos para crear el repositorio y administrar sus ramas.",
    "repository-or-branch-not-found": "No se encontro el repositorio o la rama de desarrollo con ese token.",
    "github-validation": "GitHub rechazo la configuracion. Verifica que el nombre del repositorio este disponible.",
    "github-unavailable": "GitHub no esta disponible. Intenta nuevamente.",
    "github-configuration": "No se pudo proteger o leer la credencial GitHub del proyecto."
  };

  return (
    <AppShell showProjectHeader={false}>
      {params.ok ? (
        <div className="ok-banner">
          {params.ok === "github-disabled"
            ? "Integracion GitHub desactivada."
            : params.ok === "github-updated"
              ? "Integracion GitHub verificada y guardada."
              : "Proyecto actualizado."}
        </div>
      ) : null}
      {params.error ? (
        <div className="error-banner">
          {errorMessages[params.error] ||
            (params.error === "locked"
              ? "El proyecto ya tiene solicitudes y no puede modificarse."
              : "Revisa los campos del proyecto y selecciona al menos un ECS.")}
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
