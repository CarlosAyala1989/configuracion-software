import Link from "next/link";

import { AppShell } from "@/components/AppShell";
import { EmptyState, Panel } from "@/components/ui";
import { requireProjectRole } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

export default async function QaHistoryPage() {
  const { project } = await requireProjectRole(["QA"]);
  const reviews = await query<{
    id: number;
    qa_work_item_id: number;
    dev_work_item_id: number;
    qa_title: string;
    change_request_id: number;
    change_code: string;
    verdict: string;
    comments: string;
    version: number;
    reviewer_name: string;
    github_repository: string | null;
    github_merge_sha: string | null;
    github_merged_at: string | null;
    created_at: string;
  }>(
    `SELECT qr.*, qa.title AS qa_title, qa.change_request_id,
            cr.change_code, u.name AS reviewer_name, p.github_repository
     FROM qa_reviews qr
     INNER JOIN users u ON u.id = qr.reviewer_id
     INNER JOIN work_items qa ON qa.id = qr.qa_work_item_id
     INNER JOIN change_requests cr ON cr.id = qa.change_request_id
     INNER JOIN projects p ON p.id = qa.project_id
     WHERE qa.project_id = ?
     ORDER BY qr.created_at DESC
     LIMIT 40`,
    [project.id]
  );

  return (
    <AppShell>
      <Panel title="Historial QA" eyebrow="Revisiones registradas">
        {reviews.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Solicitud</th>
                  <th>Tarjeta QA</th>
                  <th>DEV</th>
                  <th>Veredicto</th>
                  <th>Version</th>
                  <th>Comentarios</th>
                  <th>Merge GitHub</th>
                  <th>Fecha</th>
                </tr>
              </thead>
              <tbody>
                {reviews.map((review) => (
                  <tr key={review.id}>
                    <td>
                      <Link href={`/requests/${review.change_request_id}`}>{review.change_code}</Link>
                    </td>
                    <td>#{review.qa_work_item_id} {review.qa_title}</td>
                    <td>#{review.dev_work_item_id}</td>
                    <td>{review.verdict}</td>
                    <td>V{review.version}</td>
                    <td>{review.comments}</td>
                    <td>
                      {review.github_repository && review.github_merge_sha ? (
                        <Link
                          href={`https://github.com/${review.github_repository}/commit/${review.github_merge_sha}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {review.github_merge_sha.slice(0, 7)}
                        </Link>
                      ) : (
                        <span className="muted">Sin merge automatico</span>
                      )}
                    </td>
                    <td>{formatDateTime(review.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Sin revisiones">Aun no registraste aprobaciones o rechazos.</EmptyState>
        )}
      </Panel>

      <Link className="button button-secondary" href="/qa">
        Volver al backlog QA
      </Link>
    </AppShell>
  );
}
