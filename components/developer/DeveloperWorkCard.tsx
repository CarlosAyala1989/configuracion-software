"use client";

import { ChevronRight, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { developerProgressAction } from "@/app/actions/work-items";
import { ProgressBar, StatusBadge } from "@/components/ui";
import type { WorkItemRow } from "@/lib/types";

export type DeveloperConfigurationImpact = {
  id: number;
  change_request_id: number;
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

export function DeveloperWorkCard({
  item,
  impacts,
  today,
  githubIntegration,
  defaultOpen = false
}: {
  item: WorkItemRow;
  impacts: DeveloperConfigurationImpact[];
  today: string;
  githubIntegration: { repository: string; developmentBranch: string } | null;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [progress, setProgress] = useState(Number(item.progress_percent || 0));
  const [markComplete, setMarkComplete] = useState(false);
  const [resolutions, setResolutions] = useState<Record<number, string>>({});
  const remaining = 100 - progress;

  useEffect(() => {
    if (!open) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  function updateProgress(value: string) {
    const next = Math.max(0, Math.min(100, Number(value) || 0));
    setProgress(next);
  }

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
            aria-labelledby={`dev-card-${item.id}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2 id={`dev-card-${item.id}`}>#{item.id} {item.title}</h2>
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
                <span>Estado</span>
                <StatusBadge status={item.status} compact />
              </div>
              <div className="detail-item">
                <span>Avance actual</span>
                <strong>{item.progress_percent}%</strong>
                <ProgressBar value={item.progress_percent} />
              </div>
              <div className="detail-item">
                <span>Rama GitHub</span>
                <strong>{item.github_branch || "Pendiente"}</strong>
              </div>
              <div className="detail-item">
                <span>Solicitud</span>
                <strong>{item.request_title}</strong>
              </div>
            </div>

            <p>{item.description}</p>

            {item.status !== "COMPLETED" ? (
              <form action={developerProgressAction} className="form-grid">
                <input type="hidden" name="work_item_id" value={item.id} />
                <label className="field">
                  <span>Fecha de trabajo</span>
                  <input name="work_date" type="date" required defaultValue={today} />
                </label>
                <label className="field">
                  <span>Horas trabajadas hoy</span>
                  <input name="hours_spent" type="number" min="0.1" step="0.1" required />
                </label>
                <label className="field">
                  <span>Porcentaje avanzado</span>
                  <input
                    name="progress_percent"
                    type="number"
                    min="0"
                    max="100"
                    required
                    readOnly={markComplete}
                    value={progress}
                    onChange={(event) => updateProgress(event.target.value)}
                  />
                </label>
                <div className="field">
                  <span>Porcentaje restante</span>
                  <strong className="computed-value">{remaining}%</strong>
                </div>
                {githubIntegration ? (
                  item.github_branch ? (
                    <div className="field">
                      <span>Rama GitHub</span>
                      <Link
                        href={`https://github.com/${githubIntegration.repository}/tree/${item.github_branch
                          .split("/")
                          .map(encodeURIComponent)
                          .join("/")}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {item.github_branch}
                      </Link>
                    </div>
                  ) : (
                    <label className="field">
                      <span>Nombre de nueva rama</span>
                      <input name="github_branch" required placeholder="feature/carrito" />
                    </label>
                  )
                ) : (
                  <label className="field">
                    <span>Rama GitHub</span>
                    <input name="github_branch" defaultValue={item.github_branch ?? undefined} />
                  </label>
                )}
                {githubIntegration ? (
                  <div className="field">
                    <span>Repositorio / destino</span>
                    <strong className="computed-value">
                      {githubIntegration.repository} · {githubIntegration.developmentBranch}
                    </strong>
                  </div>
                ) : null}
                <label className="field field-wide">
                  <span>Que avance hoy</span>
                  <textarea name="today_done" required rows={3} />
                </label>
                <label className="field field-wide">
                  <span>Que avanzare manana</span>
                  <textarea name="tomorrow_plan" required rows={3} />
                </label>
                <label className="field field-wide">
                  <span>Bloqueos u observaciones</span>
                  <textarea name="blockers" rows={3} />
                </label>
                <label className="field field-wide">
                  <span>Documentacion tecnica (obligatoria al completar)</span>
                  <input name="documentation" type="file" accept=".pdf,.doc,.docx" />
                </label>

                {impacts.length ? (
                  <section className="field-wide scm-deliverables">
                    <div>
                      <h3>Elementos SCM del desarrollador</h3>
                      <span className="muted">{impacts.length} elementos</span>
                    </div>
                    {impacts.map((impact) => {
                      const resolution = resolutions[impact.id] || "";
                      const isFirstDelivery = !impact.current_document_id;
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
                                    required={markComplete}
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
                                <textarea
                                  name={`impact_notes_${impact.id}`}
                                  rows={2}
                                  required={markComplete}
                                />
                              </label>
                              {isFirstDelivery || resolution === "changed" ? (
                                <label className="field field-wide">
                                  <span>{isFirstDelivery ? "Primera entrega" : "Entregable actualizado"}</span>
                                  <input
                                    name={`impact_file_${impact.id}`}
                                    type="file"
                                    accept=".pdf,.doc,.docx"
                                    required={markComplete}
                                  />
                                </label>
                              ) : null}
                            </div>
                          ) : (
                            <div className="detail-list">
                              <div className="detail-item">
                                <span>Resultado</span>
                                <strong>{impact.status === "CHANGED" ? `Actualizado a V${impact.new_version}` : "Sin cambio"}</strong>
                              </div>
                              <div className="detail-item">
                                <span>Sustento</span>
                                <strong>{impact.deliverable_notes || "Registrado"}</strong>
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

                <label className="field field-wide checkbox-field">
                  <input
                    name="mark_complete"
                    type="checkbox"
                    checked={markComplete}
                    onChange={(event) => {
                      setMarkComplete(event.target.checked);
                      if (event.target.checked) setProgress(100);
                    }}
                  />
                  <span>Marcar como completado y activar QA</span>
                </label>
                <div className="button-row field-wide">
                  <button type="submit">Registrar avance</button>
                </div>
              </form>
            ) : (
              <p className="muted">La tarjeta ya fue enviada a QA.</p>
            )}
          </div>
        </div>
      ) : null}
    </article>
  );
}
