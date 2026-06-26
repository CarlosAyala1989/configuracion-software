"use server";

import { ResultSetHeader } from "mysql2/promise";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { canUseRole, getActiveProject, requireProjectRole, requireUser } from "@/lib/auth";
import {
  configurationItemIdsFromForm,
  createChangeRequestConfigurationImpacts,
  projectConfigurationItemCount
} from "@/lib/configuration-server";
import { query, transaction } from "@/lib/db";
import { saveUploadedDocument } from "@/lib/documents";
import { fileValue, nullableNumber, nullableText, numberValue, textValue } from "@/lib/forms";
import { getProjectUsersByRole, notifyUsers } from "@/lib/notifications";

async function getRequestForUpdate(id: number) {
  const rows = await query<{ id: number; project_id: number; requester_id: number; status: string; title: string }>(
    "SELECT id, project_id, requester_id, status, title FROM change_requests WHERE id = ? LIMIT 1",
    [id]
  );
  return rows[0];
}

function hasDetailedRequestFields(formData: FormData) {
  return [
    "title",
    "summary",
    "business_reason",
    "affected_area",
    "functional_scope",
    "acceptance_criteria",
    "impact_analysis",
    "rollback_plan"
  ].every((field) => textValue(formData, field).length > 0);
}

export async function createChangeRequestAction(formData: FormData) {
  const { user, project, role } = await requireProjectRole(["SOLICITANTE"]);
  if (!project || !canUseRole(user, role, ["SOLICITANTE"])) redirect("/dashboard");

  const title = textValue(formData, "title");
  const summary = textValue(formData, "summary");
  const businessReason = textValue(formData, "business_reason");
  const configurationItemIds = configurationItemIdsFromForm(formData);
  if (!title || !summary || !businessReason || !hasDetailedRequestFields(formData)) {
    redirect("/requests?error=required");
  }
  if ((await projectConfigurationItemCount(project.id)) > 0 && configurationItemIds.length === 0) {
    redirect("/requests?error=required");
  }

  await transaction(async (connection) => {
    const [insert] = await connection.execute<ResultSetHeader>(
      `INSERT INTO change_requests
       (change_code, project_id, requester_id, title, summary, business_reason, affected_area,
        priority, risk_level, budget_impact, requested_deadline, functional_scope, technical_context,
        acceptance_criteria, impact_analysis, rollback_plan, status)
       VALUES ('PENDING', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PM_REVIEW')`,
      [
        project.id,
        user.id,
        title,
        summary,
        businessReason,
        nullableText(formData, "affected_area"),
        textValue(formData, "priority", "MEDIUM"),
        textValue(formData, "risk_level", "MEDIUM"),
        nullableNumber(formData, "budget_impact"),
        nullableText(formData, "requested_deadline"),
        nullableText(formData, "functional_scope"),
        nullableText(formData, "technical_context"),
        nullableText(formData, "acceptance_criteria"),
        nullableText(formData, "impact_analysis"),
        nullableText(formData, "rollback_plan")
      ]
    );

    const requestId = insert.insertId;
    const changeCode = `SGCS-${String(requestId).padStart(5, "0")}`;
    await connection.execute("UPDATE change_requests SET change_code = ? WHERE id = ?", [
      changeCode,
      requestId
    ]);
    await createChangeRequestConfigurationImpacts(connection, {
      projectId: project.id,
      changeRequestId: requestId,
      selectedItemIds: configurationItemIds
    });

    await connection.execute(
      `INSERT INTO audit_events (change_request_id, actor_id, action, from_status, to_status, comment)
       VALUES (?, ?, 'SOLICITUD_CREADA', NULL, 'PM_REVIEW', ?)`,
      [requestId, user.id, "Solicitud enviada al jefe de proyectos."]
    );

    await saveUploadedDocument({
      file: fileValue(formData, "attachment"),
      projectId: project.id,
      changeRequestId: requestId,
      uploadedBy: user.id,
      docType: "REQUEST_ATTACHMENT",
      connection
    });

    const pms = await getProjectUsersByRole(project.id, "JEFE_PROYECTO");
    await notifyUsers({
      userIds: pms.map((pm) => pm.id),
      projectId: project.id,
      changeRequestId: requestId,
      title: `Nueva solicitud ${changeCode}`,
      body: title,
      connection
    });
  });

  revalidatePath("/requests");
  redirect("/requests?ok=request-created");
}

