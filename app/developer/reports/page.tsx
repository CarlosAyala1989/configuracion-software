import Link from "next/link";

import { AppShell } from "@/components/AppShell";
import { EmptyState, Panel } from "@/components/ui";
import { requireProjectRole } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDate, formatDateTime } from "@/lib/format";

export default async function DeveloperReportsPage() {
  const { user, project } = await requireProjectRole(["DESARROLLADOR"]);
  const updates = await query<{
    id: number;
    work_item_id: number;
    title: string;
    work_date: string;
    hours_spent: string;
    today_done: string;
    tomorrow_plan: string;
    blockers: string | null;
    progress_percent: number;
    remaining_percent: number;
    github_branch: string | null;
    created_at: string;
  }>(
    `SELECT wu.*, wi.title
     FROM work_item_updates wu
     INNER JOIN work_items wi ON wi.id = wu.work_item_id
     WHERE wi.project_id = ?
       AND wi.type = 'DEV'
       ${user.is_admin ? "" : "AND wu.user_id = ?"}
     ORDER BY wu.created_at DESC
     LIMIT 40`,
    user.is_admin ? [project.id] : [project.id, user.id]
  );

  return (
    <AppShell>
      <Panel title="Mis reportes recientes" eyebrow="Horas y avance">
        {updates.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tarjeta</th>
                  <th>Fecha</th>
                  <th>Horas</th>
                  <th>Avance</th>
                  <th>Restante</th>
                  <th>Hoy</th>
                  <th>Manana</th>
                  <th>Registro</th>
                </tr>
              </thead>
              <tbody>
                {updates.map((update) => (
                  <tr key={update.id}>
                    <td>#{update.work_item_id} {update.title}</td>
                    <td>{formatDate(update.work_date)}</td>
                    <td>{Number(update.hours_spent).toFixed(1)}</td>
                    <td>{update.progress_percent}%</td>
                    <td>{update.remaining_percent}%</td>
                    <td>{update.today_done}</td>
                    <td>{update.tomorrow_plan}</td>
                    <td>{formatDateTime(update.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Sin reportes">Registra tu primer avance desde una tarjeta.</EmptyState>
        )}
      </Panel>

      <Link className="button button-secondary" href="/developer">
        Volver al backlog DEV
      </Link>
    </AppShell>
  );
}
