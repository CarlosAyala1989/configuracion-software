"use server";

import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireProjectRole } from "@/lib/auth";
import { query, transaction } from "@/lib/db";
import { saveUploadedDocument } from "@/lib/documents";
import { clampPercent, fileValue, nullableNumber, nullableText, numberValue, textValue } from "@/lib/forms";
import { getProjectUsersByRole, notifyUsers } from "@/lib/notifications";

async function getWorkItem(id: number) {
  const rows = await query<{
    id: number;
    project_id: number;
    change_request_id: number;
    parent_work_item_id: number | null;
    type: "DEV" | "QA";
    status: string;
    title: string;
    assigned_to: number | null;
    version: number;
  }>("SELECT * FROM work_items WHERE id = ? LIMIT 1", [id]);
  return rows[0];
}

export async function createDevBacklogItemAction(formData: FormData) {
  const { user, project } = await requireProjectRole(["LIDER_TECNICO"]);
  const requestId = numberValue(formData, "request_id");
  const title = textValue(formData, "title");
  const description = textValue(formData, "description");
  if (!requestId || !title || !description) redirect("/tech-lead?error=required");

  const requests = await query<{ id: number; status: string; title: string }>(
    "SELECT id, status, title FROM change_requests WHERE id = ? AND project_id = ? LIMIT 1",
    [requestId, project.id]
  );
  const request = requests[0];
  if (!request || !["TECH_LEAD_REQUIREMENTS", "DEV_IN_PROGRESS"].includes(request.status)) {
    redirect("/tech-lead");
  }

  await transaction(async (connection) => {
    const [devInsert] = await connection.execute<ResultSetHeader>(
      `INSERT INTO work_items
       (project_id, change_request_id, type, title, description, acceptance_criteria, definition_of_done,
        assigned_to, priority, story_points, status, created_by)
       VALUES (?, ?, 'DEV', ?, ?, ?, ?, ?, ?, ?, 'NEW', ?)`,
      [
        project.id,
        requestId,
        title,
        description,
        nullableText(formData, "acceptance_criteria"),
        nullableText(formData, "definition_of_done"),
        nullableNumber(formData, "developer_id"),
        textValue(formData, "priority", "MEDIUM"),
        nullableNumber(formData, "story_points"),
        user.id
      ]
    );

    const devWorkItemId = devInsert.insertId;
    await connection.execute(
      `INSERT INTO work_items
       (project_id, change_request_id, parent_work_item_id, type, title, description, acceptance_criteria,
        definition_of_done, assigned_to, priority, story_points, status, created_by)
       VALUES (?, ?, ?, 'QA', ?, ?, ?, ?, ?, ?, ?, 'BLOCKED', ?)`,
      [
        project.id,
        requestId,
        devWorkItemId,
        `QA - ${title}`,
        `Validar la tarjeta de desarrollo #${devWorkItemId}: ${description}`,
        nullableText(formData, "acceptance_criteria"),
        "Revisar evidencias, documentos, criterios de aceptacion y registrar aprobacion o rechazo.",
        nullableNumber(formData, "qa_id"),
        textValue(formData, "priority", "MEDIUM"),
        nullableNumber(formData, "story_points"),
        user.id
      ]
    );

    await connection.execute("UPDATE change_requests SET status = 'DEV_IN_PROGRESS' WHERE id = ?", [
      requestId
    ]);
    await connection.execute(
      `INSERT INTO audit_events (change_request_id, actor_id, action, from_status, to_status, comment)
       VALUES (?, ?, 'TL_CREA_TARJETA_DEV_QA', ?, 'DEV_IN_PROGRESS', ?)`,
      [
        requestId,
        user.id,
        request.status,
        `Tarjeta DEV #${devWorkItemId} creada y tarjeta QA referenciada automaticamente.`
      ]
    );

    const developerId = nullableNumber(formData, "developer_id");
    if (developerId) {
      await notifyUsers({
        userIds: [developerId],
        projectId: project.id,
        changeRequestId: requestId,
        workItemId: devWorkItemId,
        title: "Nueva tarjeta de desarrollo",
        body: title,
        connection
      });
    }
  });

  revalidatePath("/tech-lead");
  redirect("/tech-lead?ok=work-created");
}

