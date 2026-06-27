"use client";

import { GitBranch, KeyRound } from "lucide-react";
import { useMemo, useState, useTransition } from "react";

import {
  createProjectAction,
  loadGithubTokenOwnerAction,
  updateProjectAction,
  updateProjectGithubAction
} from "@/app/actions/admin";
import {
  METHODOLOGY_OPTIONS,
  getConfigurationItemsForMethodology,
  getDefaultConfigurationCodes,
  methodologyLabel,
  normalizeMethodology,
  type MethodologyCode
} from "@/lib/configuration";
import {
  buildDeliveryPeriods,
  deliveryCadenceLabel,
  parseDeliveryCadence,
  type DeliveryCadence
} from "@/lib/deliveries";
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
  delivery_cadence: string | null;
  delivery_count: number;
  item_codes: string | null;
  github_owner_login: string | null;
  github_repository: string | null;
  github_development_branch: string | null;
  github_configured: number;
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

type GithubOwner = {
  login: string;
  name: string | null;
  avatarUrl: string | null;
};

const githubTokenErrors: Record<string, string> = {
  "invalid-token": "GitHub rechazo la API Key ingresada.",
  "insufficient-permissions": "La API Key no tiene los permisos necesarios.",
  "github-unavailable": "GitHub no esta disponible. Intenta nuevamente."
};

