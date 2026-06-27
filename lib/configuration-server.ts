import "server-only";

import { PoolConnection, RowDataPacket } from "mysql2/promise";

import {
  DEVELOPER_CONFIGURATION_CODES,
  getConfigurationItemDefinition,
  getConfigurationItemMap,
  getConfigurationRelationsForMethodology,
  methodologyLabel,
  normalizeMethodology
} from "@/lib/configuration";
import { query } from "@/lib/db";

export function configurationCodesFromForm(formData: FormData) {
  return [...new Set(formData.getAll("configuration_item_code").map(String).filter(Boolean))];
}

export function configurationItemIdsFromForm(formData: FormData) {
  return [
    ...new Set(
      formData
        .getAll("configuration_item_id")
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
    )
  ];
}

export function validConfigurationCodesForMethodology(rawCodes: string[], methodology: string) {
  const code = normalizeMethodology(methodology);
  const definitionMap = getConfigurationItemMap();
  return [...new Set(rawCodes)].filter((itemCode) => {
    const definition = definitionMap.get(itemCode);
    return Boolean(definition?.methodologies.includes(code));
  });
}

export async function insertProjectConfigurationItems(
  connection: PoolConnection,
  projectId: number,
  methodology: string,
  codes: string[]
) {
  const validCodes = validConfigurationCodesForMethodology(codes, methodology);
  const methodologyCode = normalizeMethodology(methodology);

  for (const code of validCodes) {
    const definition = getConfigurationItemDefinition(code);
    if (!definition) continue;

    await connection.execute(
      `INSERT INTO project_configuration_items
       (project_id, element_code, name, category, methodology)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         category = VALUES(category),
         methodology = VALUES(methodology),
         active = 1`,
      [projectId, definition.code, definition.name, definition.category, methodologyCode]
    );
  }

  await insertDefaultProjectConfigurationDependencies(connection, projectId, methodology, validCodes);
}

export async function replaceProjectConfigurationItems(
  connection: PoolConnection,
  projectId: number,
  methodology: string,
  codes: string[]
) {
  await connection.execute("DELETE FROM project_configuration_dependencies WHERE project_id = ?", [projectId]);
  await connection.execute("DELETE FROM project_configuration_items WHERE project_id = ?", [projectId]);
  await insertProjectConfigurationItems(connection, projectId, methodology, codes);
}

export async function saveConfigurationTemplate(
  connection: PoolConnection,
  options: {
    name: string;
    description?: string | null;
    methodology: string;
    codes: string[];
    createdBy: number;
  }
) {
  const name = options.name.trim();
  if (!name) return;

  const methodologyCode = normalizeMethodology(options.methodology);
  const validCodes = validConfigurationCodesForMethodology(options.codes, methodologyCode);
  if (validCodes.length === 0) return;

  await connection.execute(
    `INSERT INTO configuration_templates (name, methodology, description, created_by, active)
     VALUES (?, ?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE
       methodology = VALUES(methodology),
       description = VALUES(description),
       active = 1`,
    [name, methodologyCode, options.description ?? null, options.createdBy]
  );

  const [templateRows] = await connection.execute<RowDataPacket[]>(
    "SELECT id FROM configuration_templates WHERE name = ? LIMIT 1",
    [name]
  );
  const templateId = Number(templateRows[0]?.id || 0);
  if (!templateId) return;

  await connection.execute("DELETE FROM configuration_template_items WHERE template_id = ?", [templateId]);
  for (const code of validCodes) {
    await connection.execute(
      "INSERT INTO configuration_template_items (template_id, element_code) VALUES (?, ?)",
      [templateId, code]
    );
  }
}

