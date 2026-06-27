"use server";

import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireProjectRole } from "@/lib/auth";
import { DEVELOPER_CONFIGURATION_CODES, QA_CONFIGURATION_CODES } from "@/lib/configuration";
import {
  createDeveloperConfigurationImpacts,
  createQaConfigurationImpacts
} from "@/lib/configuration-server";
import { query, transaction } from "@/lib/db";
import { saveUploadedDocument } from "@/lib/documents";
import { clampPercent, fileValue, nullableNumber, nullableText, numberValue, textValue } from "@/lib/forms";
import {
  getProjectUsersByRole,
  markChangeRequestNotificationsRead,
  notifyUsers
} from "@/lib/notifications";

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

async function requireDeliveryPlan(projectId: number, redirectPath = "/tech-lead/backlog") {
  const plans = await query<{ project_id: number }>(
    "SELECT project_id FROM project_delivery_plans WHERE project_id = ? LIMIT 1",
    [projectId]
  );
  if (!plans[0]) redirect(`${redirectPath}?error=delivery-plan`);
}

export async function createDevBacklogItemAction(formData: FormData) {
  const { user, project } = await requireProjectRole(["LIDER_TECNICO"]);
  await requireDeliveryPlan(project.id);
  const requestId = numberValue(formData, "request_id");
  const title = textValue(formData, "title");
  const description = textValue(formData, "description");
  if (!requestId || !title || !description) redirect("/tech-lead/backlog?error=required");

  const requests = await query<{ id: number; status: string; title: string; delivery_id: number | null }>(
    "SELECT id, status, title, delivery_id FROM change_requests WHERE id = ? AND project_id = ? LIMIT 1",
    [requestId, project.id]
  );
  const request = requests[0];
  if (!request || request.status !== "TECH_LEAD_REQUIREMENTS") {
    redirect("/tech-lead/backlog");
  }
  if (!request.delivery_id) redirect("/tech-lead/backlog?error=delivery-required");

  const devWorkItemId = await transaction(async (connection) => {
    const [claim] = await connection.execute<ResultSetHeader>(
      `UPDATE change_requests
       SET status = 'DEV_IN_PROGRESS'
       WHERE id = ?
         AND project_id = ?
         AND delivery_id IS NOT NULL
         AND status = 'TECH_LEAD_REQUIREMENTS'`,
      [requestId, project.id]
    );
    if (claim.affectedRows !== 1) return null;

    await createDeveloperConfigurationImpacts(connection, project.id, requestId);
    await createQaConfigurationImpacts(connection, project.id, requestId);

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

    const createdDevWorkItemId = devInsert.insertId;
    await connection.execute(
      `INSERT INTO work_items
       (project_id, change_request_id, parent_work_item_id, type, title, description, acceptance_criteria,
        definition_of_done, assigned_to, priority, story_points, status, created_by)
       VALUES (?, ?, ?, 'QA', ?, ?, ?, ?, ?, ?, ?, 'BLOCKED', ?)`,
      [
        project.id,
        requestId,
        createdDevWorkItemId,
        `QA - ${title}`,
        `Validar la tarjeta de desarrollo #${createdDevWorkItemId}: ${description}`,
        nullableText(formData, "acceptance_criteria"),
        "Revisar evidencias, documentos, criterios de aceptacion y registrar aprobacion o rechazo.",
        nullableNumber(formData, "qa_id"),
        textValue(formData, "priority", "MEDIUM"),
        nullableNumber(formData, "story_points"),
        user.id
      ]
    );

    await markChangeRequestNotificationsRead(requestId, connection);
    await connection.execute(
      `INSERT INTO audit_events (change_request_id, actor_id, action, from_status, to_status, comment)
       VALUES (?, ?, 'TL_CREA_TARJETA_DEV_QA', ?, 'DEV_IN_PROGRESS', ?)`,
      [
        requestId,
        user.id,
        "TECH_LEAD_REQUIREMENTS",
        `Tarjeta DEV #${createdDevWorkItemId} creada y tarjeta QA referenciada automaticamente.`
      ]
    );

    const developerId = nullableNumber(formData, "developer_id");
    if (developerId) {
      await notifyUsers({
        userIds: [developerId],
        projectId: project.id,
        changeRequestId: requestId,
        workItemId: createdDevWorkItemId,
        title: "Nueva tarjeta de desarrollo",
        body: title,
        connection
      });
    }

    return createdDevWorkItemId;
  });

  if (!devWorkItemId) redirect("/tech-lead/backlog");

  revalidatePath("/tech-lead/backlog");
  revalidatePath("/tech-lead/work-items");
  redirect("/tech-lead/backlog?ok=work-created");
}

