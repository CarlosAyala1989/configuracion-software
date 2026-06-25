import Link from "next/link";

import { qaReviewAction } from "@/app/actions/work-items";
import { AppShell } from "@/components/AppShell";
import { EmptyState, Panel, ProgressBar, StatusBadge, TextArea } from "@/components/ui";
import { requireProjectRole } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import type { WorkItemRow } from "@/lib/types";

export default async function QaPage({
  searchParams
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { user, project } = await requireProjectRole(["QA"]);
  const params = await searchParams;

  const [items, reviews] = await Promise.all([
    query<WorkItemRow & { dev_title: string; dev_status: string; dev_branch: string | null; dev_progress: number }>(
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
    )
  ]);
  const documents = await query<{
    id: number;
    work_item_id: number | null;
    file_name: string;
    uploaded_by_name: string;
    created_at: string;
  }>(
    `SELECT d.id, d.work_item_id, d.file_name, u.name AS uploaded_by_name, d.created_at
     FROM documents d
     INNER JOIN users u ON u.id = d.uploaded_by
     WHERE d.project_id = ? AND d.doc_type = 'DEV_DOCUMENTATION'
     ORDER BY d.created_at DESC`,
    [project.id]
  );

  return (
    <AppShell>
      {params.ok ? <div className="ok-banner">Revision QA registrada.</div> : null}
      {params.error ? <div className="error-banner">La revision necesita comentarios.</div> : null}

      <Panel id="backlog-qa" title="Backlog de QA" eyebrow="Tarjetas activadas por desarrollo">
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
                <div className="detail-list">
                  <div className="detail-item">
                    <span>Tarjeta DEV</span>
                    <strong>#{item.parent_work_item_id} {item.dev_title}</strong>
                  </div>
                  <div className="detail-item">
                    <span>Estado DEV</span>
                    <StatusBadge status={item.dev_status} compact />
                  </div>
                  <div className="detail-item">
                    <span>Rama GitHub</span>
                    <strong>{item.dev_branch || "Pendiente"}</strong>
                  </div>
                  <div className="detail-item">
                    <span>Avance DEV</span>
                    <strong>{item.dev_progress}%</strong>
                    <ProgressBar value={item.dev_progress} />
                  </div>
                </div>
                <p>{item.description}</p>
                <div className="doc-list">
                  {documents
                    .filter((doc) => doc.work_item_id === item.parent_work_item_id)
                    .map((doc) => (
                      <Link key={doc.id} href={`/api/documents/${doc.id}`}>
                        <span>{doc.file_name}</span>
                        <small>{doc.uploaded_by_name} · {formatDateTime(doc.created_at)}</small>
                      </Link>
                    ))}
                  {documents.some((doc) => doc.work_item_id === item.parent_work_item_id) ? null : (
                    <span className="muted">Sin documentacion DEV adjunta.</span>
                  )}
                </div>
                <form action={qaReviewAction} className="form-grid">
                  <input type="hidden" name="qa_work_item_id" value={item.id} />
                  <TextArea label="Resultado de la revision" name="comments" rows={4} required />
                  <label className="field">
                    <span>Evidencia QA (PDF, DOC, DOCX)</span>
                    <input name="evidence" type="file" accept=".pdf,.doc,.docx" />
                  </label>
                  <div className="button-row field-wide">
                    <button type="submit" name="verdict" value="approve">
                      Aprobar QA
                    </button>
                    <button className="button-danger" type="submit" name="verdict" value="reject">
                      Rechazar y devolver a DEV
                    </button>
                  </div>
                </form>
              </article>
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