export async function requesterResubmitAction(formData: FormData) {
  const user = await requireUser();
  const { project, role } = await getActiveProject(user);
  if (!project || !canUseRole(user, role, ["SOLICITANTE"])) redirect("/dashboard");

  const requestId = numberValue(formData, "request_id");
  const request = await getRequestForUpdate(requestId);
  if (!request || request.project_id !== project.id) redirect("/requests");
  if (request.requester_id !== user.id) redirect("/requests");
  if (!["REQUESTER_NEGOTIATION"].includes(request.status)) redirect("/requests");

  const comment = textValue(formData, "comment");
  const configurationItemIds = configurationItemIdsFromForm(formData);
  if (!comment || !hasDetailedRequestFields(formData)) redirect(`/requests/${requestId}?error=required`);
  if ((await projectConfigurationItemCount(project.id)) > 0 && configurationItemIds.length === 0) {
    redirect(`/requests/${requestId}?error=required`);
  }

  await transaction(async (connection) => {
    await connection.execute(
      `UPDATE change_requests
       SET title = ?, summary = ?, business_reason = ?, affected_area = ?, priority = ?, risk_level = ?,
           budget_impact = ?, requested_deadline = ?, functional_scope = ?, technical_context = ?,
           acceptance_criteria = ?, impact_analysis = ?, rollback_plan = ?, status = 'PM_REVIEW',
           current_version = current_version + 1
       WHERE id = ?`,
      [
        textValue(formData, "title"),
        textValue(formData, "summary"),
        textValue(formData, "business_reason"),
        nullableText(formData, "affected_area"),
        textValue(formData, "priority", "MEDIUM"),
        textValue(formData, "risk_level", "MEDIUM"),
        nullableNumber(formData, "budget_impact"),
        nullableText(formData, "requested_deadline"),
        nullableText(formData, "functional_scope"),
        nullableText(formData, "technical_context"),
        nullableText(formData, "acceptance_criteria"),
        nullableText(formData, "impact_analysis"),
        nullableText(formData, "rollback_plan"),
        requestId
      ]
    );

    await connection.execute(
      `INSERT INTO audit_events (change_request_id, actor_id, action, from_status, to_status, comment)
       VALUES (?, ?, 'SOLICITANTE_REENVIA', ?, 'PM_REVIEW', ?)`,
      [requestId, user.id, request.status, comment || "Solicitud ajustada y reenviada."]
    );
    await connection.execute(
      "DELETE FROM change_request_configuration_impacts WHERE change_request_id = ?",
      [requestId]
    );
    await createChangeRequestConfigurationImpacts(connection, {
      projectId: project.id,
      changeRequestId: requestId,
      selectedItemIds: configurationItemIds
    });

    await saveUploadedDocument({
      file: fileValue(formData, "attachment"),
      projectId: project.id,
      changeRequestId: requestId,
      uploadedBy: user.id,
      docType: "REQUEST_ATTACHMENT",
      connection
    });

    const pms = await getProjectUsersByRole(project.id, "JEFE_PROYECTO");
    await notifyUsers({
      userIds: pms.map((pm) => pm.id),
      projectId: project.id,
      changeRequestId: requestId,
      title: "Solicitud reenviada",
      body: request.title,
      connection
    });
  });

  revalidatePath(`/requests/${requestId}`);
  redirect(`/requests/${requestId}?ok=resubmitted`);
}