async function insertDefaultProjectConfigurationDependencies(
  connection: PoolConnection,
  projectId: number,
  methodology: string,
  codes: string[]
) {
  const selected = new Set(codes);
  if (selected.size === 0) return;

  const [itemRows] = await connection.execute<RowDataPacket[]>(
    `SELECT id, element_code
     FROM project_configuration_items
     WHERE project_id = ? AND active = 1`,
    [projectId]
  );
  const itemIds = new Map(itemRows.map((row) => [String(row.element_code), Number(row.id)]));

  for (const relation of getConfigurationRelationsForMethodology(methodology)) {
    if (!selected.has(relation.source) || !selected.has(relation.target)) continue;
    const sourceId = itemIds.get(relation.source);
    const targetId = itemIds.get(relation.target);
    if (!sourceId || !targetId || sourceId === targetId) continue;

    await connection.execute(
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

export async function projectConfigurationItemCount(projectId: number) {
  const rows = await query<{ total: number }>(
    "SELECT COUNT(*) AS total FROM project_configuration_items WHERE project_id = ? AND active = 1",
    [projectId]
  );
  return Number(rows[0]?.total || 0);
}

export async function createChangeRequestConfigurationImpacts(
  connection: PoolConnection,
  options: {
    projectId: number;
    changeRequestId: number;
    selectedItemIds: number[];
  }
) {
  const selectedIds = [...new Set(options.selectedItemIds)].filter(Boolean);
  if (selectedIds.length === 0) return 0;

  const placeholders = selectedIds.map(() => "?").join(", ");
  const [selectedRows] = await connection.execute<RowDataPacket[]>(
    `SELECT id, name, current_version
     FROM project_configuration_items
     WHERE project_id = ? AND active = 1 AND id IN (${placeholders})`,
    [options.projectId, ...selectedIds]
  );

  if (selectedRows.length === 0) return 0;

  const impacts = new Map<
    number,
    {
      configurationItemId: number;
      sourceItemId: number | null;
      impactType: "DIRECT" | "RELATED";
      reason: string;
      oldVersion: number;
    }
  >();

  for (const row of selectedRows) {
    const itemId = Number(row.id);
    impacts.set(itemId, {
      configurationItemId: itemId,
      sourceItemId: null,
      impactType: "DIRECT",
      reason: "Elemento indicado como cambio principal en la solicitud.",
      oldVersion: Number(row.current_version || 1)
    });
  }

  const [dependencyRows] = await connection.execute<RowDataPacket[]>(
    `SELECT dep.source_item_id, dep.target_item_id, dep.rationale,
            target.current_version AS target_version
     FROM project_configuration_dependencies dep
     INNER JOIN project_configuration_items target ON target.id = dep.target_item_id
     WHERE dep.project_id = ?
       AND dep.source_item_id IN (${placeholders})
       AND target.active = 1`,
    [options.projectId, ...selectedIds]
  );

  for (const row of dependencyRows) {
    const targetId = Number(row.target_item_id);
    if (impacts.get(targetId)?.impactType === "DIRECT") continue;
    impacts.set(targetId, {
      configurationItemId: targetId,
      sourceItemId: Number(row.source_item_id),
      impactType: "RELATED",
      reason: String(row.rationale || "Elemento relacionado por regla de impacto SCM."),
      oldVersion: Number(row.target_version || 1)
    });
  }

  for (const impact of impacts.values()) {
    await connection.execute(
      `INSERT INTO change_request_configuration_impacts
       (change_request_id, configuration_item_id, source_item_id, impact_type, reason, old_version)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         source_item_id = VALUES(source_item_id),
         impact_type = IF(impact_type = 'DIRECT', impact_type, VALUES(impact_type)),
         reason = VALUES(reason),
         old_version = VALUES(old_version)`,
      [
        options.changeRequestId,
        impact.configurationItemId,
        impact.sourceItemId,
        impact.impactType,
        impact.reason,
        impact.oldVersion
      ]
    );
  }

  return impacts.size;
}

export async function createDeveloperConfigurationImpacts(
  connection: PoolConnection,
  projectId: number,
  changeRequestId: number
) {
  const placeholders = DEVELOPER_CONFIGURATION_CODES.map(() => "?").join(", ");
  const [items] = await connection.execute<RowDataPacket[]>(
    `SELECT id, current_version
     FROM project_configuration_items
     WHERE project_id = ?
       AND active = 1
       AND element_code IN (${placeholders})`,
    [projectId, ...DEVELOPER_CONFIGURATION_CODES]
  );

  for (const item of items) {
    await connection.execute(
      `INSERT INTO change_request_configuration_impacts
       (change_request_id, configuration_item_id, source_item_id, impact_type, reason, old_version)
       VALUES (?, ?, NULL, 'DIRECT', ?, ?)
       ON DUPLICATE KEY UPDATE reason = VALUES(reason)`,
      [
        changeRequestId,
        item.id,
        "Elemento SCM bajo responsabilidad del desarrollador.",
        Number(item.current_version || 1)
      ]
    );
  }

  return items.length;
}

export function methodologyForStorage(value: string | null | undefined) {
  return methodologyLabel(value);
}