export async function developerProgressAction(formData: FormData) {
  const { user, project } = await requireProjectRole(["DESARROLLADOR"]);
  const workItemId = numberValue(formData, "work_item_id");
  const item = await getWorkItem(workItemId);
  if (!item || item.project_id !== project.id || item.type !== "DEV") redirect("/developer");
  if (item.assigned_to && item.assigned_to !== user.id) redirect("/developer");
  if (!["NEW", "ACTIVE"].includes(item.status)) redirect("/developer");

  const progress = clampPercent(numberValue(formData, "progress_percent"));
  const remaining = clampPercent(numberValue(formData, "remaining_percent", 100 - progress));
  const markComplete = formData.get("mark_complete") === "on";
  const githubBranch = nullableText(formData, "github_branch");
  const workDate = textValue(formData, "work_date");
  const hoursSpent = numberValue(formData, "hours_spent");
  const todayDone = textValue(formData, "today_done");
  const tomorrowPlan = textValue(formData, "tomorrow_plan");
  const documentation = fileValue(formData, "documentation");

  if (!workDate || hoursSpent <= 0 || !todayDone || !tomorrowPlan) redirect("/developer?error=required");
  if (markComplete && (!githubBranch || !documentation)) redirect("/developer?error=complete-doc");

  await transaction(async (connection) => {
    await connection.execute(
      `INSERT INTO work_item_updates
       (work_item_id, user_id, work_date, hours_spent, today_done, tomorrow_plan, blockers,
        progress_percent, remaining_percent, github_branch)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        workItemId,
        user.id,
        workDate,
        hoursSpent,
        todayDone,
        tomorrowPlan,
        nullableText(formData, "blockers"),
        markComplete ? 100 : progress,
        markComplete ? 0 : remaining,
        githubBranch
      ]
    );

    await saveUploadedDocument({
      file: documentation,
      projectId: project.id,
      changeRequestId: item.change_request_id,
      workItemId,
      uploadedBy: user.id,
      docType: "DEV_DOCUMENTATION",
      connection
    });

    if (markComplete) {
      await connection.execute(
        `UPDATE work_items
         SET status = 'COMPLETED', progress_percent = 100, remaining_percent = 0, github_branch = ?, completed_at = NOW()
         WHERE id = ?`,
        [githubBranch, workItemId]
      );
      await connection.execute(
        "UPDATE work_items SET status = 'QA_READY' WHERE parent_work_item_id = ? AND type = 'QA'",
        [workItemId]
      );
      await connection.execute(
        "UPDATE change_requests SET status = 'QA_WAITING' WHERE id = ?",
        [item.change_request_id]
      );
      await connection.execute(
        `INSERT INTO audit_events (change_request_id, actor_id, action, from_status, to_status, comment)
         VALUES (?, ?, 'DEV_COMPLETA_TARJETA', 'DEV_IN_PROGRESS', 'QA_WAITING', ?)`,
        [item.change_request_id, user.id, `Tarjeta DEV #${workItemId} completada.`]
      );

      const qaUsers = await getProjectUsersByRole(project.id, "QA");
      await notifyUsers({
        userIds: qaUsers.map((qa) => qa.id),
        projectId: project.id,
        changeRequestId: item.change_request_id,
        workItemId,
        title: "Tarjeta lista para QA",
        body: item.title,
        connection
      });
    } else {
      await connection.execute(
        `UPDATE work_items
         SET status = 'ACTIVE', progress_percent = ?, remaining_percent = ?, github_branch = ?
         WHERE id = ?`,
        [progress, remaining, githubBranch, workItemId]
      );
    }
  });

  revalidatePath("/developer");
  redirect("/developer?ok=progress");
}