export async function pmDecisionAction(formData: FormData) {
  const { user, project } = await requireProjectRole(["JEFE_PROYECTO"]);
  const requestId = numberValue(formData, "request_id");
  const decision = textValue(formData, "decision");
  const comment = textValue(formData, "comment");
  const request = await getRequestForUpdate(requestId);

  if (!request || request.project_id !== project.id) redirect("/pm");
  if (!["approve", "reject", "ccb"].includes(decision)) redirect("/pm");
  if (decision === "reject" && !comment) redirect("/pm?error=comment");

  const fromStatus = request.status;
  let toStatus = "PM_REVIEW";
  let action = "PM_DECISION";
  if (decision === "approve") {
    if (!["PM_REVIEW", "CCB_APPROVED_TO_PM"].includes(fromStatus)) redirect("/pm");
    toStatus = "TECH_LEAD_REQUIREMENTS";
    action = "PM_APRUEBA";
  }
  if (decision === "reject") {
    toStatus = "REQUESTER_NEGOTIATION";
    action = "PM_RECHAZA";
  }
  if (decision === "ccb") {
    toStatus = "CCB_REVIEW";
    action = "PM_ESCALA_CCB";
  }

  await transaction(async (connection) => {
    await connection.execute("UPDATE change_requests SET status = ? WHERE id = ?", [toStatus, requestId]);
    await connection.execute(
      `INSERT INTO audit_events (change_request_id, actor_id, action, from_status, to_status, comment)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [requestId, user.id, action, fromStatus, toStatus, comment]
    );

    if (toStatus === "TECH_LEAD_REQUIREMENTS") {
      const leads = await getProjectUsersByRole(project.id, "LIDER_TECNICO");
      await notifyUsers({
        userIds: leads.map((lead) => lead.id),
        projectId: project.id,
        changeRequestId: requestId,
        title: "Solicitud aprobada para backlog",
        body: request.title,
        connection
      });
    }

    if (toStatus === "REQUESTER_NEGOTIATION") {
      await notifyUsers({
        userIds: [request.requester_id],
        projectId: project.id,
        changeRequestId: requestId,
        title: "Solicitud observada por PM",
        body: comment || request.title,
        connection
      });
    }

    if (toStatus === "CCB_REVIEW") {
      const members = await getProjectUsersByRole(project.id, "CCB");
      await notifyUsers({
        userIds: members.map((member) => member.id),
        projectId: project.id,
        changeRequestId: requestId,
        title: "Solicitud escalada al CCB",
        body: request.title,
        connection
      });
    }
  });

  revalidatePath("/pm");
  redirect("/pm?ok=decision");
}

export async function ccbDecisionAction(formData: FormData) {
  const { user, project } = await requireProjectRole(["CCB"]);
  const requestId = numberValue(formData, "request_id");
  const decision = textValue(formData, "decision");
  const comment = textValue(formData, "comment");
  const document = fileValue(formData, "document");
  const request = await getRequestForUpdate(requestId);

  if (!request || request.project_id !== project.id || request.status !== "CCB_REVIEW") redirect("/ccb");
  if (!["approve", "reject"].includes(decision) || !document || !comment) redirect("/ccb?error=document");

  const toStatus = decision === "approve" ? "CCB_APPROVED_TO_PM" : "REQUESTER_NEGOTIATION";
  const action = decision === "approve" ? "CCB_APRUEBA" : "CCB_RECHAZA";

  await transaction(async (connection) => {
    await connection.execute("UPDATE change_requests SET status = ? WHERE id = ?", [toStatus, requestId]);
    await connection.execute(
      `INSERT INTO audit_events (change_request_id, actor_id, action, from_status, to_status, comment)
       VALUES (?, ?, ?, 'CCB_REVIEW', ?, ?)`,
      [requestId, user.id, action, toStatus, comment]
    );
    await saveUploadedDocument({
      file: document,
      projectId: project.id,
      changeRequestId: requestId,
      uploadedBy: user.id,
      docType: "CCB_DECISION",
      connection
    });

    const pms = await getProjectUsersByRole(project.id, "JEFE_PROYECTO");
    await notifyUsers({
      userIds: decision === "approve" ? pms.map((pm) => pm.id) : [request.requester_id],
      projectId: project.id,
      changeRequestId: requestId,
      title: decision === "approve" ? "CCB aprobo la solicitud" : "CCB rechazo la solicitud",
      body: comment || request.title,
      connection
    });
  });

  revalidatePath("/ccb");
  redirect("/ccb?ok=decision");
}

export async function pmSendToRequesterAction(formData: FormData) {
  const { user, project } = await requireProjectRole(["JEFE_PROYECTO"]);
  const requestId = numberValue(formData, "request_id");
  const comment = textValue(formData, "comment");
  const request = await getRequestForUpdate(requestId);
  if (!request || request.project_id !== project.id || request.status !== "PM_FINAL_REVIEW") redirect("/pm");

  await transaction(async (connection) => {
    await connection.execute("UPDATE change_requests SET status = 'REQUESTER_VALIDATION' WHERE id = ?", [
      requestId
    ]);
    await connection.execute(
      `INSERT INTO audit_events (change_request_id, actor_id, action, from_status, to_status, comment)
       VALUES (?, ?, 'PM_ENVIA_SOLICITANTE', 'PM_FINAL_REVIEW', 'REQUESTER_VALIDATION', ?)`,
      [requestId, user.id, comment || "Cambio enviado al solicitante para validacion final."]
    );
    await notifyUsers({
      userIds: [request.requester_id],
      projectId: project.id,
      changeRequestId: requestId,
      title: "Cambio listo para validacion",
      body: request.title,
      connection
    });
  });

  revalidatePath("/pm");
  redirect("/pm?ok=sent-requester");
}

export async function requesterFinalDecisionAction(formData: FormData) {
  const user = await requireUser();
  const { project, role } = await getActiveProject(user);
  if (!project || !canUseRole(user, role, ["SOLICITANTE"])) redirect("/dashboard");

  const requestId = numberValue(formData, "request_id");
  const decision = textValue(formData, "decision");
  const comment = textValue(formData, "comment");
  const request = await getRequestForUpdate(requestId);
  if (!request || request.project_id !== project.id || request.status !== "REQUESTER_VALIDATION") {
    redirect("/requests");
  }
  if (request.requester_id !== user.id) redirect("/requests");
  if (decision !== "approve" && !comment) redirect(`/requests/${requestId}?error=comment`);

  await transaction(async (connection) => {
    if (decision === "approve") {
      await connection.execute(
        "UPDATE change_requests SET status = 'CLOSED_APPROVED', closed_at = NOW() WHERE id = ?",
        [requestId]
      );
      await connection.execute(
        `INSERT INTO audit_events (change_request_id, actor_id, action, from_status, to_status, comment)
         VALUES (?, ?, 'SOLICITANTE_APRUEBA_FINAL', 'REQUESTER_VALIDATION', 'CLOSED_APPROVED', ?)`,
        [requestId, user.id, comment || "Cambio aprobado por el solicitante."]
      );
    } else {
      await connection.execute(
        `UPDATE change_requests
         SET status = 'PM_REVIEW', current_version = current_version + 1
         WHERE id = ?`,
        [requestId]
      );
      await connection.execute(
        `INSERT INTO audit_events (change_request_id, actor_id, action, from_status, to_status, comment)
         VALUES (?, ?, 'SOLICITANTE_OBSERVA_FINAL', 'REQUESTER_VALIDATION', 'PM_REVIEW', ?)`,
        [requestId, user.id, comment]
      );
      await saveUploadedDocument({
        file: fileValue(formData, "document"),
        projectId: project.id,
        changeRequestId: requestId,
        uploadedBy: user.id,
        docType: "FINAL_OBSERVATION",
        connection
      });

      const pms = await getProjectUsersByRole(project.id, "JEFE_PROYECTO");
      await notifyUsers({
        userIds: pms.map((pm) => pm.id),
        projectId: project.id,
        changeRequestId: requestId,
        title: "Solicitante observo el cambio final",
        body: comment || request.title,
        connection
      });
    }
  });

  revalidatePath(`/requests/${requestId}`);
  redirect(`/requests/${requestId}?ok=final-decision`);
}

export async function resolveConfigurationImpactAction(formData: FormData) {
  const user = await requireUser();
  const { project } = await getActiveProject(user);
  const impactId = numberValue(formData, "impact_id");
  const resolution = textValue(formData, "resolution");
  const deliverableNotes = textValue(formData, "deliverable_notes");
  const deliverable = fileValue(formData, "deliverable");
  if (!impactId || !["changed", "no_change"].includes(resolution)) redirect("/requests");

  const rows = await query<{
    id: number;
    status: string;
    change_request_id: number;
    configuration_item_id: number;
    project_id: number;
    request_status: string;
    item_name: string;
    current_version: number;
  }>(
    `SELECT cri.id, cri.status, cri.change_request_id, cri.configuration_item_id,
            cr.project_id, cr.status AS request_status,
            pci.name AS item_name, pci.current_version
     FROM change_request_configuration_impacts cri
     INNER JOIN change_requests cr ON cr.id = cri.change_request_id
     INNER JOIN project_configuration_items pci ON pci.id = cri.configuration_item_id
     WHERE cri.id = ?
     LIMIT 1`,
    [impactId]
  );
  const impact = rows[0];
  if (!impact) redirect("/requests");
  if (!user.is_admin && project?.id !== impact.project_id) redirect("/dashboard");
  if (impact.request_status === "CLOSED_APPROVED") {
    redirect(`/requests/${impact.change_request_id}`);
  }
  if (impact.status === "CHANGED") {
    redirect(`/requests/${impact.change_request_id}`);
  }
  if (!deliverableNotes) {
    redirect(`/requests/${impact.change_request_id}?error=config-deliverable`);
  }
  if (resolution === "changed" && !deliverable) {
    redirect(`/requests/${impact.change_request_id}?error=config-deliverable`);
  }

  await transaction(async (connection) => {
    if (resolution === "changed") {
      const oldVersion = Number(impact.current_version || 1);
      const newVersion = oldVersion + 1;
      const documentId = await saveUploadedDocument({
        file: deliverable,
        projectId: impact.project_id,
        changeRequestId: impact.change_request_id,
        uploadedBy: user.id,
        docType: "CONFIGURATION_DELIVERABLE",
        connection
      });
      await connection.execute(
        "UPDATE project_configuration_items SET current_version = ? WHERE id = ?",
        [newVersion, impact.configuration_item_id]
      );
      await connection.execute(
        `UPDATE change_request_configuration_impacts
         SET status = 'CHANGED', old_version = ?, new_version = ?,
             deliverable_notes = ?, document_id = ?, resolved_by = ?, resolved_at = NOW()
         WHERE id = ?`,
        [oldVersion, newVersion, deliverableNotes, documentId, user.id, impact.id]
      );
      await connection.execute(
        `INSERT INTO audit_events (change_request_id, actor_id, action, from_status, to_status, comment)
         VALUES (?, ?, 'ECS_VERSIONADO', ?, ?, ?)`,
        [
          impact.change_request_id,
          user.id,
          impact.request_status,
          impact.request_status,
          `${impact.item_name}: V${oldVersion} -> V${newVersion}. ${deliverableNotes}`
        ]
      );
    } else {
      await connection.execute(
        `UPDATE change_request_configuration_impacts
         SET status = 'NO_CHANGE', new_version = NULL, deliverable_notes = ?, resolved_by = ?, resolved_at = NOW()
         WHERE id = ?`,
        [deliverableNotes, user.id, impact.id]
      );
      await connection.execute(
        `INSERT INTO audit_events (change_request_id, actor_id, action, from_status, to_status, comment)
         VALUES (?, ?, 'ECS_SIN_CAMBIO', ?, ?, ?)`,
        [
          impact.change_request_id,
          user.id,
          impact.request_status,
          impact.request_status,
          `${impact.item_name}: no requiere incremento de version. ${deliverableNotes}`
        ]
      );
    }
  });

  revalidatePath(`/requests/${impact.change_request_id}`);
  revalidatePath("/configuration");
  redirect(`/requests/${impact.change_request_id}?ok=config-impact`);
}
