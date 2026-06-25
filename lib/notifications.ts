import "server-only";

import { PoolConnection } from "mysql2/promise";

import { execute, query } from "@/lib/db";
import type { ProjectRole } from "@/lib/types";

export async function notifyUsers(options: {
  userIds: number[];
  projectId?: number | null;
  changeRequestId?: number | null;
  workItemId?: number | null;
  title: string;
  body: string;
  connection?: PoolConnection;
}) {
  const unique = [...new Set(options.userIds.filter(Boolean))];
  if (unique.length === 0) return;

  const sql = `INSERT INTO notifications
    (user_id, project_id, change_request_id, work_item_id, title, body)
    VALUES (?, ?, ?, ?, ?, ?)`;

  for (const userId of unique) {
    const params = [
      userId,
      options.projectId ?? null,
      options.changeRequestId ?? null,
      options.workItemId ?? null,
      options.title,
      options.body
    ];

    if (options.connection) await options.connection.execute(sql, params);
    else await execute(sql, params);
  }
}

export async function getProjectUsersByRole(projectId: number, role: ProjectRole) {
  return query<{ id: number; name: string; email: string }>(
    `SELECT DISTINCT u.id, u.name, u.email
     FROM project_members pm
     LEFT JOIN role_definitions rd ON rd.code = pm.role
     INNER JOIN users u ON u.id = pm.user_id
     WHERE pm.project_id = ?
       AND COALESCE(rd.base_role, pm.role) = ?
       AND u.active = 1
     ORDER BY u.name`,
    [projectId, role]
  );
}

export async function getUnreadNotifications(userId: number) {
  return query<{
    id: number;
    title: string;
    body: string;
    change_request_id: number | null;
    work_item_id: number | null;
    created_at: string;
  }>(
    `SELECT id, title, body, change_request_id, work_item_id, created_at
     FROM notifications
     WHERE user_id = ? AND read_at IS NULL
     ORDER BY created_at DESC
     LIMIT 8`,
    [userId]
  );
}