function GithubRepositorySetupFields() {
  const [token, setToken] = useState("");
  const [owner, setOwner] = useState<GithubOwner | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function loadOwner() {
    setError("");
    setOwner(null);
    startTransition(async () => {
      const result = await loadGithubTokenOwnerAction(token);
      if (!result.ok) {
        setError(githubTokenErrors[result.error] || "No se pudo consultar el propietario de la API Key.");
        return;
      }
      setOwner(result.owner);
    });
  }

  return (
    <>
      <label className="field field-wide">
        <span>API Key de GitHub</span>
        <input
          name="github_token"
          type="password"
          required
          autoComplete="new-password"
          value={token}
          onChange={(event) => {
            setToken(event.target.value);
            setOwner(null);
            setError("");
          }}
        />
      </label>
      <div className="button-row field-wide compact-row">
        <button type="button" className="button-secondary" disabled={!token.trim() || pending} onClick={loadOwner}>
          <KeyRound size={16} />
          {pending ? "Consultando..." : "Cargar API Key"}
        </button>
      </div>
      {error ? <div className="error-banner field-wide">{error}</div> : null}
      {owner ? (
        <>
          <label className="field">
            <span>Propietario de GitHub</span>
            <input readOnly value={owner.name ? `${owner.name} (@${owner.login})` : `@${owner.login}`} />
          </label>
          <label className="field">
            <span>Nombre del repositorio</span>
            <input name="github_repository_name" required placeholder="gestion-configuracion" />
          </label>
        </>
      ) : null}
    </>
  );
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
  const [startDate, setStartDate] = useState(project?.start_date || "");
  const [endDate, setEndDate] = useState(project?.end_date || "");
  const initialDeliveryCadence = parseDeliveryCadence(project?.delivery_cadence) || "WEEK";
  const [createDeliveryPlan, setCreateDeliveryPlan] = useState(Boolean(project?.delivery_cadence));
  const [deliveryCadence, setDeliveryCadence] = useState<DeliveryCadence>(initialDeliveryCadence);
  const [githubEnabled, setGithubEnabled] = useState(false);

  const visibleItems = useMemo(() => getConfigurationItemsForMethodology(methodology), [methodology]);
  const groupedItems = useMemo(() => {
    return visibleItems.reduce<Record<string, typeof visibleItems>>((groups, item) => {
      groups[item.category] = groups[item.category] || [];
      groups[item.category].push(item);
      return groups;
    }, {});
  }, [visibleItems]);
  const deliveryCount = useMemo(
    () => buildDeliveryPeriods(startDate, endDate, deliveryCadence).length,
    [startDate, endDate, deliveryCadence]
  );

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

              {mode === "create" ? (
                <>
                  <label className="field field-wide checkbox-field">
                    <input
                      name="github_enabled"
                      type="checkbox"
                      checked={githubEnabled}
                      onChange={(event) => setGithubEnabled(event.target.checked)}
                    />
                    <span>Integrar proyecto con GitHub</span>
                  </label>
                  {githubEnabled ? <GithubRepositorySetupFields /> : null}
                </>
              ) : null}

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
                <input
                  name="start_date"
                  type="date"
                  required
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Dia de fin</span>
                <input
                  name="end_date"
                  type="date"
                  required
                  min={startDate || undefined}
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                />
              </label>
              <label className="field field-wide checkbox-field">
                <input
                  name="create_delivery_plan"
                  type="checkbox"
                  checked={createDeliveryPlan}
                  onChange={(event) => setCreateDeliveryPlan(event.target.checked)}
                />
                <span>Definir entregas ahora (opcional)</span>
              </label>
              {createDeliveryPlan ? (
                <>
                  <label className="field">
                    <span>Separar entregas por</span>
                    <select
                      name="delivery_cadence"
                      value={deliveryCadence}
                      onChange={(event) => setDeliveryCadence(event.target.value as DeliveryCadence)}
                    >
                      <option value="WEEK">Semanas</option>
                      <option value="DAY">Dias</option>
                    </select>
                  </label>
                  <div className="field">
                    <span>Entregas previstas</span>
                    <strong>{deliveryCount}</strong>
                  </div>
                </>
              ) : null}
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

function GithubProjectDialog({ project }: { project: AdminProjectRow }) {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(Boolean(project.github_configured));
  const [replaceIntegration, setReplaceIntegration] = useState(!project.github_configured);

  return (
    <>
      <button type="button" className="button-secondary" onClick={() => setOpen(true)}>
        <GitBranch size={16} />
        GitHub
      </button>
      {open ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`GitHub de ${project.title}`}>
          <div className="modal">
            <div className="modal-header">
              <h2>GitHub · {project.title}</h2>
              <button type="button" className="button-secondary" onClick={() => setOpen(false)}>
                Cerrar
              </button>
            </div>
            <form action={updateProjectGithubAction} className="form-grid">
              <input type="hidden" name="project_id" value={project.id} />
              <input type="hidden" name="project_title" value={project.title} />
              <label className="field field-wide checkbox-field">
                <input
                  name="github_enabled"
                  type="checkbox"
                  checked={enabled}
                  onChange={(event) => setEnabled(event.target.checked)}
                />
                <span>Integracion GitHub activa</span>
              </label>
              {enabled ? (
                <>
                  {project.github_configured ? (
                    <>
                      <label className="field">
                        <span>Propietario de GitHub</span>
                        <input readOnly value={`@${project.github_owner_login || "desconocido"}`} />
                      </label>
                      <label className="field">
                        <span>Repositorio</span>
                        <input readOnly value={project.github_repository || ""} />
                      </label>
                      <label className="field field-wide">
                        <span>Rama base</span>
                        <input readOnly value={project.github_development_branch || ""} />
                      </label>
                      <label className="field field-wide checkbox-field">
                        <input
                          name="replace_github_integration"
                          type="checkbox"
                          checked={replaceIntegration}
                          onChange={(event) => setReplaceIntegration(event.target.checked)}
                        />
                        <span>Crear otro repositorio con una API Key diferente</span>
                      </label>
                    </>
                  ) : null}
                  {replaceIntegration ? <GithubRepositorySetupFields /> : null}
                </>
              ) : null}
              <div className="button-row field-wide">
                <button type="submit">Guardar integracion</button>
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
              <th>Entregas</th>
              <th>ECS</th>
              <th>Solicitudes</th>
              <th>GitHub</th>
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
                  <td>
                    {Number(project.delivery_count || 0) > 0 ? (
                      `${project.delivery_count} / ${deliveryCadenceLabel(project.delivery_cadence)}`
                    ) : (
                      <span className="badge badge-warning">Pendiente</span>
                    )}
                  </td>
                  <td>{codesFromCsv(project.item_codes).length}</td>
                  <td>{project.request_count}</td>
                  <td>
                    {project.github_configured ? (
                      <>
                        <strong>{project.github_repository}</strong>
                        <br />
                        <span className="muted">
                          @{project.github_owner_login || "desconocido"} · {project.github_development_branch}
                        </span>
                      </>
                    ) : (
                      <span className="badge badge-neutral">Sin integrar</span>
                    )}
                  </td>
                  <td>
                    <div className="button-row compact-row">
                      {locked ? (
                        <span className="badge badge-neutral">Bloqueado</span>
                      ) : (
                        <ProjectDialog mode="edit" project={project} templates={templates} />
                      )}
                      <GithubProjectDialog project={project} />
                    </div>
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
