"use client";

import { ChevronRight, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { qaReviewAction } from "@/app/actions/work-items";
import { ProgressBar, StatusBadge } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import type { WorkItemRow } from "@/lib/types";

export type QaWorkItem = WorkItemRow & {
  dev_title: string;
  dev_status: string;
  dev_branch: string | null;
  dev_progress: number;
};

export type DevDocument = {
  id: number;
  work_item_id: number | null;
  file_name: string;
  uploaded_by_name: string;
  created_at: string;
};

export function QaWorkCard({
  item,
  documents,
  defaultOpen = false
}: {
  item: QaWorkItem;
  documents: DevDocument[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (!open) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  return (
    <article className="compact-work-card">
      <button
        type="button"
        className="work-card-trigger"
        onClick={() => setOpen(true)}
        title="Abrir tarjeta"
      >
        <strong>#{item.id} {item.title}</strong>
        <ChevronRight size={18} aria-hidden="true" />
      </button>

      {open ? (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div
            className="modal modal-wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`qa-card-${item.id}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2 id={`qa-card-${item.id}`}>#{item.id} {item.title}</h2>
                <p className="muted">
                  <Link href={`/requests/${item.change_request_id}`}>{item.change_code}</Link> · {item.assignee_name || "Sin asignar"} · V{item.version}
                </p>
              </div>
              <button
                type="button"
                className="icon-button button-secondary"
                onClick={() => setOpen(false)}
                aria-label="Cerrar"
                title="Cerrar"
              >
                <X size={18} />
              </button>
            </div>

            <div className="detail-list modal-section">
              <div className="detail-item">
                <span>Estado QA</span>
                <StatusBadge status={item.status} compact />
              </div>
              <div className="detail-item">
                <span>Tarjeta DEV</span>
                <strong>#{item.parent_work_item_id} {item.dev_title}</strong>
              </div>
              <div className="detail-item">
                <span>Estado DEV</span>
                <StatusBadge status={item.dev_status} compact />
              </div>
              <div className="detail-item">
                <span>Rama GitHub</span>
                <strong>{item.dev_branch || "Pendiente"}</strong>
              </div>
              <div className="detail-item">
                <span>Avance DEV</span>
                <strong>{item.dev_progress}%</strong>
                <ProgressBar value={item.dev_progress} />
              </div>
            </div>

            <p>{item.description}</p>
            <div className="doc-list modal-section">
              {documents.map((document) => (
                <Link key={document.id} href={`/api/documents/${document.id}`}>
                  <span>{document.file_name}</span>
                  <small>{document.uploaded_by_name} · {formatDateTime(document.created_at)}</small>
                </Link>
              ))}
              {documents.length ? null : <span className="muted">Sin documentacion DEV adjunta.</span>}
            </div>

            <form action={qaReviewAction} className="form-grid modal-section">
              <input type="hidden" name="qa_work_item_id" value={item.id} />
              <label className="field field-wide">
                <span>Resultado de la revision</span>
                <textarea name="comments" rows={4} required />
              </label>
              <label className="field">
                <span>Evidencia QA (PDF, DOC, DOCX)</span>
                <input name="evidence" type="file" required accept=".pdf,.doc,.docx" />
              </label>
              <div className="button-row field-wide">
                <button type="submit" name="verdict" value="approve">
                  Aprobar QA
                </button>
                <button className="button-danger" type="submit" name="verdict" value="reject">
                  Rechazar y devolver a DEV
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </article>
  );
}
