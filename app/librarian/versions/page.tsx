import { Download } from "lucide-react";
import Link from "next/link";

import { AppShell } from "@/components/AppShell";
import { EmptyState, Panel, RequestLink } from "@/components/ui";
import { requireProjectRole } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

type ConfigurationItem = {
  id: number;
  name: string;
  category: string;
  current_version: number;
  current_document_id: number | null;
};

type ConfigurationVersion = {
  id: number;
  configuration_item_id: number;
  item_name: string;
  item_category: string;
  version: number;
  document_id: number;
  file_name: string;
  size_bytes: number;
  change_request_id: number;
  change_code: string;
  request_title: string;
  resolver_name: string | null;
  resolved_at: string;
  is_current: number;
};

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function LibrarianVersionsPage({
  searchParams
}: {
  searchParams: Promise<{ item?: string }>;
}) {
  const { project } = await requireProjectRole(["BIBLIOTECARIO"]);
  const params = await searchParams;
  const items = await query<ConfigurationItem>(
    `SELECT id, name, category, current_version, current_document_id
     FROM project_configuration_items
     WHERE project_id = ? AND active = 1
     ORDER BY category, name`,
    [project.id]
  );
  const selectedItemId = items.some((item) => item.id === Number(params.item))
    ? Number(params.item)
    : null;
  const versions = await query<ConfigurationVersion>(
    `SELECT cri.id, pci.id AS configuration_item_id, pci.name AS item_name,
            pci.category AS item_category, cri.new_version AS version,
            cri.document_id, d.file_name, d.size_bytes,
            cr.id AS change_request_id, cr.change_code, cr.title AS request_title,
            u.name AS resolver_name, cri.resolved_at,
            (pci.current_document_id = cri.document_id) AS is_current
     FROM change_request_configuration_impacts cri
     INNER JOIN project_configuration_items pci ON pci.id = cri.configuration_item_id
     INNER JOIN change_requests cr ON cr.id = cri.change_request_id
     INNER JOIN documents d ON d.id = cri.document_id
     LEFT JOIN users u ON u.id = cri.resolved_by
     WHERE pci.project_id = ?
       AND cri.status = 'CHANGED'
       AND cri.new_version IS NOT NULL
       AND cri.document_id IS NOT NULL
       ${selectedItemId ? "AND pci.id = ?" : ""}
     ORDER BY pci.category, pci.name, cri.new_version DESC, cri.resolved_at DESC`,
    selectedItemId ? [project.id, selectedItemId] : [project.id]
  );

  const versionedItems = items.filter((item) => item.current_document_id).length;
  const latestVersion = items.reduce((max, item) => Math.max(max, Number(item.current_version || 0)), 0);

  return (
    <AppShell>
      <section className="grid grid-4">
        <div className="metric">
          <span>Elementos SCM</span>
          <strong>{items.length}</strong>
        </div>
        <div className="metric">
          <span>Con linea base</span>
          <strong>{versionedItems}</strong>
        </div>
        <div className="metric">
          <span>Versiones disponibles</span>
          <strong>{versions.length}</strong>
        </div>
        <div className="metric">
          <span>Version mayor</span>
          <strong>{latestVersion ? `V${latestVersion}` : "-"}</strong>
        </div>
      </section>

      <Panel title="Historial de versiones SCM" eyebrow="Biblioteca del proyecto">
        <form method="get" className="button-row">
          <label className="field">
            <span>Elemento de configuracion</span>
            <select name="item" defaultValue={selectedItemId || ""}>
              <option value="">Todos los elementos</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">Filtrar</button>
          {selectedItemId ? (
            <Link className="button button-secondary" href="/librarian/versions">
              Limpiar
            </Link>
          ) : null}
        </form>

        {versions.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Elemento</th>
                  <th>Version</th>
                  <th>Solicitud</th>
                  <th>Archivo</th>
                  <th>Responsable</th>
                  <th>Fecha</th>
                  <th>Descarga</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((version) => (
                  <tr key={version.id}>
                    <td>
                      <strong>{version.item_name}</strong>
                      <br />
                      <span className="muted">{version.item_category}</span>
                    </td>
                    <td>
                      <strong>V{version.version}</strong>
                      {version.is_current ? <span className="badge badge-success badge-compact">Vigente</span> : null}
                    </td>
                    <td>
                      <RequestLink
                        id={version.change_request_id}
                        code={version.change_code}
                        title={version.request_title}
                      />
                    </td>
                    <td>
                      {version.file_name}
                      <br />
                      <span className="muted">{formatBytes(version.size_bytes)}</span>
                    </td>
                    <td>{version.resolver_name || "Sin responsable registrado"}</td>
                    <td>{formatDateTime(version.resolved_at)}</td>
                    <td>
                      <Link
                        className="icon-text-button"
                        href={`/api/documents/${version.document_id}`}
                        title={`Descargar ${version.item_name} V${version.version}`}
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
          <EmptyState title="Sin versiones">
            {selectedItemId
              ? "Este elemento todavia no tiene entregas versionadas."
              : "El proyecto todavia no tiene entregas SCM versionadas."}
          </EmptyState>
        )}
      </Panel>
    </AppShell>
  );
}
