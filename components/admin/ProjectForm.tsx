"use client";

import { useMemo, useState } from "react";

import { createProjectAction, updateProjectAction } from "@/app/actions/admin";
import {
  METHODOLOGY_OPTIONS,
  getConfigurationItemsForMethodology,
  getDefaultConfigurationCodes,
  methodologyLabel,
  normalizeMethodology,
  type MethodologyCode
} from "@/lib/configuration";
import { formatDate } from "@/lib/format";

export type AdminProjectRow = {
  id: number;
  title: string;
  description: string | null;
  methodology: string;
  start_date: string;
  end_date: string;
  status: string;
  request_count: number;
  item_codes: string | null;
};

export type ConfigurationTemplateRow = {
  id: number;
  name: string;
  methodology: string;
  description: string | null;
  item_codes: string | null;
};

function codesFromCsv(value: string | null | undefined) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function ProjectDialog({
  mode,
  project,
  templates
}: {
  mode: "create" | "edit";
  project?: AdminProjectRow;
  templates: ConfigurationTemplateRow[];
}) {
  const [open, setOpen] = useState(false);
  const initialMethodology = normalizeMethodology(project?.methodology);
  const initialCodes =
    mode === "edit" && project ? codesFromCsv(project.item_codes) : getDefaultConfigurationCodes(initialMethodology);
  const [methodology, setMethodology] = useState<MethodologyCode>(initialMethodology);
  const [selectedCodes, setSelectedCodes] = useState<string[]>(initialCodes);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [saveTemplate, setSaveTemplate] = useState(false);

  const visibleItems = useMemo(() => getConfigurationItemsForMethodology(methodology), [methodology]);
  const groupedItems = useMemo(() => {
    return visibleItems.reduce<Record<string, typeof visibleItems>>((groups, item) => {
      groups[item.category] = groups[item.category] || [];
      groups[item.category].push(item);
      return groups;
    }, {});
  }, [visibleItems]);

  function changeMethodology(nextMethodology: MethodologyCode) {
    setMethodology(nextMethodology);
    setSelectedTemplateId("");
    setSelectedCodes(getDefaultConfigurationCodes(nextMethodology));
  }

  function applyTemplate(templateId: string) {
    setSelectedTemplateId(templateId);
    setSaveTemplate(false);
    const template = templates.find((item) => String(item.id) === templateId);
    if (!template) return;
    const nextMethodology = normalizeMethodology(template.methodology);
    setMethodology(nextMethodology);
    setSelectedCodes(codesFromCsv(template.item_codes));
  }

  function toggleCode(code: string, checked: boolean) {
    setSelectedCodes((current) => {
      if (checked) return [...new Set([...current, code])];
      return current.filter((item) => item !== code);
    });
  }

  function close() {
    setOpen(false);
    setSaveTemplate(false);
  }

  const action = mode === "create" ? createProjectAction : updateProjectAction;
  const buttonLabel = mode === "create" ? "Crear proyecto" : "Modificar";
  const title = mode === "create" ? "Crear proyecto" : `Modificar ${project?.title}`;
  const isUsingTemplate = selectedTemplateId.length > 0;

  return (
    <>
      <button type="button" className={mode === "create" ? undefined : "button-secondary"} onClick={() => setOpen(true)}>
        {buttonLabel}
      </button>

      {open ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
          <div className="modal modal-wide">
            <div className="modal-header">
              <h2>{title}</h2>
              <button type="button" className="button-secondary" onClick={close}>
                Cerrar
              </button>
            </div>

            <form action={action} className="form-grid project-config-form">
              {project ? <input type="hidden" name="project_id" value={project.id} /> : null}

              <label className="field">
                <span>Titulo</span>
                <input name="title" required defaultValue={project?.title} />
              </label>
              <label className="field">
                <span>Metodologia</span>
                <select
                  name="methodology"
                  value={methodology}
                  onChange={(event) => changeMethodology(event.target.value as MethodologyCode)}
                >
                  {METHODOLOGY_OPTIONS.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Dia de inicio</span>
                <input name="start_date" type="date" required defaultValue={project?.start_date} />
              </label>
              <label className="field">
                <span>Dia de fin</span>
                <input name="end_date" type="date" required defaultValue={project?.end_date} />
              </label>
              <label className="field field-wide">
                <span>Descripcion</span>
                <textarea name="description" rows={3} defaultValue={project?.description ?? undefined} />
              </label>

              <div className="field field-wide">
                <span>Plantilla ECS</span>
                <select value={selectedTemplateId} onChange={(event) => applyTemplate(event.target.value)}>
                  <option value="">Seleccion manual</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name} - {methodologyLabel(template.methodology)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field field-wide">
                <span>Elementos de configuracion</span>
                <div className="project-config-toolbar">
                  <strong>{methodologyLabel(methodology)}</strong>
                  <span>{selectedCodes.length} seleccionados</span>
                  <button
                    type="button"
                    className="button-secondary"
                    disabled={isUsingTemplate}
                    onClick={() => setSelectedCodes(visibleItems.map((item) => item.code))}
                  >
                    Todos
                  </button>
                  <button
                    type="button"
                    className="button-secondary"
                    disabled={isUsingTemplate}
                    onClick={() => setSelectedCodes([])}
                  >
                    Limpiar
                  </button>
                </div>
                {isUsingTemplate
                  ? selectedCodes.map((code) => (
                      <input key={code} type="hidden" name="configuration_item_code" value={code} />
                    ))
                  : null}
                <div className="config-category-list">
                  {Object.entries(groupedItems).map(([category, items]) => (
                    <section key={category} className="config-category">
                      <h3>{category}</h3>
                      <div className="config-checkbox-grid">
                        {items.map((item) => (
                          <label className={`config-check ${isUsingTemplate ? "config-check-disabled" : ""}`} key={item.code}>
                            <input
                              name={isUsingTemplate ? undefined : "configuration_item_code"}
                              type="checkbox"
                              value={item.code}
                              checked={selectedCodes.includes(item.code)}
                              disabled={isUsingTemplate}
                              onChange={(event) => toggleCode(item.code, event.target.checked)}
                            />
                            <span>
                              <strong>{item.name}</strong>
                              <small>{item.description}</small>
                            </span>
                          </label>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              </div>

              {!isUsingTemplate ? (
                <label className="field field-wide checkbox-field">
                  <input
                    name="save_template"
                    type="checkbox"
                    checked={saveTemplate}
                    onChange={(event) => setSaveTemplate(event.target.checked)}
                  />
                  <span>Guardar seleccion como plantilla</span>
                </label>
              ) : null}

              {!isUsingTemplate && saveTemplate ? (
                <>
                  <label className="field">
                    <span>Nombre de plantilla</span>
                    <input name="template_name" defaultValue={project ? `${project.title} - ECS` : ""} />
                  </label>
                  <label className="field">
                    <span>Descripcion de plantilla</span>
                    <input name="template_description" />
                  </label>
                </>
              ) : null}

              <div className="button-row field-wide">
                <button type="submit">{mode === "create" ? "Crear proyecto" : "Guardar cambios"}</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function ProjectManager({
  projects,
  templates
}: {
  projects: AdminProjectRow[];
  templates: ConfigurationTemplateRow[];
}) {
  return (
    <div className="grid">
      <div className="button-row compact-row">
        <ProjectDialog mode="create" templates={templates} />
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Titulo</th>
              <th>Metodologia</th>
              <th>Inicio</th>
              <th>Fin</th>
              <th>Estado</th>
              <th>ECS</th>
              <th>Solicitudes</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((project) => {
              const locked = Number(project.request_count || 0) > 0;
              return (
                <tr key={project.id}>
                  <td>{project.title}</td>
                  <td>{methodologyLabel(project.methodology)}</td>
                  <td>{formatDate(project.start_date)}</td>
                  <td>{formatDate(project.end_date)}</td>
                  <td>{project.status}</td>
                  <td>{codesFromCsv(project.item_codes).length}</td>
                  <td>{project.request_count}</td>
                  <td>
                    {locked ? (
                      <span className="badge badge-neutral">Bloqueado</span>
                    ) : (
                      <ProjectDialog mode="edit" project={project} templates={templates} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Plantilla</th>
              <th>Metodologia</th>
              <th>ECS</th>
              <th>Descripcion</th>
            </tr>
          </thead>
          <tbody>
            {templates.map((template) => (
              <tr key={template.id}>
                <td>{template.name}</td>
                <td>{methodologyLabel(template.methodology)}</td>
                <td>{codesFromCsv(template.item_codes).length}</td>
                <td>{template.description || "Sin descripcion"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
