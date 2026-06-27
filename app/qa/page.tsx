import { AppShell } from "@/components/AppShell";
import { EmptyState, Panel } from "@/components/ui";
import {
  QaWorkCard,
  type DevDocument,
  type QaConfigurationImpact,
  type QaWorkItem
} from "@/components/qa/QaWorkCard";
import { requireProjectRole } from "@/lib/auth";
import { QA_CONFIGURATION_CODES } from "@/lib/configuration";
import { query } from "@/lib/db";

export default async function QaPage({
  searchParams
}: {
  searchParams: Promise<{ ok?: string; error?: string; item?: string }>;
}) {
  const { user, project } = await requireProjectRole(["QA"]);
  const params = await searchParams;

  const qaPlaceholders = QA_CONFIGURATION_CODES.map(() => "?").join(", ");
  const [items, documents, impacts, githubRows] = await Promise.all([
    query<QaWorkItem>(
      `SELECT qa.*, u.name AS assignee_name, cr.change_code, cr.title AS request_title,
              dev.title AS dev_title, dev.status AS dev_status, dev.github_branch AS dev_branch,
              dev.progress_percent AS dev_progress
       FROM work_items qa
       INNER JOIN change_requests cr ON cr.id = qa.change_request_id
       INNER JOIN work_items dev ON dev.id = qa.parent_work_item_id
       LEFT JOIN users u ON u.id = qa.assigned_to
       WHERE qa.project_id = ?
         AND qa.type = 'QA'
         AND qa.status IN ('QA_READY','QA_ACTIVE')
         ${user.is_admin ? "" : "AND (qa.assigned_to IS NULL OR qa.assigned_to = ?)"}
       ORDER BY qa.updated_at ASC`,
      user.is_admin ? [project.id] : [project.id, user.id]
    ),
    query<DevDocument>(
      `SELECT d.id, d.work_item_id, d.file_name, u.name AS uploaded_by_name, d.created_at
       FROM documents d
       INNER JOIN users u ON u.id = d.uploaded_by
       WHERE d.project_id = ? AND d.doc_type = 'DEV_DOCUMENTATION'
       ORDER BY d.created_at DESC`,
      [project.id]
    ),
    query<QaConfigurationImpact>(
      `SELECT cri.id, cri.change_request_id, cri.status, cri.old_version, cri.new_version,
              cri.deliverable_notes, cri.document_id, pci.element_code,
              pci.name AS item_name, pci.category AS item_category, pci.current_version,
              pci.current_document_id, d.file_name AS document_file_name,
              current_doc.file_name AS current_document_file_name
       FROM change_request_configuration_impacts cri
       INNER JOIN project_configuration_items pci ON pci.id = cri.configuration_item_id
       LEFT JOIN documents d ON d.id = cri.document_id
       LEFT JOIN documents current_doc ON current_doc.id = pci.current_document_id
       WHERE pci.project_id = ?
         AND pci.element_code IN (${qaPlaceholders})
       ORDER BY pci.category, pci.name`,
      [project.id, ...QA_CONFIGURATION_CODES]
    ),
    query<{
      github_repository: string | null;
      github_development_branch: string | null;
      github_configured: number;
    }>(
      `SELECT github_repository, github_development_branch,
              (github_token_encrypted IS NOT NULL) AS github_configured
       FROM projects
       WHERE id = ?`,
      [project.id]
    )
  ]);
  const openItemId = Number(params.item || 0);
  const githubIntegration = githubRows[0]?.github_configured &&
    githubRows[0].github_repository &&
    githubRows[0].github_development_branch
    ? {
        repository: githubRows[0].github_repository,
        developmentBranch: githubRows[0].github_development_branch
      }
    : null;

  return (
    <AppShell>
      {params.ok ? <div className="ok-banner">Revision QA registrada.</div> : null}
      {params.error ? (
        <div className="error-banner">
          {params.error === "evidence"
            ? "La revision QA necesita comentarios y evidencia adjunta."
            : params.error === "config-items"
            ? "Completa todos los elementos SCM de QA antes de aprobar."
            : params.error === "github-branch-required"
            ? "La tarjeta DEV no tiene una rama GitHub registrada."
            : params.error === "merge-conflict"
            ? "GitHub detecto conflictos. Resuelve la rama antes de aprobar QA."
            : params.error === "invalid-token" || params.error === "insufficient-permissions"
            ? "La credencial GitHub del proyecto no permite realizar el merge."
            : params.error === "repository-or-branch-not-found"
            ? "GitHub no encontro el repositorio o una de las ramas."
            : params.error === "invalid-branch" || params.error === "same-branch"
            ? "La rama DEV no es valida para fusionarse."
            : params.error === "github-validation"
            ? "GitHub rechazo el merge solicitado."
            : params.error === "github-unavailable" || params.error === "github-configuration"
            ? "No se pudo usar la integracion GitHub del proyecto."
            : "La revision necesita comentarios."}
        </div>
      ) : null}

      <Panel title="Backlog de QA" eyebrow="Tarjetas activadas por desarrollo">
        {items.length ? (
          <div className="compact-work-list">
            {items.map((item) => (
              <QaWorkCard
                key={item.id}
                item={item}
                documents={documents.filter((document) => document.work_item_id === item.parent_work_item_id)}
                impacts={impacts.filter((impact) => impact.change_request_id === item.change_request_id)}
                githubIntegration={githubIntegration}
                defaultOpen={openItemId === item.id}
              />
            ))}
          </div>
        ) : (
          <EmptyState title="Sin tarjetas listas">QA se activara automaticamente cuando DEV marque completado.</EmptyState>
        )}
      </Panel>

    </AppShell>
  );
}
