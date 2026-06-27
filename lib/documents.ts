import "server-only";

import { PoolConnection, ResultSetHeader } from "mysql2/promise";

import { execute, query } from "@/lib/db";

const ALLOWED_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/octet-stream"
]);

export type DocumentType =
  | "REQUEST_ATTACHMENT"
  | "CCB_DECISION"
  | "DEV_DOCUMENTATION"
  | "QA_EVIDENCE"
  | "CONFIGURATION_DELIVERABLE"
  | "FINAL_OBSERVATION";

export async function saveUploadedDocument(options: {
  file: File | null;
  projectId: number;
  changeRequestId?: number | null;
  workItemId?: number | null;
  uploadedBy: number;
  docType: DocumentType;
  connection?: PoolConnection;
}) {
  const file = options.file;
  if (!file || file.size === 0) return null;

  if (file.size > 10 * 1024 * 1024) {
    throw new Error("El archivo supera 10 MB.");
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    throw new Error("Solo se aceptan documentos PDF, DOC o DOCX.");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const params = [
    options.projectId,
    options.changeRequestId ?? null,
    options.workItemId ?? null,
    options.uploadedBy,
    options.docType,
    file.name,
    file.type || "application/octet-stream",
    file.size,
    buffer
  ];

  const sql = `INSERT INTO documents
    (project_id, change_request_id, work_item_id, uploaded_by, doc_type, file_name, mime_type, size_bytes, content)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  if (options.connection) {
    const [result] = await options.connection.execute<ResultSetHeader>(sql, params);
    return result.insertId;
  }

  const result = await execute(sql, params);
  return result.insertId;
}

export async function getDocumentsForChange(changeRequestId: number) {
  return query<{
    id: number;
    work_item_id: number | null;
    uploaded_by_name: string;
    doc_type: DocumentType;
    file_name: string;
    mime_type: string;
    size_bytes: number;
    created_at: string;
    is_configuration_version: number;
    is_current_configuration_version: number;
  }>(
    `SELECT d.id, d.work_item_id, u.name AS uploaded_by_name, d.doc_type,
            d.file_name, d.mime_type, d.size_bytes, d.created_at,
            EXISTS(
              SELECT 1
              FROM change_request_configuration_impacts cri
              WHERE cri.document_id = d.id AND cri.status = 'CHANGED'
            ) AS is_configuration_version,
            EXISTS(
              SELECT 1
              FROM project_configuration_items pci
              WHERE pci.current_document_id = d.id
            ) AS is_current_configuration_version
     FROM documents d
     INNER JOIN users u ON u.id = d.uploaded_by
     WHERE d.change_request_id = ?
     ORDER BY d.created_at DESC`,
    [changeRequestId]
  );
}
