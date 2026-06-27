import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const root = process.cwd();
const envPath = path.join(root, ".env.local");

if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...valueParts] = trimmed.split("=");
    process.env[key] ??= valueParts.join("=").replace(/^["']|["']$/g, "");
  }
}

const roles = [
  "SOLICITANTE",
  "JEFE_PROYECTO",
  "CCB",
  "LIDER_TECNICO",
  "DESARROLLADOR",
  "QA",
  "BIBLIOTECARIO"
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const db = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    dateStrings: true
  });

  const runId = Date.now().toString(36);
  const userIds = {};
  const checks = [];
  let nextRequestNumber = 1;

  await db.beginTransaction();
  try {
    const [librarianRoleRows] = await db.execute(
      `SELECT code, base_role, is_system, active
       FROM role_definitions
       WHERE code = 'BIBLIOTECARIO'`
    );
    assert(
      librarianRoleRows[0]?.base_role === "BIBLIOTECARIO" &&
        Number(librarianRoleRows[0]?.is_system) === 1 &&
        Number(librarianRoleRows[0]?.active) === 1,
      "El rol Bibliotecario no esta registrado como rol predeterminado activo"
    );
    checks.push("rol_bibliotecario_predeterminado");

    for (const role of roles) {
      const [result] = await db.execute(
        "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)",
        [`Verify ${role}`, `verify-${role.toLowerCase()}-${runId}@sgcs.local`, "verify-only"]
      );
      userIds[role] = result.insertId;
    }

    const [projectResult] = await db.execute(
      `INSERT INTO projects (title, description, methodology, start_date, end_date)
       VALUES (?, ?, 'Agile / Scrum', CURDATE(), DATE_ADD(CURDATE(), INTERVAL 30 DAY))`,
      [`VERIFY SGCS ${runId}`, "Proyecto temporal de verificacion funcional"]
    );
    const projectId = projectResult.insertId;
    await db.execute(
      `INSERT INTO project_configuration_items
       (project_id, element_code, name, category, methodology)
       VALUES
       (?, 'SOURCE_CODE', 'Codigo fuente', 'Programas y codigo fuente', 'AGILE_SCRUM'),
       (?, 'QA_EVIDENCE', 'Evidencias QA', 'Elementos de calidad y pruebas', 'AGILE_SCRUM')`,
      [projectId, projectId]
    );

    for (const role of roles) {
      await db.execute("INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)", [
        projectId,
        userIds[role],
        role
      ]);
    }
    checks.push("roles_por_proyecto");

    await db.execute(
      `INSERT INTO project_delivery_plans (project_id, cadence, created_by)
       VALUES (?, 'WEEK', ?)`,
      [projectId, userIds.LIDER_TECNICO]
    );
    for (let index = 0; index < 5; index += 1) {
      const startOffset = index * 7;
      const endOffset = Math.min(startOffset + 6, 30);
      await db.execute(
        `INSERT INTO project_deliveries (project_id, sequence_number, start_date, end_date)
         VALUES (?, ?, DATE_ADD(CURDATE(), INTERVAL ? DAY), DATE_ADD(CURDATE(), INTERVAL ? DAY))`,
        [projectId, index + 1, startOffset, endOffset]
      );
    }
    const [deliveryRows] = await db.execute(
      "SELECT COUNT(*) AS total FROM project_deliveries WHERE project_id = ?",
      [projectId]
    );
    assert(Number(deliveryRows[0].total) === 5, "El plan semanal no genero las entregas esperadas");
    checks.push("plan_entregas_semanal");

    async function audit(changeId, actorRole, action, fromStatus, toStatus, comment) {
      await db.execute(
        `INSERT INTO audit_events (change_request_id, actor_id, action, from_status, to_status, comment)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [changeId, userIds[actorRole], action, fromStatus, toStatus, comment]
      );
    }

    async function setChange(changeId, actorRole, action, fromStatus, toStatus, comment) {
      await db.execute("UPDATE change_requests SET status = ? WHERE id = ?", [toStatus, changeId]);
      await db.execute(
        "UPDATE notifications SET read_at = NOW() WHERE change_request_id = ? AND read_at IS NULL",
        [changeId]
      );
      await audit(changeId, actorRole, action, fromStatus, toStatus, comment);
    }

    async function statusOf(changeId) {
      const [rows] = await db.execute("SELECT status, current_version FROM change_requests WHERE id = ?", [
        changeId
      ]);
      return rows[0];
    }

    async function createChange(suffix) {
      const requestNumber = nextRequestNumber++;
      const code = `SC - ${String(requestNumber).padStart(2, "0")}`;
      const [result] = await db.execute(
        `INSERT INTO change_requests
         (change_code, project_id, request_number, requester_id, title, summary, business_reason, affected_area,
          priority, risk_level, budget_impact, functional_scope, technical_context,
          acceptance_criteria, impact_analysis, rollback_plan, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'HIGH', 'MEDIUM', 1200.00, ?, ?, ?, ?, ?, 'PM_REVIEW')`,
        [
          code,
          projectId,
          requestNumber,
          userIds.SOLICITANTE,
          `Cambio verificado ${suffix}`,
          "Resumen detallado de verificacion",
          "Justificacion de negocio",
          "Modulo de pruebas",
          "Alcance funcional verificable",
          "Contexto tecnico para futuro GitHub",
          "Criterios de aceptacion verificables",
          "Analisis de impacto",
          "Plan de rollback"
        ]
      );
      await audit(result.insertId, "SOLICITANTE", "SOLICITUD_CREADA", null, "PM_REVIEW", code);
      await db.execute(
        `INSERT INTO notifications (user_id, project_id, change_request_id, title, body)
         VALUES (?, ?, ?, ?, ?)`,
        [userIds.JEFE_PROYECTO, projectId, result.insertId, `Nueva solicitud ${code}`, `Cambio verificado ${suffix}`]
      );
      return result.insertId;
    }

    async function createDevAndQa(changeId) {
      const [devResult] = await db.execute(
        `INSERT INTO work_items
         (project_id, change_request_id, type, title, description, acceptance_criteria,
          definition_of_done, assigned_to, priority, story_points, status, created_by)
         VALUES (?, ?, 'DEV', 'Tarjeta DEV verificada', 'Desarrollo verificable',
                 'Criterios QA', 'DoD', ?, 'HIGH', 5, 'NEW', ?)`,
        [projectId, changeId, userIds.DESARROLLADOR, userIds.LIDER_TECNICO]
      );
      const devId = devResult.insertId;
      const [qaResult] = await db.execute(
        `INSERT INTO work_items
         (project_id, change_request_id, parent_work_item_id, type, title, description,
          acceptance_criteria, definition_of_done, assigned_to, priority, story_points, status, created_by)
         VALUES (?, ?, ?, 'QA', 'QA - Tarjeta DEV verificada', 'Validacion QA referenciada',
                 'Criterios QA', 'Revisar evidencia', ?, 'HIGH', 5, 'BLOCKED', ?)`,
        [projectId, changeId, devId, userIds.QA, userIds.LIDER_TECNICO]
      );
      await db.execute(
        `INSERT INTO change_request_configuration_impacts
         (change_request_id, configuration_item_id, impact_type, reason, old_version)
         SELECT ?, id, 'DIRECT',
                IF(element_code = 'SOURCE_CODE',
                   'Elemento SCM bajo responsabilidad del desarrollador.',
                   'Elemento SCM bajo responsabilidad de QA.'),
                current_version
         FROM project_configuration_items
         WHERE project_id = ? AND element_code IN ('SOURCE_CODE', 'QA_EVIDENCE')`,
        [changeId, projectId]
      );
      await setChange(
        changeId,
        "LIDER_TECNICO",
        "TL_CREA_TARJETA_DEV_QA",
        "TECH_LEAD_REQUIREMENTS",
        "DEV_IN_PROGRESS",
        "Tarjetas DEV y QA creadas"
      );
      return { devId, qaId: qaResult.insertId };
    }

    async function completeDev(changeId, devId, qaId, fromStatus = "DEV_IN_PROGRESS") {
      const [sourceRows] = await db.execute(
        `SELECT pci.id, pci.current_version, pci.current_document_id, cri.status AS impact_status
         FROM project_configuration_items pci
         INNER JOIN change_request_configuration_impacts cri
           ON cri.configuration_item_id = pci.id AND cri.change_request_id = ?
         WHERE pci.project_id = ? AND pci.element_code = 'SOURCE_CODE'`,
        [changeId, projectId]
      );
      const source = sourceRows[0];
      if (source.impact_status !== "PENDING") {
        // El reingreso desde QA conserva la resolucion SCM ya registrada para esta solicitud.
      } else if (!source.current_document_id) {
        const [documentResult] = await db.execute(
          `INSERT INTO documents
           (project_id, change_request_id, work_item_id, uploaded_by, doc_type, file_name, mime_type, size_bytes, content)
           VALUES (?, ?, ?, ?, 'CONFIGURATION_DELIVERABLE', 'source-v1.pdf', 'application/pdf', 8, ?)`,
          [projectId, changeId, devId, userIds.DESARROLLADOR, Buffer.from("%PDF-1.4")]
        );
        await db.execute(
          "UPDATE project_configuration_items SET current_version = 1, current_document_id = ? WHERE id = ?",
          [documentResult.insertId, source.id]
        );
        await db.execute(
          `UPDATE change_request_configuration_impacts
           SET status = 'CHANGED', old_version = 0, new_version = 1,
               deliverable_notes = 'Primera entrega DEV', document_id = ?, resolved_by = ?, resolved_at = NOW()
           WHERE change_request_id = ? AND configuration_item_id = ?`,
          [documentResult.insertId, userIds.DESARROLLADOR, changeId, source.id]
        );
      } else {
        await db.execute(
          `UPDATE change_request_configuration_impacts
           SET status = 'NO_CHANGE', deliverable_notes = 'Se reutiliza documentacion DEV',
               document_id = ?, resolved_by = ?, resolved_at = NOW()
           WHERE change_request_id = ? AND configuration_item_id = ?`,
          [source.current_document_id, userIds.DESARROLLADOR, changeId, source.id]
        );
      }
      await db.execute(
        `INSERT INTO work_item_updates
         (work_item_id, user_id, work_date, hours_spent, today_done, tomorrow_plan,
          progress_percent, remaining_percent, github_branch)
         VALUES (?, ?, CURDATE(), 6.5, 'Avance verificado', 'Validacion siguiente', 100, 0, ?)`,
        [devId, userIds.DESARROLLADOR, `feature/verify-${runId}`]
      );
      await db.execute(
        `INSERT INTO documents
         (project_id, change_request_id, work_item_id, uploaded_by, doc_type, file_name, mime_type, size_bytes, content)
         VALUES (?, ?, ?, ?, 'DEV_DOCUMENTATION', 'dev-evidence.pdf', 'application/pdf', 8, ?)`,
        [projectId, changeId, devId, userIds.DESARROLLADOR, Buffer.from("%PDF-1.4")]
      );
      await db.execute(
        `UPDATE work_items
         SET status = 'COMPLETED', progress_percent = 100, remaining_percent = 0,
             github_branch = ?, completed_at = NOW()
         WHERE id = ?`,
        [`feature/verify-${runId}`, devId]
      );
      await db.execute("UPDATE work_items SET status = 'QA_READY' WHERE id = ?", [qaId]);
      await setChange(changeId, "DESARROLLADOR", "DEV_COMPLETA_TARJETA", fromStatus, "QA_WAITING", "DEV completo");
    }

    async function approveQa(changeId, devId, qaId) {
      const [qaItemRows] = await db.execute(
        `SELECT id, current_version, current_document_id
         FROM project_configuration_items
         WHERE project_id = ? AND element_code = 'QA_EVIDENCE'`,
        [projectId]
      );
      const qaConfigurationItem = qaItemRows[0];
      if (!qaConfigurationItem.current_document_id) {
        const [documentResult] = await db.execute(
          `INSERT INTO documents
           (project_id, change_request_id, work_item_id, uploaded_by, doc_type, file_name, mime_type, size_bytes, content)
           VALUES (?, ?, ?, ?, 'QA_EVIDENCE', 'qa-v1.pdf', 'application/pdf', 8, ?)`,
          [projectId, changeId, qaId, userIds.QA, Buffer.from("%PDF-1.4")]
        );
        await db.execute(
          "UPDATE project_configuration_items SET current_version = 1, current_document_id = ? WHERE id = ?",
          [documentResult.insertId, qaConfigurationItem.id]
        );
        await db.execute(
          `UPDATE change_request_configuration_impacts
           SET status = 'CHANGED', old_version = 0, new_version = 1,
               deliverable_notes = 'Primera entrega QA', document_id = ?, resolved_by = ?, resolved_at = NOW()
           WHERE change_request_id = ? AND configuration_item_id = ?`,
          [documentResult.insertId, userIds.QA, changeId, qaConfigurationItem.id]
        );
      } else {
        await db.execute(
          `UPDATE change_request_configuration_impacts
           SET status = 'NO_CHANGE', deliverable_notes = 'Se reutiliza documentacion QA',
               document_id = ?, resolved_by = ?, resolved_at = NOW()
           WHERE change_request_id = ? AND configuration_item_id = ?`,
          [qaConfigurationItem.current_document_id, userIds.QA, changeId, qaConfigurationItem.id]
        );
      }
      const [qaRows] = await db.execute("SELECT version FROM work_items WHERE id = ?", [qaId]);
      await db.execute(
        `INSERT INTO qa_reviews (qa_work_item_id, dev_work_item_id, reviewer_id, verdict, comments, version)
         VALUES (?, ?, ?, 'APPROVED', 'QA aprobado', ?)`,
        [qaId, devId, userIds.QA, qaRows[0].version]
      );
      await db.execute("UPDATE work_items SET status = 'QA_APPROVED' WHERE id = ?", [qaId]);
      await setChange(changeId, "QA", "QA_APRUEBA", "QA_WAITING", "TECH_LEAD_REVIEW", "QA aprobado");
    }

    const changeA = await createChange("A");
    await setChange(changeA, "JEFE_PROYECTO", "PM_RECHAZA", "PM_REVIEW", "REQUESTER_NEGOTIATION", "Observacion PM");
    const [notificationRows] = await db.execute(
      "SELECT COUNT(*) AS total FROM notifications WHERE change_request_id = ? AND read_at IS NULL",
      [changeA]
    );
    assert(Number(notificationRows[0].total) === 0, "La notificacion anterior no se resolvio al cambiar de estado");
    let status = await statusOf(changeA);
    assert(status.status === "REQUESTER_NEGOTIATION", "PM reject no devolvio al solicitante");
    await db.execute(
      "UPDATE change_requests SET status = 'PM_REVIEW', current_version = current_version + 1 WHERE id = ?",
      [changeA]
    );
    await audit(changeA, "SOLICITANTE", "SOLICITANTE_REENVIA", "REQUESTER_NEGOTIATION", "PM_REVIEW", "Reenvio");
    status = await statusOf(changeA);
    assert(status.current_version === 2, "Reenvio no incremento version");
    await setChange(changeA, "JEFE_PROYECTO", "PM_ESCALA_CCB", "PM_REVIEW", "CCB_REVIEW", "Riesgo alto");
    await db.execute(
      `INSERT INTO documents
       (project_id, change_request_id, uploaded_by, doc_type, file_name, mime_type, size_bytes, content)
       VALUES (?, ?, ?, 'CCB_DECISION', 'ccb-approve.pdf', 'application/pdf', 8, ?)`,
      [projectId, changeA, userIds.CCB, Buffer.from("%PDF-1.4")]
    );
    await setChange(changeA, "CCB", "CCB_APRUEBA", "CCB_REVIEW", "CCB_APPROVED_TO_PM", "CCB aprueba");
    await setChange(changeA, "JEFE_PROYECTO", "PM_APRUEBA", "CCB_APPROVED_TO_PM", "TECH_LEAD_REQUIREMENTS", "PM aprueba");
    await db.execute(
      `UPDATE change_requests cr
       INNER JOIN project_deliveries pd ON pd.project_id = cr.project_id AND pd.sequence_number = 1
       SET cr.delivery_id = pd.id
       WHERE cr.id = ?`,
      [changeA]
    );
    await db.execute(
      `UPDATE project_deliveries
       SET start_date = DATE_SUB(CURDATE(), INTERVAL 2 DAY),
           end_date = DATE_SUB(CURDATE(), INTERVAL 1 DAY)
       WHERE project_id = ? AND sequence_number = 1`,
      [projectId]
    );
    const [overdueRows] = await db.execute(
      `SELECT COUNT(*) AS total
       FROM change_requests cr
       INNER JOIN project_deliveries pd ON pd.id = cr.delivery_id
       WHERE cr.id = ? AND cr.status <> 'CLOSED_APPROVED' AND pd.end_date < CURDATE()`,
      [changeA]
    );
    assert(Number(overdueRows[0].total) === 1, "La solicitud vencida no aparece en tardanza");
    checks.push("solicitud_asignada_y_detectada_en_tardanza");
    const cardsA = await createDevAndQa(changeA);
    const [developerImpactRows] = await db.execute(
      `SELECT COUNT(*) AS total,
              SUM(pci.element_code = 'SOURCE_CODE') AS developer_total,
              SUM(pci.element_code = 'QA_EVIDENCE') AS qa_total
       FROM change_request_configuration_impacts cri
       INNER JOIN project_configuration_items pci ON pci.id = cri.configuration_item_id
       WHERE cri.change_request_id = ?`,
      [changeA]
    );
    assert(
      Number(developerImpactRows[0].total) === 2 &&
        Number(developerImpactRows[0].developer_total) === 1 &&
        Number(developerImpactRows[0].qa_total) === 1,
      "La asignacion SCM no separo correctamente los elementos DEV y QA"
    );
    checks.push("elementos_scm_separados_para_dev_y_qa");
    await completeDev(changeA, cardsA.devId, cardsA.qaId);
    const [firstBaselineRows] = await db.execute(
      `SELECT current_version, current_document_id
       FROM project_configuration_items
       WHERE project_id = ? AND element_code = 'SOURCE_CODE'`,
      [projectId]
    );
    assert(
      Number(firstBaselineRows[0].current_version) === 1 && firstBaselineRows[0].current_document_id,
      "La primera entrega DEV no creo la linea base V1"
    );
    checks.push("primera_entrega_scm_crea_linea_base_v1");
    await db.execute(
      `INSERT INTO qa_reviews (qa_work_item_id, dev_work_item_id, reviewer_id, verdict, comments, version)
       VALUES (?, ?, ?, 'REJECTED', 'QA rechaza con observacion', 1)`,
      [cardsA.qaId, cardsA.devId, userIds.QA]
    );
    await db.execute("UPDATE work_items SET status = 'BLOCKED', version = version + 1 WHERE id = ?", [cardsA.qaId]);
    await db.execute(
      "UPDATE work_items SET status = 'ACTIVE', completed_at = NULL, version = version + 1, remaining_percent = 10 WHERE id = ?",
      [cardsA.devId]
    );
    await db.execute(
      "UPDATE change_requests SET status = 'QA_REJECTED_DEV_REWORK', current_version = current_version + 1 WHERE id = ?",
      [changeA]
    );
    await audit(changeA, "QA", "QA_RECHAZA", "QA_WAITING", "QA_REJECTED_DEV_REWORK", "QA rechaza");
    status = await statusOf(changeA);
    assert(status.status === "QA_REJECTED_DEV_REWORK" && status.current_version === 3, "QA reject no versiono");
    await completeDev(changeA, cardsA.devId, cardsA.qaId, "QA_REJECTED_DEV_REWORK");
    await approveQa(changeA, cardsA.devId, cardsA.qaId);
    await setChange(changeA, "LIDER_TECNICO", "TL_ENVIA_PM", "TECH_LEAD_REVIEW", "PM_FINAL_REVIEW", "TL libera");
    await setChange(changeA, "JEFE_PROYECTO", "PM_ENVIA_SOLICITANTE", "PM_FINAL_REVIEW", "REQUESTER_VALIDATION", "PM envia");
    await db.execute(
      `INSERT INTO documents
       (project_id, change_request_id, uploaded_by, doc_type, file_name, mime_type, size_bytes, content)
       VALUES (?, ?, ?, 'FINAL_OBSERVATION', 'observacion-final.pdf', 'application/pdf', 8, ?)`,
      [projectId, changeA, userIds.SOLICITANTE, Buffer.from("%PDF-1.4")]
    );
    await db.execute(
      "UPDATE change_requests SET status = 'PM_REVIEW', current_version = current_version + 1 WHERE id = ?",
      [changeA]
    );
    await audit(changeA, "SOLICITANTE", "SOLICITANTE_OBSERVA_FINAL", "REQUESTER_VALIDATION", "PM_REVIEW", "Observa final");
    status = await statusOf(changeA);
    assert(status.status === "PM_REVIEW" && status.current_version === 4, "Observacion final no reinicio flujo");
    checks.push("flujo_con_rechazo_pm_ccb_aprueba_qa_rechaza_final_observado");

    const changeB = await createChange("B");
    await setChange(changeB, "JEFE_PROYECTO", "PM_APRUEBA", "PM_REVIEW", "TECH_LEAD_REQUIREMENTS", "PM aprueba");
    const cardsB = await createDevAndQa(changeB);
    await completeDev(changeB, cardsB.devId, cardsB.qaId);
    await approveQa(changeB, cardsB.devId, cardsB.qaId);
    const [reusedRows] = await db.execute(
      `SELECT cri.status, cri.document_id, pci.current_document_id
       FROM change_request_configuration_impacts cri
       INNER JOIN project_configuration_items pci ON pci.id = cri.configuration_item_id
       WHERE cri.change_request_id = ?
       ORDER BY pci.element_code`,
      [changeB]
    );
    assert(
      reusedRows.length === 2 &&
        reusedRows.every(
          (row) => row.status === "NO_CHANGE" && Number(row.document_id) === Number(row.current_document_id)
        ),
      "La segunda solicitud no reutilizo la documentacion SCM vigente"
    );
    checks.push("solicitud_posterior_reutiliza_documentacion_vigente");
    const [versionHistoryRows] = await db.execute(
      `SELECT pci.element_code, COUNT(*) AS total_versions,
              MIN(cri.new_version) AS first_version, MAX(cri.new_version) AS last_version
       FROM change_request_configuration_impacts cri
       INNER JOIN project_configuration_items pci ON pci.id = cri.configuration_item_id
       WHERE pci.project_id = ? AND cri.status = 'CHANGED'
       GROUP BY pci.element_code`,
      [projectId]
    );
    assert(
      versionHistoryRows.length === 2 &&
        versionHistoryRows.every(
          (row) =>
            Number(row.total_versions) === 1 &&
            Number(row.first_version) === 1 &&
            Number(row.last_version) === 1
        ),
      "El historial SCM no conserva una secuencia descargable desde V1"
    );
    checks.push("historial_bibliotecario_versionado_desde_v1");
    await setChange(changeB, "LIDER_TECNICO", "TL_ENVIA_PM", "TECH_LEAD_REVIEW", "PM_FINAL_REVIEW", "TL libera");
    await setChange(changeB, "JEFE_PROYECTO", "PM_ENVIA_SOLICITANTE", "PM_FINAL_REVIEW", "REQUESTER_VALIDATION", "PM envia");
    await db.execute("UPDATE change_requests SET status = 'CLOSED_APPROVED', closed_at = NOW() WHERE id = ?", [
      changeB
    ]);
    await audit(changeB, "SOLICITANTE", "SOLICITANTE_APRUEBA_FINAL", "REQUESTER_VALIDATION", "CLOSED_APPROVED", "Cierre");
    status = await statusOf(changeB);
    assert(status.status === "CLOSED_APPROVED", "Aprobacion final no cerro solicitud");
    checks.push("flujo_feliz_cerrado");

    const changeC = await createChange("C");
    await setChange(changeC, "JEFE_PROYECTO", "PM_ESCALA_CCB", "PM_REVIEW", "CCB_REVIEW", "Escala");
    await db.execute(
      `INSERT INTO documents
       (project_id, change_request_id, uploaded_by, doc_type, file_name, mime_type, size_bytes, content)
       VALUES (?, ?, ?, 'CCB_DECISION', 'ccb-reject.docx',
               'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 4, ?)`,
      [projectId, changeC, userIds.CCB, Buffer.from("docx")]
    );
    await setChange(changeC, "CCB", "CCB_RECHAZA", "CCB_REVIEW", "REQUESTER_NEGOTIATION", "CCB rechaza");
    status = await statusOf(changeC);
    assert(status.status === "REQUESTER_NEGOTIATION", "CCB reject no devolvio al solicitante");
    checks.push("ccb_rechaza_con_documento");

    const [summaryRows] = await db.execute(
      `SELECT
         (SELECT COUNT(*) FROM audit_events WHERE change_request_id IN (?, ?, ?)) AS audits,
         (SELECT COUNT(*) FROM documents WHERE project_id = ?) AS docs,
         (SELECT COUNT(*) FROM qa_reviews qr
          INNER JOIN work_items wi ON wi.id = qr.qa_work_item_id
          WHERE wi.project_id = ?) AS qa_reviews`,
      [changeA, changeB, changeC, projectId, projectId]
    );
    assert(summaryRows[0].audits >= 25, "La trazabilidad no registro suficientes eventos");
    assert(summaryRows[0].docs >= 5, "Los documentos requeridos no se registraron");
    assert(summaryRows[0].qa_reviews >= 3, "Las revisiones QA no se registraron");
    checks.push("trazabilidad_documentos_metricas");

    await db.rollback();
    console.log(JSON.stringify({ ok: true, rollback: true, checks }, null, 2));
  } catch (error) {
    await db.rollback();
    throw error;
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
