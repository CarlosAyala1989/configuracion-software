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

export type QaConfigurationImpact = {
  id: number;
  change_request_id: number;
  element_code: string;
  item_name: string;
  item_category: string;
  status: string;
  old_version: number;
  new_version: number | null;
  deliverable_notes: string | null;
  document_id: number | null;
  document_file_name: string | null;
  current_version: number;
  current_document_id: number | null;
  current_document_file_name: string | null;
};

export function QaWorkCard({
  item,
  documents,
  impacts,
  defaultOpen = false
}: {
  item: QaWorkItem;
  documents: DevDocument[];
  impacts: QaConfigurationImpact[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [resolutions, setResolutions] = useState<Record<number, string>>({});

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
              {impacts.length ? (
                <section className="field-wide scm-deliverables">
                  <div>
                    <h3>Elementos SCM de QA</h3>
                    <span className="muted">Se completan al aprobar</span>
                  </div>
                  {impacts.map((impact) => {
                    const resolution = resolutions[impact.id] || "";
                    const isFirstDelivery = !impact.current_document_id;
                    const usesReviewEvidence = impact.element_code === "QA_EVIDENCE";
                    return (
                      <fieldset className="scm-deliverable" key={impact.id}>
                        <legend>{impact.item_name}</legend>
                        <p className="muted">
                          {impact.item_category} · {impact.current_document_id ? `V${impact.current_version}` : "Sin entrega previa"}
                        </p>
                        {impact.current_document_id ? (
                          <Link href={`/api/documents/${impact.current_document_id}`}>
                            Documentacion vigente: {impact.current_document_file_name || `V${impact.current_version}`}
                          </Link>
                        ) : null}
                        {impact.status === "PENDING" ? (
                          <div className="form-grid">
                            {isFirstDelivery ? (
                              <div className="field">
                                <span>Resultado</span>
                                <strong className="computed-value">Carga inicial obligatoria</strong>
                                <input
                                  type="hidden"
                                  name={`impact_resolution_${impact.id}`}
                                  value="changed"
                                />
                              </div>
                            ) : (
                              <label className="field">
                                <span>Resultado</span>
                                <select
                                  name={`impact_resolution_${impact.id}`}
                                  value={resolution}
                                  onChange={(event) =>
                                    setResolutions((current) => ({
                                      ...current,
                                      [impact.id]: event.target.value
                                    }))
                                  }
                                >
                                  <option value="">Seleccionar</option>
                                  <option value="changed">Elemento actualizado</option>
                                  <option value="no_change">Usar documentacion vigente</option>
                                </select>
                              </label>
                            )}
                            <label className="field field-wide">
                              <span>Sustento</span>
                              <textarea name={`impact_notes_${impact.id}`} rows={2} />
                            </label>
                            {isFirstDelivery || resolution === "changed" ? (
                              usesReviewEvidence ? (
                                <div className="field field-wide">
                                  <span>Entregable</span>
                                  <strong className="computed-value">Se usara la evidencia QA adjunta</strong>
                                </div>
                              ) : (
                                <label className="field field-wide">
                                  <span>{isFirstDelivery ? "Primera entrega" : "Entregable actualizado"}</span>
                                  <input
                                    name={`impact_file_${impact.id}`}
                                    type="file"
                                    accept=".pdf,.doc,.docx"
                                  />
                                </label>
                              )
                            ) : null}
                          </div>
                        ) : (
                          <div className="detail-list">
                            <div className="detail-item">
                              <span>Resultado</span>
                              <strong>{impact.status === "CHANGED" ? `Actualizado a V${impact.new_version}` : "Documentacion vigente reutilizada"}</strong>
                            </div>
                            {impact.document_id ? (
                              <Link href={`/api/documents/${impact.document_id}`}>
                                {impact.document_file_name || "Ver entregable"}
                              </Link>
                            ) : null}
                          </div>
                        )}
                      </fieldset>
                    );
                  })}
                </section>
              ) : null}
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
