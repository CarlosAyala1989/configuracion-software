import { NextRequest, NextResponse } from "next/server";

import { canUseRole, getActiveProject, requireUser } from "@/lib/auth";
import { query } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { project, role } = await getActiveProject(user);
  const { id } = await params;

  const docs = await query<{
    id: number;
    project_id: number;
    file_name: string;
    mime_type: string;
    content: Buffer;
    is_configuration_version: number;
    is_current_configuration_version: number;
  }>(
    `SELECT d.id, d.project_id, d.file_name, d.mime_type, d.content,
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
     WHERE d.id = ?
     LIMIT 1`,
    [Number(id)]
  );

  const doc = docs[0];
  if (!doc || (!user.is_admin && project?.id !== doc.project_id)) {
    return new NextResponse("No encontrado", { status: 404 });
  }
  const canDownloadHistory = user.is_admin || canUseRole(user, role, ["BIBLIOTECARIO"]);
  if (
    doc.is_configuration_version &&
    !doc.is_current_configuration_version &&
    !canDownloadHistory
  ) {
    return new NextResponse("No encontrado", { status: 404 });
  }

  return new NextResponse(Uint8Array.from(doc.content), {
    headers: {
      "Content-Type": doc.mime_type,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(doc.file_name)}"`
    }
  });
}
