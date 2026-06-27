"use server";

import { RowDataPacket } from "mysql2/promise";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireProjectRole } from "@/lib/auth";
import { transaction } from "@/lib/db";
import { parseDeliveryCadence } from "@/lib/deliveries";
import { replaceProjectDeliveryPlan } from "@/lib/deliveries-server";
import { numberValue, textValue } from "@/lib/forms";

export async function createProjectDeliveryPlanAction(formData: FormData) {
  const { user, project } = await requireProjectRole(["LIDER_TECNICO"]);
  const cadence = parseDeliveryCadence(textValue(formData, "delivery_cadence"));
  if (!cadence) redirect("/tech-lead/backlog?error=delivery-plan");

  await transaction(async (connection) => {
    const [projects] = await connection.execute<RowDataPacket[]>(
      "SELECT start_date, end_date FROM projects WHERE id = ? FOR UPDATE",
      [project.id]
    );
    const [plans] = await connection.execute<RowDataPacket[]>(
      "SELECT project_id FROM project_delivery_plans WHERE project_id = ?",
      [project.id]
    );
    if (!projects[0] || plans.length > 0) return;

    await replaceProjectDeliveryPlan(connection, {
      projectId: project.id,
      startDate: projects[0].start_date,
      endDate: projects[0].end_date,
      cadence,
      createdBy: user.id
    });
  });

  revalidatePath("/tech-lead/backlog");
  revalidatePath("/admin/projects");
  redirect("/tech-lead/backlog?ok=delivery-plan");
}

export async function assignRequestToDeliveryAction(formData: FormData) {
  const { user, project } = await requireProjectRole(["LIDER_TECNICO"]);
  const requestId = numberValue(formData, "request_id");
  const deliveryId = numberValue(formData, "delivery_id");
  if (!requestId || !deliveryId) redirect("/tech-lead/backlog?error=delivery-required");

  let assigned = false;
  await transaction(async (connection) => {
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT cr.id, cr.status, pd.sequence_number, pd.start_date, pd.end_date
       FROM change_requests cr
       INNER JOIN project_deliveries pd ON pd.id = ? AND pd.project_id = cr.project_id
       WHERE cr.id = ?
         AND cr.project_id = ?
         AND cr.delivery_id IS NULL
         AND cr.status IN ('TECH_LEAD_REQUIREMENTS','DEV_IN_PROGRESS')
         AND pd.end_date >= CURDATE()
       FOR UPDATE`,
      [deliveryId, requestId, project.id]
    );
    const row = rows[0];
    if (!row) return;

    await connection.execute("UPDATE change_requests SET delivery_id = ? WHERE id = ?", [
      deliveryId,
      requestId
    ]);
    await connection.execute(
      `INSERT INTO audit_events (change_request_id, actor_id, action, from_status, to_status, comment)
       VALUES (?, ?, 'TL_PROGRAMA_SOLICITUD', ?, ?, ?)`,
      [
        requestId,
        user.id,
        row.status,
        row.status,
        `Entrega ${String(row.sequence_number).padStart(2, "0")}: ${row.start_date} - ${row.end_date}`
      ]
    );
    assigned = true;
  });

  if (!assigned) redirect("/tech-lead/backlog?error=delivery-required");
  revalidatePath("/tech-lead/backlog");
  revalidatePath(`/requests/${requestId}`);
  redirect("/tech-lead/backlog?ok=request-scheduled");
}