export async function qaReviewAction(formData: FormData) {
  const { user, project } = await requireProjectRole(["QA"]);
  const qaWorkItemId = numberValue(formData, "qa_work_item_id");
  const verdict = textValue(formData, "verdict");
  const comments = textValue(formData, "comments");
  const evidence = fileValue(formData, "evidence");
  const qaItem = await getWorkItem(qaWorkItemId);
  if (!qaItem || qaItem.project_id !== project.id || qaItem.type !== "QA") redirect("/qa");
  if (!["QA_READY", "QA_ACTIVE"].includes(qaItem.status)) redirect("/qa");
  if (!["approve", "reject"].includes(verdict)) redirect("/qa");
  if (!comments || !evidence) redirect("/qa?error=evidence");

  const devItem = qaItem.parent_work_item_id ? await getWorkItem(qaItem.parent_work_item_id) : null;
  if (!devItem) redirect("/qa");

  await transaction(async (connection) => {
    const nextStatus = verdict === "approve" ? "QA_APPROVED" : "BLOCKED";
    await connection.execute(
      `INSERT INTO qa_reviews (qa_work_item_id, dev_work_item_id, reviewer_id, verdict, comments, version)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        qaWorkItemId,
        devItem.id,
        user.id,
        verdict === "approve" ? "APPROVED" : "REJECTED",
        comments,
        qaItem.version
      ]
    );

    await saveUploadedDocument({
      file: evidence,
      projectId: project.id,
      changeRequestId: qaItem.change_request_id,
      workItemId: qaWorkItemId,
      uploadedBy: user.id,
      docType: "QA_EVIDENCE",
      connection
    });

    if (verdict === "approve") {
      await connection.execute("UPDATE work_items SET status = 'QA_APPROVED' WHERE id = ?", [
        qaWorkItemId
      ]);

      const [pendingRows] = await connection.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS pending
         FROM work_items
         WHERE change_request_id = ? AND type = 'QA' AND status <> 'QA_APPROVED'`,
        [qaItem.change_request_id]
      );
      const pending = Number(pendingRows[0]?.pending || 0);
      if (pending === 0) {
        await connection.execute(
          "UPDATE change_requests SET status = 'TECH_LEAD_REVIEW' WHERE id = ?",
          [qaItem.change_request_id]
        );
        const leads = await getProjectUsersByRole(project.id, "LIDER_TECNICO");
        await notifyUsers({
          userIds: leads.map((lead) => lead.id),
          projectId: project.id,
          changeRequestId: qaItem.change_request_id,
          workItemId: qaWorkItemId,
          title: "QA aprobo todas las tarjetas",
          body: qaItem.title,
          connection
        });
      }

      await connection.execute(
        `INSERT INTO audit_events (change_request_id, actor_id, action, from_status, to_status, comment)
         VALUES (?, ?, 'QA_APRUEBA', 'QA_WAITING', 'TECH_LEAD_REVIEW', ?)`,
        [qaItem.change_request_id, user.id, comments]
      );
    } else {
      await connection.execute(
        `UPDATE work_items
         SET status = ?, version = version + 1
         WHERE id = ?`,
        [nextStatus, qaWorkItemId]
      );
      await connection.execute(
        `UPDATE work_items
         SET status = 'ACTIVE', completed_at = NULL, version = version + 1, remaining_percent = GREATEST(remaining_percent, 10)
         WHERE id = ?`,
        [devItem.id]
      );
      await connection.execute(
        `UPDATE change_requests
         SET status = 'QA_REJECTED_DEV_REWORK', current_version = current_version + 1
         WHERE id = ?`,
        [qaItem.change_request_id]
      );
      await connection.execute(
        `INSERT INTO audit_events (change_request_id, actor_id, action, from_status, to_status, comment)
         VALUES (?, ?, 'QA_RECHAZA', 'QA_WAITING', 'QA_REJECTED_DEV_REWORK', ?)`,
        [qaItem.change_request_id, user.id, comments]
      );

      if (devItem.assigned_to) {
        await notifyUsers({
          userIds: [devItem.assigned_to],
          projectId: project.id,
          changeRequestId: qaItem.change_request_id,
          workItemId: devItem.id,
          title: "QA rechazo la tarjeta",
          body: comments,
          connection
        });
      }
    }
  });

  revalidatePath("/qa");
  redirect("/qa?ok=review");
}

export async function tlSendToPmAction(formData: FormData) {
  const { user, project } = await requireProjectRole(["LIDER_TECNICO"]);
  const requestId = numberValue(formData, "request_id");
  const comment = textValue(formData, "comment");
  const rows = await query<{ id: number; status: string; title: string }>(
    "SELECT id, status, title FROM change_requests WHERE id = ? AND project_id = ? LIMIT 1",
    [requestId, project.id]
  );
  const request = rows[0];
  if (!request || request.status !== "TECH_LEAD_REVIEW") redirect("/tech-lead");
  const pendingImpacts = await query<{ total: number }>(
    `SELECT COUNT(*) AS total
     FROM change_request_configuration_impacts
     WHERE change_request_id = ? AND status = 'PENDING'`,
    [requestId]
  );
  if (Number(pendingImpacts[0]?.total || 0) > 0) redirect("/tech-lead?error=config-impacts");

  await transaction(async (connection) => {
    await connection.execute(
      "UPDATE change_requests SET status = 'PM_FINAL_REVIEW' WHERE id = ?",
      [requestId]
    );
    await connection.execute(
      `INSERT INTO audit_events (change_request_id, actor_id, action, from_status, to_status, comment)
       VALUES (?, ?, 'TL_ENVIA_PM', 'TECH_LEAD_REVIEW', 'PM_FINAL_REVIEW', ?)`,
      [requestId, user.id, comment || "Revision tecnica finalizada."]
    );
    const pms = await getProjectUsersByRole(project.id, "JEFE_PROYECTO");
    await notifyUsers({
      userIds: pms.map((pm) => pm.id),
      projectId: project.id,
      changeRequestId: requestId,
      title: "Cambio listo para revision PM",
      body: request.title,
      connection
    });
  });

  revalidatePath("/tech-lead");
  redirect("/tech-lead?ok=sent-pm");
}
