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
  "QA"
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

  await db.beginTransaction();
  try {
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

    for (const role of roles) {
      await db.execute("INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)", [
        projectId,
        userIds[role],
        role
      ]);
    }
    checks.push("roles_por_proyecto");

    async function audit(changeId, actorRole, action, fromStatus, toStatus, comment) {
      await db.execute(
        `INSERT INTO audit_events (change_request_id, actor_id, action, from_status, to_status, comment)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [changeId, userIds[actorRole], action, fromStatus, toStatus, comment]
      );
    }

    async function setChange(changeId, actorRole, action, fromStatus, toStatus, comment) {
      await db.execute("UPDATE change_requests SET status = ? WHERE id = ?", [toStatus, changeId]);
      await audit(changeId, actorRole, action, fromStatus, toStatus, comment);
    }

    async function statusOf(changeId) {
      const [rows] = await db.execute("SELECT status, current_version FROM change_requests WHERE id = ?", [
        changeId
      ]);
      return rows[0];
    }

    async function createChange(suffix) {
      const code = `VERIFY-${runId}-${suffix}`;
      const [result] = await db.execute(
        `INSERT INTO change_requests
         (change_code, project_id, requester_id, title, summary, business_reason, affected_area,
          priority, risk_level, budget_impact, functional_scope, technical_context,
          acceptance_criteria, impact_analysis, rollback_plan, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'HIGH', 'MEDIUM', 1200.00, ?, ?, ?, ?, ?, 'PM_REVIEW')`,
        [
          code,
          projectId,
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
    const cardsA = await createDevAndQa(changeA);
    await completeDev(changeA, cardsA.devId, cardsA.qaId);
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
