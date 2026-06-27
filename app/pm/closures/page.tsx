import Link from "next/link";

import { pmSendToRequesterAction } from "@/app/actions/requests";
import { AppShell } from "@/components/AppShell";
import { EmptyState, Panel, RequestLink, StatusBadge, TextArea } from "@/components/ui";
import { requireProjectRole } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import type { ChangeRequestRow } from "@/lib/types";

export default async function ProjectManagerClosuresPage({
  searchParams
}: {
  searchParams: Promise<{ ok?: string }>;
}) {
  const { project } = await requireProjectRole(["JEFE_PROYECTO"]);
  const params = await searchParams;
  const finalReview = await query<ChangeRequestRow>(
    `SELECT cr.*, u.name AS requester_name
     FROM change_requests cr
     INNER JOIN users u ON u.id = cr.requester_id
     WHERE cr.project_id = ? AND cr.status = 'PM_FINAL_REVIEW'
     ORDER BY cr.updated_at ASC`,
    [project.id]
  );

  return (
    <AppShell>
      {params.ok ? <div className="ok-banner">Cambio enviado al solicitante.</div> : null}

      <Panel title="Cierres PM" eyebrow="Cambios listos para validacion funcional">
        {finalReview.length ? (
          <div className="grid grid-2">
            {finalReview.map((request) => (
              <article className="work-card" key={request.id}>
                <header>
                  <div>
                    <RequestLink id={request.id} code={request.change_code} title={request.title} />
                    <p className="muted">
                      {request.requester_name} · {formatDateTime(request.updated_at)}
                    </p>
                  </div>
                  <StatusBadge status={request.status} compact />
                </header>
                <form action={pmSendToRequesterAction} className="grid">
                  <input type="hidden" name="request_id" value={request.id} />
                  <TextArea label="Mensaje para el solicitante" name="comment" rows={3} />
                  <button type="submit">Enviar a validacion del solicitante</button>
                </form>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="Sin cierres pendientes">QA y Lider Tecnico aun no liberan cambios.</EmptyState>
        )}
      </Panel>

      <Link className="button button-secondary" href="/pm">
        Volver a Revision PM
      </Link>
    </AppShell>
  );
}
