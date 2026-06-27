import { AppShell } from "@/components/AppShell";
import { EmptyState, Panel } from "@/components/ui";
import {
  QaWorkCard,
  type DevDocument,
  type QaWorkItem
} from "@/components/qa/QaWorkCard";
import { requireProjectRole } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

export default async function QaPage({
  searchParams
}: {
  searchParams: Promise<{ ok?: string; error?: string; item?: string }>;
}) {
  const { user, project } = await requireProjectRole(["QA"]);
  const params = await searchParams;

  const [items, reviews, documents] = await Promise.all([
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
    query<{
      id: number;
      qa_work_item_id: number;
      dev_work_item_id: number;
      verdict: string;
      comments: string;
      version: number;
      reviewer_name: string;
      created_at: string;
    }>(
      `SELECT qr.*, u.name AS reviewer_name
       FROM qa_reviews qr
       INNER JOIN users u ON u.id = qr.reviewer_id
       INNER JOIN work_items wi ON wi.id = qr.qa_work_item_id
       WHERE wi.project_id = ?
       ORDER BY qr.created_at DESC
       LIMIT 20`,
      [project.id]
    ),
    query<DevDocument>(
      `SELECT d.id, d.work_item_id, d.file_name, u.name AS uploaded_by_name, d.created_at
       FROM documents d
       INNER JOIN users u ON u.id = d.uploaded_by
       WHERE d.project_id = ? AND d.doc_type = 'DEV_DOCUMENTATION'
       ORDER BY d.created_at DESC`,
      [project.id]
    )
  ]);
  const openItemId = Number(params.item || 0);

  return (
    <AppShell>
      {params.ok ? <div className="ok-banner">Revision QA registrada.</div> : null}
      {params.error ? (
        <div className="error-banner">
          {params.error === "evidence"
            ? "La revision QA necesita comentarios y evidencia adjunta."
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
                defaultOpen={openItemId === item.id}
              />
            ))}
          </div>
        ) : (
          <EmptyState title="Sin tarjetas listas">QA se activara automaticamente cuando DEV marque completado.</EmptyState>
        )}
      </Panel>

      <Panel id="historial-qa" title="Historial QA">
        {reviews.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>QA</th>
                  <th>DEV</th>
                  <th>Veredicto</th>
                  <th>Version</th>
                  <th>Comentarios</th>
                  <th>Fecha</th>
                </tr>
              </thead>
              <tbody>
                {reviews.map((review) => (
                  <tr key={review.id}>
                    <td>#{review.qa_work_item_id}</td>
                    <td>#{review.dev_work_item_id}</td>
                    <td>{review.verdict}</td>
                    <td>V{review.version}</td>
                    <td>{review.comments}</td>
                    <td>{formatDateTime(review.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Sin revisiones">Aun no se registran aprobaciones o rechazos.</EmptyState>
        )}
      </Panel>
    </AppShell>
  );
}
