import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const root = process.cwd();
const envPath = path.join(root, ".env.local");

if (fs.existsSync(envPath)) {
  const env = fs.readFileSync(envPath, "utf8");
  for (const line of env.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...valueParts] = trimmed.split("=");
    process.env[key] ??= valueParts.join("=").replace(/^["']|["']$/g, "");
  }
}

const database = process.env.MYSQL_DATABASE || "sgcs_devops";
if (!/^[a-zA-Z0-9_]+$/.test(database)) {
  throw new Error("MYSQL_DATABASE solo puede contener letras, numeros y guion bajo.");
}

const connectionConfig = {
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  multipleStatements: false
};

const tableOptions = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";
const configurationData = JSON.parse(
  fs.readFileSync(path.join(root, "lib", "configuration-data.json"), "utf8")
);

const systemRoles = [
  ["SOLICITANTE", "Solicitante", "SOLICITANTE"],
  ["JEFE_PROYECTO", "Jefe de proyectos", "JEFE_PROYECTO"],
  ["CCB", "CCB", "CCB"],
  ["LIDER_TECNICO", "Lider tecnico", "LIDER_TECNICO"],
  ["DESARROLLADOR", "Desarrollador", "DESARROLLADOR"],
  ["QA", "QA", "QA"]
];

const ddl = [
  `CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(160) NOT NULL,
    email VARCHAR(190) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    is_admin TINYINT(1) NOT NULL DEFAULT 0,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ${tableOptions}`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash CHAR(64) NOT NULL PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ${tableOptions}`,
  `CREATE TABLE IF NOT EXISTS projects (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(190) NOT NULL,
    description TEXT NULL,
    methodology VARCHAR(80) NOT NULL DEFAULT 'Agile / Scrum',
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status ENUM('PLANNED','ACTIVE','ON_HOLD','CLOSED') NOT NULL DEFAULT 'ACTIVE',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ${tableOptions}`,
  `CREATE TABLE IF NOT EXISTS configuration_templates (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(160) NOT NULL UNIQUE,
    methodology VARCHAR(40) NOT NULL,
    description TEXT NULL,
    created_by BIGINT UNSIGNED NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_configuration_templates_methodology (methodology, active),
    CONSTRAINT fk_configuration_template_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  ) ${tableOptions}`,
  `CREATE TABLE IF NOT EXISTS configuration_template_items (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    template_id BIGINT UNSIGNED NOT NULL,
    element_code VARCHAR(80) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_configuration_template_item (template_id, element_code),
    CONSTRAINT fk_configuration_template_item_template FOREIGN KEY (template_id) REFERENCES configuration_templates(id) ON DELETE CASCADE
  ) ${tableOptions}`,
  `CREATE TABLE IF NOT EXISTS project_configuration_items (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    project_id BIGINT UNSIGNED NOT NULL,
    element_code VARCHAR(80) NOT NULL,
    name VARCHAR(190) NOT NULL,
    category VARCHAR(120) NOT NULL,
    methodology VARCHAR(40) NOT NULL,
    current_version INT UNSIGNED NOT NULL DEFAULT 1,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_project_configuration_item (project_id, element_code),
    KEY idx_project_configuration_category (project_id, category),
    CONSTRAINT fk_project_configuration_item_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  ) ${tableOptions}`,
  `CREATE TABLE IF NOT EXISTS project_configuration_dependencies (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    project_id BIGINT UNSIGNED NOT NULL,
    source_item_id BIGINT UNSIGNED NOT NULL,
    target_item_id BIGINT UNSIGNED NOT NULL,
    relation_type VARCHAR(80) NOT NULL DEFAULT 'IMPACTA',
    required TINYINT(1) NOT NULL DEFAULT 1,
    rationale TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_project_configuration_dependency (project_id, source_item_id, target_item_id),
    KEY idx_project_configuration_dependency_target (target_item_id),
    CONSTRAINT fk_project_configuration_dependency_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    CONSTRAINT fk_project_configuration_dependency_source FOREIGN KEY (source_item_id) REFERENCES project_configuration_items(id) ON DELETE CASCADE,
    CONSTRAINT fk_project_configuration_dependency_target FOREIGN KEY (target_item_id) REFERENCES project_configuration_items(id) ON DELETE CASCADE
  ) ${tableOptions}`,
  `CREATE TABLE IF NOT EXISTS role_definitions (
    code VARCHAR(80) NOT NULL PRIMARY KEY,
    name VARCHAR(140) NOT NULL,
    base_role VARCHAR(80) NOT NULL,
    description TEXT NULL,
    is_system TINYINT(1) NOT NULL DEFAULT 0,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_roles_base (base_role),
    KEY idx_roles_active (active)
  ) ${tableOptions}`,
  `CREATE TABLE IF NOT EXISTS project_members (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    project_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    role VARCHAR(80) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_project_user (project_id, user_id),
    KEY idx_project_members_role (project_id, role),
    CONSTRAINT fk_members_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    CONSTRAINT fk_members_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ${tableOptions}`,
  `CREATE TABLE IF NOT EXISTS work_teams (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(160) NOT NULL UNIQUE,
    description TEXT NULL,
    created_by BIGINT UNSIGNED NOT NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_work_teams_creator FOREIGN KEY (created_by) REFERENCES users(id)
  ) ${tableOptions}`,
  `CREATE TABLE IF NOT EXISTS work_team_members (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    team_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    role VARCHAR(80) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_team_user (team_id, user_id),
    KEY idx_team_role (team_id, role),
    CONSTRAINT fk_team_members_team FOREIGN KEY (team_id) REFERENCES work_teams(id) ON DELETE CASCADE,
    CONSTRAINT fk_team_members_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ${tableOptions}`,
  `CREATE TABLE IF NOT EXISTS change_requests (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    change_code VARCHAR(40) NOT NULL UNIQUE,
    project_id BIGINT UNSIGNED NOT NULL,
    requester_id BIGINT UNSIGNED NOT NULL,
    title VARCHAR(220) NOT NULL,
    summary TEXT NOT NULL,
    business_reason TEXT NOT NULL,
    affected_area VARCHAR(160) NULL,
    priority ENUM('LOW','MEDIUM','HIGH','CRITICAL') NOT NULL DEFAULT 'MEDIUM',
    risk_level ENUM('LOW','MEDIUM','HIGH','CRITICAL') NOT NULL DEFAULT 'MEDIUM',
    budget_impact DECIMAL(12,2) NULL,
    requested_deadline DATE NULL,
    functional_scope TEXT NULL,
    technical_context TEXT NULL,
    acceptance_criteria TEXT NULL,
    impact_analysis TEXT NULL,
    rollback_plan TEXT NULL,
    status VARCHAR(64) NOT NULL DEFAULT 'PM_REVIEW',
    current_version INT UNSIGNED NOT NULL DEFAULT 1,
    closed_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_change_project_status (project_id, status),
    KEY idx_change_requester (requester_id),
    CONSTRAINT fk_change_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    CONSTRAINT fk_change_requester FOREIGN KEY (requester_id) REFERENCES users(id)
  ) ${tableOptions}`,
  `CREATE TABLE IF NOT EXISTS change_request_configuration_impacts (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    change_request_id BIGINT UNSIGNED NOT NULL,
    configuration_item_id BIGINT UNSIGNED NOT NULL,
    source_item_id BIGINT UNSIGNED NULL,
    impact_type ENUM('DIRECT','RELATED') NOT NULL DEFAULT 'DIRECT',
    reason TEXT NULL,
    status ENUM('PENDING','CHANGED','NO_CHANGE') NOT NULL DEFAULT 'PENDING',
    old_version INT UNSIGNED NOT NULL,
    new_version INT UNSIGNED NULL,
    deliverable_notes TEXT NULL,
    document_id BIGINT UNSIGNED NULL,
    resolved_by BIGINT UNSIGNED NULL,
    resolved_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_change_configuration_impact (change_request_id, configuration_item_id),
    KEY idx_change_configuration_impact_status (change_request_id, status),
    KEY idx_change_configuration_impact_item (configuration_item_id),
    KEY idx_change_configuration_impact_document (document_id),
    CONSTRAINT fk_change_configuration_impact_change FOREIGN KEY (change_request_id) REFERENCES change_requests(id) ON DELETE CASCADE,
    CONSTRAINT fk_change_configuration_impact_item FOREIGN KEY (configuration_item_id) REFERENCES project_configuration_items(id) ON DELETE CASCADE,
    CONSTRAINT fk_change_configuration_impact_source FOREIGN KEY (source_item_id) REFERENCES project_configuration_items(id) ON DELETE SET NULL,
    CONSTRAINT fk_change_configuration_impact_resolver FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL
  ) ${tableOptions}`,
  `CREATE TABLE IF NOT EXISTS audit_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    change_request_id BIGINT UNSIGNED NOT NULL,
    actor_id BIGINT UNSIGNED NOT NULL,
    action VARCHAR(90) NOT NULL,
    from_status VARCHAR(64) NULL,
    to_status VARCHAR(64) NULL,
    comment TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_audit_change (change_request_id, created_at),
    CONSTRAINT fk_audit_change FOREIGN KEY (change_request_id) REFERENCES change_requests(id) ON DELETE CASCADE,
    CONSTRAINT fk_audit_actor FOREIGN KEY (actor_id) REFERENCES users(id)
  ) ${tableOptions}`,
  `CREATE TABLE IF NOT EXISTS work_items (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    project_id BIGINT UNSIGNED NOT NULL,
    change_request_id BIGINT UNSIGNED NOT NULL,
    parent_work_item_id BIGINT UNSIGNED NULL,
    type ENUM('DEV','QA') NOT NULL,
    title VARCHAR(220) NOT NULL,
    description TEXT NOT NULL,
    acceptance_criteria TEXT NULL,
    definition_of_done TEXT NULL,
    assigned_to BIGINT UNSIGNED NULL,
    status VARCHAR(64) NOT NULL DEFAULT 'NEW',
    priority ENUM('LOW','MEDIUM','HIGH','CRITICAL') NOT NULL DEFAULT 'MEDIUM',
    story_points INT UNSIGNED NULL,
    version INT UNSIGNED NOT NULL DEFAULT 1,
    progress_percent TINYINT UNSIGNED NOT NULL DEFAULT 0,
    remaining_percent TINYINT UNSIGNED NOT NULL DEFAULT 100,
    github_branch VARCHAR(220) NULL,
    completed_at DATETIME NULL,
    created_by BIGINT UNSIGNED NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_work_project_type_status (project_id, type, status),
    KEY idx_work_change (change_request_id),
    KEY idx_work_assigned (assigned_to),
    CONSTRAINT fk_work_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    CONSTRAINT fk_work_change FOREIGN KEY (change_request_id) REFERENCES change_requests(id) ON DELETE CASCADE,
    CONSTRAINT fk_work_parent FOREIGN KEY (parent_work_item_id) REFERENCES work_items(id) ON DELETE SET NULL,
    CONSTRAINT fk_work_assigned FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_work_creator FOREIGN KEY (created_by) REFERENCES users(id)
  ) ${tableOptions}`,
  `CREATE TABLE IF NOT EXISTS work_item_updates (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    work_item_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    work_date DATE NOT NULL,
    hours_spent DECIMAL(5,2) NOT NULL DEFAULT 0,
    today_done TEXT NOT NULL,
    tomorrow_plan TEXT NOT NULL,
    blockers TEXT NULL,
    progress_percent TINYINT UNSIGNED NOT NULL,
    remaining_percent TINYINT UNSIGNED NOT NULL,
    github_branch VARCHAR(220) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_updates_work_date (work_item_id, work_date),
    CONSTRAINT fk_update_work FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE,
    CONSTRAINT fk_update_user FOREIGN KEY (user_id) REFERENCES users(id)
  ) ${tableOptions}`,
  `CREATE TABLE IF NOT EXISTS qa_reviews (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    qa_work_item_id BIGINT UNSIGNED NOT NULL,
    dev_work_item_id BIGINT UNSIGNED NOT NULL,
    reviewer_id BIGINT UNSIGNED NOT NULL,
    verdict ENUM('APPROVED','REJECTED') NOT NULL,
    comments TEXT NOT NULL,
    version INT UNSIGNED NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_qa_work (qa_work_item_id),
    CONSTRAINT fk_review_qa FOREIGN KEY (qa_work_item_id) REFERENCES work_items(id) ON DELETE CASCADE,
    CONSTRAINT fk_review_dev FOREIGN KEY (dev_work_item_id) REFERENCES work_items(id) ON DELETE CASCADE,
    CONSTRAINT fk_review_user FOREIGN KEY (reviewer_id) REFERENCES users(id)
  ) ${tableOptions}`,
  `CREATE TABLE IF NOT EXISTS documents (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    project_id BIGINT UNSIGNED NOT NULL,
    change_request_id BIGINT UNSIGNED NULL,
    work_item_id BIGINT UNSIGNED NULL,
    uploaded_by BIGINT UNSIGNED NOT NULL,
    doc_type ENUM('REQUEST_ATTACHMENT','CCB_DECISION','DEV_DOCUMENTATION','QA_EVIDENCE','CONFIGURATION_DELIVERABLE','FINAL_OBSERVATION') NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(160) NOT NULL,
    size_bytes INT UNSIGNED NOT NULL,
    content LONGBLOB NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_docs_change (change_request_id),
    KEY idx_docs_work (work_item_id),
    CONSTRAINT fk_doc_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    CONSTRAINT fk_doc_change FOREIGN KEY (change_request_id) REFERENCES change_requests(id) ON DELETE CASCADE,
    CONSTRAINT fk_doc_work FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE,
    CONSTRAINT fk_doc_user FOREIGN KEY (uploaded_by) REFERENCES users(id)
  ) ${tableOptions}`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    project_id BIGINT UNSIGNED NULL,
    change_request_id BIGINT UNSIGNED NULL,
    work_item_id BIGINT UNSIGNED NULL,
    title VARCHAR(190) NOT NULL,
    body TEXT NOT NULL,
    read_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_notifications_user (user_id, read_at, created_at),
    CONSTRAINT fk_notification_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_notification_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    CONSTRAINT fk_notification_change FOREIGN KEY (change_request_id) REFERENCES change_requests(id) ON DELETE CASCADE,
    CONSTRAINT fk_notification_work FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE
  ) ${tableOptions}`
];

function normalizeMethodology(value) {
  return String(value || "").toLowerCase().includes("rup") ? "RUP" : "AGILE_SCRUM";
}

function methodologyLabel(value) {
  const code = normalizeMethodology(value);
  return configurationData.methodologies.find((item) => item.code === code)?.label || "Agile / Scrum";
}

function configurationItemsForMethodology(value) {
  const code = normalizeMethodology(value);
  return configurationData.items.filter((item) => item.methodologies.includes(code));
}

function configurationRelationsForMethodology(value) {
  const code = normalizeMethodology(value);
  return configurationData.relations.filter((item) => item.methodologies.includes(code));
}

async function insertConfigurationItems(db, projectId, methodology, codes) {
  const selected = new Set(codes);
  const methodologyCode = normalizeMethodology(methodology);
  const items = configurationItemsForMethodology(methodology).filter((item) => selected.has(item.code));

  for (const item of items) {
    await db.execute(
      `INSERT INTO project_configuration_items
       (project_id, element_code, name, category, methodology)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         category = VALUES(category),
         methodology = VALUES(methodology),
         active = 1`,
      [projectId, item.code, item.name, item.category, methodologyCode]
    );
  }

  const [itemRows] = await db.execute(
    "SELECT id, element_code FROM project_configuration_items WHERE project_id = ? AND active = 1",
    [projectId]
  );
  const idsByCode = new Map(itemRows.map((row) => [row.element_code, row.id]));

  for (const relation of configurationRelationsForMethodology(methodology)) {
    if (!selected.has(relation.source) || !selected.has(relation.target)) continue;
    const sourceId = idsByCode.get(relation.source);
    const targetId = idsByCode.get(relation.target);
    if (!sourceId || !targetId || sourceId === targetId) continue;

    await db.execute(
      `INSERT INTO project_configuration_dependencies
       (project_id, source_item_id, target_item_id, relation_type, required, rationale)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         relation_type = VALUES(relation_type),
         required = VALUES(required),
         rationale = VALUES(rationale)`,
      [
        projectId,
        sourceId,
        targetId,
        relation.relationType,
        relation.required ? 1 : 0,
        relation.rationale
      ]
    );
  }
}

async function seedConfigurationTemplates(db) {
  for (const methodology of configurationData.methodologies) {
    const name = `Plantilla ${methodology.label} completa`;
    const codes = configurationItemsForMethodology(methodology.code).map((item) => item.code);

    await db.execute(
      `INSERT INTO configuration_templates (name, methodology, description, created_by, active)
       VALUES (?, ?, ?, NULL, 1)
       ON DUPLICATE KEY UPDATE
         methodology = VALUES(methodology),
         description = VALUES(description),
         active = 1`,
      [
        name,
        methodology.code,
        `Todos los elementos de configuracion base para ${methodology.label}.`
      ]
    );

    const [templateRows] = await db.execute("SELECT id FROM configuration_templates WHERE name = ? LIMIT 1", [
      name
    ]);
    const templateId = templateRows[0]?.id;
    if (!templateId) continue;

    await db.execute("DELETE FROM configuration_template_items WHERE template_id = ?", [templateId]);
    for (const code of codes) {
      await db.execute(
        "INSERT INTO configuration_template_items (template_id, element_code) VALUES (?, ?)",
        [templateId, code]
      );
    }
  }
}

async function backfillProjectConfigurationItems(db) {
  const [projects] = await db.execute("SELECT id, methodology FROM projects");
  for (const project of projects) {
    const [countRows] = await db.execute(
      "SELECT COUNT(*) AS total FROM project_configuration_items WHERE project_id = ?",
      [project.id]
    );
    if (Number(countRows[0]?.total || 0) > 0) continue;

    const codes = configurationItemsForMethodology(project.methodology).map((item) => item.code);
    await insertConfigurationItems(db, project.id, project.methodology, codes);
  }
}

async function ensureColumn(db, table, column, definition) {
  const [rows] = await db.execute(
    `SELECT COUNT(*) AS total
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [table, column]
  );

  if (Number(rows[0]?.total || 0) === 0) {
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}

async function ensureCompatibleSchema(db) {
  await db.execute("ALTER TABLE project_members MODIFY role VARCHAR(80) NOT NULL");
  await db.execute(
    `ALTER TABLE documents
     MODIFY doc_type ENUM('REQUEST_ATTACHMENT','CCB_DECISION','DEV_DOCUMENTATION','QA_EVIDENCE','CONFIGURATION_DELIVERABLE','FINAL_OBSERVATION') NOT NULL`
  );
  await ensureColumn(
    db,
    "change_request_configuration_impacts",
    "deliverable_notes",
    "deliverable_notes TEXT NULL AFTER new_version"
  );
  await ensureColumn(
    db,
    "change_request_configuration_impacts",
    "document_id",
    "document_id BIGINT UNSIGNED NULL AFTER deliverable_notes"
  );
  await seedConfigurationTemplates(db);
  await backfillProjectConfigurationItems(db);
}

async function main() {
  const rootConnection = await mysql.createConnection(connectionConfig);
  await rootConnection.execute(
    `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await rootConnection.end();

  const db = await mysql.createConnection({ ...connectionConfig, database, dateStrings: true });
  for (const statement of ddl) {
    await db.execute(statement);
  }
  await ensureCompatibleSchema(db);

  for (const [code, name, baseRole] of systemRoles) {
    await db.execute(
      `INSERT INTO role_definitions (code, name, base_role, is_system, active)
       VALUES (?, ?, ?, 1, 1)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         base_role = VALUES(base_role),
         is_system = 1,
         active = 1`,
      [code, name, baseRole]
    );
  }

  const [admins] = await db.execute("SELECT id FROM users WHERE is_admin = 1 LIMIT 1");
  if (Array.isArray(admins) && admins.length === 0) {
    const email = process.env.SEED_ADMIN_EMAIL || "admin@sgcs.local";
    const password = process.env.SEED_ADMIN_PASSWORD || "Admin123!";
    const hash = await bcrypt.hash(password, 12);
    await db.execute(
      "INSERT INTO users (name, email, password_hash, is_admin) VALUES (?, ?, ?, 1)",
      ["Administrador SGCS", email, hash]
    );
    console.log(`Administrador inicial creado: ${email}`);
  }

  await db.end();
  console.log(`Base de datos lista: ${database}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
