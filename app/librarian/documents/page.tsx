import { Download } from "lucide-react";
import Link from "next/link";

import { AppShell } from "@/components/AppShell";
import { EmptyState, Panel, RequestLink } from "@/components/ui";
import { requireProjectRole } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import type { DocumentType } from "@/lib/documents";

const DOCUMENT_LABELS: Record<DocumentType, string> = {
  REQUEST_ATTACHMENT: "Adjunto de solicitud",
  CCB_DECISION: "Decision CCB",
  DEV_DOCUMENTATION: "Documentacion DEV",
  QA_EVIDENCE: "Evidencia QA",
  CONFIGURATION_DELIVERABLE: "Entregable SCM",
  FINAL_OBSERVATION: "Observacion final"
};

const DOCUMENT_TYPES = Object.keys(DOCUMENT_LABELS) as DocumentType[];

type LibraryDocument = {
  id: number;
  doc_type: DocumentType;
  file_name: string;
  size_bytes: number;
  uploaded_by_name: string;
  created_at: string;
  change_request_id: number | null;
  change_code: string | null;
  request_title: string | null;
  work_item_id: number | null;
  work_item_title: string | null;
  configuration_item_name: string | null;
  configuration_version: number | null;
};

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function LibrarianDocumentsPage({
  searchParams
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const { project } = await requireProjectRole(["BIBLIOTECARIO"]);
  const params = await searchParams;
  const selectedType = DOCUMENT_TYPES.includes(params.type as DocumentType)
    ? (params.type as DocumentType)
    : null;
  const documents = await query<LibraryDocument>(
    `SELECT d.id, d.doc_type, d.file_name, d.size_bytes, d.created_at,
            u.name AS uploaded_by_name, d.change_request_id,
            cr.change_code, cr.title AS request_title,
            d.work_item_id, wi.title AS work_item_title,
            pci.name AS configuration_item_name, cri.new_version AS configuration_version
     FROM documents d
     INNER JOIN users u ON u.id = d.uploaded_by
     LEFT JOIN change_requests cr ON cr.id = d.change_request_id
     LEFT JOIN work_items wi ON wi.id = d.work_item_id
     LEFT JOIN change_request_configuration_impacts cri
       ON cri.document_id = d.id AND cri.status = 'CHANGED'
     LEFT JOIN project_configuration_items pci ON pci.id = cri.configuration_item_id
     WHERE d.project_id = ?
       ${selectedType ? "AND d.doc_type = ?" : ""}
     ORDER BY d.created_at DESC, d.id DESC`,
    selectedType ? [project.id, selectedType] : [project.id]
  );

  return (
    <AppShell>
      <Panel title="Repositorio de documentos" eyebrow="Todos los archivos del proyecto">
        <form method="get" className="button-row">
          <label className="field">
            <span>Tipo de documento</span>
            <select name="type" defaultValue={selectedType || ""}>
              <option value="">Todos los tipos</option>
              {DOCUMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {DOCUMENT_LABELS[type]}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">Filtrar</button>
          {selectedType ? (
            <Link className="button button-secondary" href="/librarian/documents">
              Limpiar
            </Link>
          ) : null}
        </form>

        {documents.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Documento</th>
                  <th>Tipo</th>
                  <th>Contexto</th>
                  <th>Solicitud</th>
                  <th>Subido por</th>
                  <th>Fecha</th>
                  <th>Descarga</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((document) => (
                  <tr key={document.id}>
                    <td>
                      <strong>{document.file_name}</strong>
                      <br />
                      <span className="muted">{formatBytes(document.size_bytes)}</span>
                    </td>
                    <td>{DOCUMENT_LABELS[document.doc_type]}</td>
                    <td>
                      {document.configuration_item_name
                        ? `${document.configuration_item_name} · V${document.configuration_version}`
                        : document.work_item_title || "Documento general"}
                    </td>
                    <td>
                      {document.change_request_id && document.change_code && document.request_title ? (
                        <RequestLink
                          id={document.change_request_id}
                          code={document.change_code}
                          title={document.request_title}
                        />
                      ) : (
                        <span className="muted">Sin solicitud</span>
                      )}
                    </td>
                    <td>{document.uploaded_by_name}</td>
                    <td>{formatDateTime(document.created_at)}</td>
                    <td>
                      <Link
                        className="icon-text-button"
                        href={`/api/documents/${document.id}`}
                        title={`Descargar ${document.file_name}`}
                      >
                        <Download size={16} />
                        <span>Descargar</span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Sin documentos">No hay archivos para el filtro seleccionado.</EmptyState>
        )}
      </Panel>
    </AppShell>
  );
}
