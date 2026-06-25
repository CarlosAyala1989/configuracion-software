import { NextRequest, NextResponse } from "next/server";

import { getActiveProject, requireUser } from "@/lib/auth";
import { query } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { project } = await getActiveProject(user);
  const { id } = await params;

  const docs = await query<{
    id: number;
    project_id: number;
    file_name: string;
    mime_type: string;
    content: Buffer;
  }>("SELECT id, project_id, file_name, mime_type, content FROM documents WHERE id = ? LIMIT 1", [
    Number(id)
  ]);

  const doc = docs[0];
  if (!doc || (!user.is_admin && project?.id !== doc.project_id)) {
    return new NextResponse("No encontrado", { status: 404 });
  }

  return new NextResponse(Uint8Array.from(doc.content), {
    headers: {
      "Content-Type": doc.mime_type,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(doc.file_name)}"`
    }
  });
}
