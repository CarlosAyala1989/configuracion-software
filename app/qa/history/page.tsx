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
    created_at: string;
  }>(
    `SELECT qr.*, qa.title AS qa_title, qa.change_request_id,
            cr.change_code, u.name AS reviewer_name
     FROM qa_reviews qr
     INNER JOIN users u ON u.id = qr.reviewer_id
     INNER JOIN work_items qa ON qa.id = qr.qa_work_item_id
     INNER JOIN change_requests cr ON cr.id = qa.change_request_id
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