export async function developerProgressAction(formData: FormData) {
  const { user, project } = await requireProjectRole(["DESARROLLADOR"]);
  const workItemId = numberValue(formData, "work_item_id");
  const item = await getWorkItem(workItemId);
  if (!item || item.project_id !== project.id || item.type !== "DEV") redirect("/developer");
  if (item.assigned_to && item.assigned_to !== user.id) redirect("/developer");
  if (!["NEW", "ACTIVE"].includes(item.status)) redirect("/developer");

  const progress = clampPercent(numberValue(formData, "progress_percent"));
  const remaining = 100 - progress;
  const markComplete = formData.get("mark_complete") === "on";
  const githubBranch = nullableText(formData, "github_branch");
  const workDate = textValue(formData, "work_date");
  const hoursSpent = numberValue(formData, "hours_spent");
  const todayDone = textValue(formData, "today_done");
  const tomorrowPlan = textValue(formData, "tomorrow_plan");
  const documentation = fileValue(formData, "documentation");

  const placeholders = DEVELOPER_CONFIGURATION_CODES.map(() => "?").join(", ");
  const [developerImpacts, expectedItemRows] = await Promise.all([
    query<{
      id: number;
      status: string;
      configuration_item_id: number;
      item_name: string;
      current_document_id: number | null;
    }>(
      `SELECT cri.id, cri.status, cri.configuration_item_id, pci.name AS item_name,
              pci.current_document_id
       FROM change_request_configuration_impacts cri
       INNER JOIN project_configuration_items pci ON pci.id = cri.configuration_item_id
       WHERE cri.change_request_id = ?
         AND pci.element_code IN (${placeholders})
       ORDER BY pci.category, pci.name`,
      [item.change_request_id, ...DEVELOPER_CONFIGURATION_CODES]
    ),
    query<{ total: number }>(
      `SELECT COUNT(*) AS total
       FROM project_configuration_items
       WHERE project_id = ?
         AND active = 1
         AND element_code IN (${placeholders})`,
      [project.id, ...DEVELOPER_CONFIGURATION_CODES]
    )
  ]);
  const pendingImpactResolutions = developerImpacts
    .filter((impact) => impact.status === "PENDING")
    .map((impact) => ({
      ...impact,
      resolution: textValue(formData, `impact_resolution_${impact.id}`),
      notes: textValue(formData, `impact_notes_${impact.id}`),
      deliverable: fileValue(formData, `impact_file_${impact.id}`)
    }));

  if (!workDate || hoursSpent <= 0 || !todayDone || !tomorrowPlan) {
    redirect(`/developer?error=required&item=${workItemId}`);
  }
  if (markComplete && (!githubBranch || !documentation)) {
    redirect(`/developer?error=complete-doc&item=${workItemId}`);
  }
  if (
    markComplete &&
    (developerImpacts.length !== Number(expectedItemRows[0]?.total || 0) ||
      pendingImpactResolutions.some(
        (impact) =>
          !["changed", "no_change"].includes(impact.resolution) ||
          !impact.notes ||
          (impact.resolution === "changed" && !impact.deliverable) ||
          (!impact.current_document_id && impact.resolution !== "changed")
      ))
  ) {
    redirect(`/developer?error=config-items&item=${workItemId}`);
  }

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
      for (const impact of pendingImpactResolutions) {
        const [impactRows] = await connection.execute<RowDataPacket[]>(
          `SELECT cri.id, cri.status, pci.id AS configuration_item_id,
                  pci.name AS item_name, pci.current_version, pci.current_document_id
           FROM change_request_configuration_impacts cri
           INNER JOIN project_configuration_items pci ON pci.id = cri.configuration_item_id
           WHERE cri.id = ? AND cri.change_request_id = ?
           FOR UPDATE`,
          [impact.id, item.change_request_id]
        );
        const currentImpact = impactRows[0];
        if (!currentImpact || currentImpact.status !== "PENDING") continue;

        if (impact.resolution === "changed") {
          const hasBaseline = Boolean(currentImpact.current_document_id);
          const oldVersion = hasBaseline ? Number(currentImpact.current_version || 0) : 0;
          const newVersion = hasBaseline ? oldVersion + 1 : 1;
          const documentId = await saveUploadedDocument({
            file: impact.deliverable,
            projectId: project.id,
            changeRequestId: item.change_request_id,
            workItemId,
            uploadedBy: user.id,
            docType: "CONFIGURATION_DELIVERABLE",
            connection
          });
          await connection.execute(
            `UPDATE project_configuration_items
             SET current_version = ?, current_document_id = ?
             WHERE id = ?`,
            [newVersion, documentId, currentImpact.configuration_item_id]
          );
          await connection.execute(
            `UPDATE change_request_configuration_impacts
             SET status = 'CHANGED', old_version = ?, new_version = ?, deliverable_notes = ?,
                 document_id = ?, resolved_by = ?, resolved_at = NOW()
             WHERE id = ?`,
            [oldVersion, newVersion, impact.notes, documentId, user.id, impact.id]
          );
          await connection.execute(
            `INSERT INTO audit_events (change_request_id, actor_id, action, from_status, to_status, comment)
             VALUES (?, ?, 'ECS_VERSIONADO', 'DEV_IN_PROGRESS', 'DEV_IN_PROGRESS', ?)`,
            [
              item.change_request_id,
              user.id,
              `${currentImpact.item_name}: ${oldVersion ? `V${oldVersion}` : "sin entrega"} -> V${newVersion}. ${impact.notes}`
            ]
          );
        } else {
          if (!currentImpact.current_document_id) {
            throw new Error(`El elemento ${currentImpact.item_name} aun no tiene una entrega inicial.`);
          }
          await connection.execute(
            `UPDATE change_request_configuration_impacts
             SET status = 'NO_CHANGE', new_version = NULL, deliverable_notes = ?, document_id = ?,
                 resolved_by = ?, resolved_at = NOW()
             WHERE id = ?`,
            [impact.notes, currentImpact.current_document_id, user.id, impact.id]
          );
          await connection.execute(
            `INSERT INTO audit_events (change_request_id, actor_id, action, from_status, to_status, comment)
             VALUES (?, ?, 'ECS_SIN_CAMBIO', 'DEV_IN_PROGRESS', 'DEV_IN_PROGRESS', ?)`,
            [
              item.change_request_id,
              user.id,
              `${currentImpact.item_name}: no requiere incremento de version. ${impact.notes}`
            ]
          );
        }
      }

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
      await markChangeRequestNotificationsRead(item.change_request_id, connection);
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
  revalidatePath("/developer/reports");
  revalidatePath(`/requests/${item.change_request_id}`);
  revalidatePath("/configuration");
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
  if (!comments || !evidence) redirect(`/qa?error=evidence&item=${qaWorkItemId}`);

  const devItem = qaItem.parent_work_item_id ? await getWorkItem(qaItem.parent_work_item_id) : null;
  if (!devItem) redirect("/qa");

  const qaPlaceholders = QA_CONFIGURATION_CODES.map(() => "?").join(", ");
  const [qaImpacts, expectedQaItemRows] = await Promise.all([
    query<{
      id: number;
      status: string;
      configuration_item_id: number;
      element_code: string;
      item_name: string;
      current_document_id: number | null;
    }>(
      `SELECT cri.id, cri.status, cri.configuration_item_id, pci.element_code,
              pci.name AS item_name, pci.current_document_id
       FROM change_request_configuration_impacts cri
       INNER JOIN project_configuration_items pci ON pci.id = cri.configuration_item_id
       WHERE cri.change_request_id = ?
         AND pci.element_code IN (${qaPlaceholders})
       ORDER BY pci.category, pci.name`,
      [qaItem.change_request_id, ...QA_CONFIGURATION_CODES]
    ),
    query<{ total: number }>(
      `SELECT COUNT(*) AS total
       FROM project_configuration_items
       WHERE project_id = ?
         AND active = 1
         AND element_code IN (${qaPlaceholders})`,
      [project.id, ...QA_CONFIGURATION_CODES]
    )
  ]);
  const pendingQaResolutions = qaImpacts
    .filter((impact) => impact.status === "PENDING")
    .map((impact) => ({
      ...impact,
      resolution: textValue(formData, `impact_resolution_${impact.id}`),
      notes: textValue(formData, `impact_notes_${impact.id}`),
      deliverable:
        impact.element_code === "QA_EVIDENCE"
          ? evidence
          : fileValue(formData, `impact_file_${impact.id}`)
    }));

  if (
    verdict === "approve" &&
    (qaImpacts.length !== Number(expectedQaItemRows[0]?.total || 0) ||
      pendingQaResolutions.some(
        (impact) =>
          !["changed", "no_change"].includes(impact.resolution) ||
          !impact.notes ||
          (impact.resolution === "changed" && !impact.deliverable) ||
          (!impact.current_document_id && impact.resolution !== "changed")
      ))
  ) {
    redirect(`/qa?error=config-items&item=${qaWorkItemId}`);
  }

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

    const evidenceDocumentId = await saveUploadedDocument({
      file: evidence,
      projectId: project.id,
      changeRequestId: qaItem.change_request_id,
      workItemId: qaWorkItemId,
      uploadedBy: user.id,
      docType: "QA_EVIDENCE",
      connection
    });

    if (verdict === "approve") {
      if (!evidenceDocumentId) throw new Error("La evidencia QA es obligatoria.");

      for (const impact of pendingQaResolutions) {
        const [impactRows] = await connection.execute<RowDataPacket[]>(
          `SELECT cri.id, cri.status, pci.id AS configuration_item_id, pci.element_code,
                  pci.name AS item_name, pci.current_version, pci.current_document_id
           FROM change_request_configuration_impacts cri
           INNER JOIN project_configuration_items pci ON pci.id = cri.configuration_item_id
           WHERE cri.id = ? AND cri.change_request_id = ?
           FOR UPDATE`,
          [impact.id, qaItem.change_request_id]
        );
        const currentImpact = impactRows[0];
        if (!currentImpact || currentImpact.status !== "PENDING") continue;

        if (impact.resolution === "changed") {
          const hasBaseline = Boolean(currentImpact.current_document_id);
          const oldVersion = hasBaseline ? Number(currentImpact.current_version || 0) : 0;
          const newVersion = hasBaseline ? oldVersion + 1 : 1;
          const documentId =
            currentImpact.element_code === "QA_EVIDENCE"
              ? evidenceDocumentId
              : await saveUploadedDocument({
                  file: impact.deliverable,
                  projectId: project.id,
                  changeRequestId: qaItem.change_request_id,
                  workItemId: qaWorkItemId,
                  uploadedBy: user.id,
                  docType: "CONFIGURATION_DELIVERABLE",
                  connection
                });
          if (!documentId) throw new Error(`Falta el entregable de ${currentImpact.item_name}.`);

          await connection.execute(
            `UPDATE project_configuration_items
             SET current_version = ?, current_document_id = ?
             WHERE id = ?`,
            [newVersion, documentId, currentImpact.configuration_item_id]
          );
          await connection.execute(
            `UPDATE change_request_configuration_impacts
             SET status = 'CHANGED', old_version = ?, new_version = ?, deliverable_notes = ?,
                 document_id = ?, resolved_by = ?, resolved_at = NOW()
             WHERE id = ?`,
            [oldVersion, newVersion, impact.notes, documentId, user.id, impact.id]
          );
          await connection.execute(
            `INSERT INTO audit_events (change_request_id, actor_id, action, from_status, to_status, comment)
             VALUES (?, ?, 'ECS_VERSIONADO_QA', 'QA_WAITING', 'QA_WAITING', ?)`,
            [
              qaItem.change_request_id,
              user.id,
              `${currentImpact.item_name}: ${oldVersion ? `V${oldVersion}` : "sin entrega"} -> V${newVersion}. ${impact.notes}`
            ]
          );
        } else {
          if (!currentImpact.current_document_id) {
            throw new Error(`El elemento ${currentImpact.item_name} aun no tiene una entrega inicial.`);
          }
          await connection.execute(
            `UPDATE change_request_configuration_impacts
             SET status = 'NO_CHANGE', new_version = NULL, deliverable_notes = ?, document_id = ?,
                 resolved_by = ?, resolved_at = NOW()
             WHERE id = ?`,
            [impact.notes, currentImpact.current_document_id, user.id, impact.id]
          );
          await connection.execute(
            `INSERT INTO audit_events (change_request_id, actor_id, action, from_status, to_status, comment)
             VALUES (?, ?, 'ECS_REUTILIZADO_QA', 'QA_WAITING', 'QA_WAITING', ?)`,
            [
              qaItem.change_request_id,
              user.id,
              `${currentImpact.item_name}: se reutiliza V${currentImpact.current_version}. ${impact.notes}`
            ]
          );
        }
      }

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
        await markChangeRequestNotificationsRead(qaItem.change_request_id, connection);
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
      await markChangeRequestNotificationsRead(qaItem.change_request_id, connection);
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
  revalidatePath(`/requests/${qaItem.change_request_id}`);
  revalidatePath("/configuration");
  redirect("/qa?ok=review");
}

export async function tlSendToPmAction(formData: FormData) {
  const { user, project } = await requireProjectRole(["LIDER_TECNICO"]);
  await requireDeliveryPlan(project.id, "/tech-lead/release");
  const requestId = numberValue(formData, "request_id");
  const comment = textValue(formData, "comment");
  const rows = await query<{ id: number; status: string; title: string }>(
    "SELECT id, status, title FROM change_requests WHERE id = ? AND project_id = ? LIMIT 1",
    [requestId, project.id]
  );
  const request = rows[0];
  if (!request || request.status !== "TECH_LEAD_REVIEW") redirect("/tech-lead/release");
  const pendingImpacts = await query<{ total: number }>(
    `SELECT COUNT(*) AS total
     FROM change_request_configuration_impacts
     WHERE change_request_id = ? AND status = 'PENDING'`,
    [requestId]
  );
  if (Number(pendingImpacts[0]?.total || 0) > 0) redirect("/tech-lead/release?error=config-impacts");

  await transaction(async (connection) => {
    await connection.execute(
      "UPDATE change_requests SET status = 'PM_FINAL_REVIEW' WHERE id = ?",
      [requestId]
    );
    await markChangeRequestNotificationsRead(requestId, connection);
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

  revalidatePath("/tech-lead/release");
  redirect("/tech-lead/release?ok=sent-pm");
}
