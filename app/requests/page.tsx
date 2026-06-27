import { createChangeRequestAction } from "@/app/actions/requests";
import { AppShell } from "@/components/AppShell";
import { EmptyState, Field, Panel, SelectField, TextArea } from "@/components/ui";
import { canUseRole, getActiveProject, requireUser } from "@/lib/auth";

const priorityOptions = [
  { label: "Baja", value: "LOW" },
  { label: "Media", value: "MEDIUM" },
  { label: "Alta", value: "HIGH" },
  { label: "Critica", value: "CRITICAL" }
];

export default async function RequestsPage({
  searchParams
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const user = await requireUser();
  const { project, role } = await getActiveProject(user);
  const params = await searchParams;

  if (!project) {
    return (
      <AppShell>
        <EmptyState title="Sin proyecto activo">No hay proyectos disponibles para registrar cambios.</EmptyState>
      </AppShell>
    );
  }

  const canRequest = canUseRole(user, role, ["SOLICITANTE"]);
  if (!canRequest) {
    return (
      <AppShell>
        <EmptyState title="Sin permisos">Tu rol no permite crear solicitudes en este proyecto.</EmptyState>
      </AppShell>
    );
  }

  return (
    <AppShell>
      {params.ok ? <div className="ok-banner">Solicitud registrada correctamente.</div> : null}
      {params.error ? <div className="error-banner">Revisa los campos obligatorios.</div> : null}

      <Panel title="Solicitar cambio" eyebrow="Solicitante">
        <form action={createChangeRequestAction} className="form-grid">
          <Field label="Titulo" name="title" required placeholder="Ej. Agregar reporte de ventas" />
          <Field label="Area afectada" name="affected_area" required placeholder="Modulo, proceso o sistema" />
          <TextArea
            label="Que necesitas cambiar"
            name="summary"
            required
            rows={5}
            placeholder="Describe lo que necesitas agregar, modificar o corregir."
          />
          <TextArea
            label="Por que se necesita"
            name="business_reason"
            required
            rows={4}
            placeholder="Explica el motivo, beneficio esperado o problema que resuelve."
          />
          <TextArea
            label="Alcance funcional"
            name="functional_scope"
            rows={4}
            required
            placeholder="Indica que deberia incluir el cambio para el usuario final."
          />
          <TextArea
            label="Criterios de aceptacion"
            name="acceptance_criteria"
            rows={4}
            required
            placeholder="Describe como sabremos que el cambio quedo correctamente."
          />
          <SelectField label="Prioridad" name="priority" options={priorityOptions} defaultValue="MEDIUM" />
          <SelectField label="Riesgo percibido" name="risk_level" options={priorityOptions} defaultValue="MEDIUM" />
          <Field label="Impacto presupuestal estimado" name="budget_impact" type="number" placeholder="0.00" />
          <Field label="Fecha requerida" name="requested_deadline" type="date" />
          <label className="field field-wide">
            <span>Documento de soporte (PDF, DOC, DOCX)</span>
            <input name="attachment" type="file" accept=".pdf,.doc,.docx" />
          </label>
          <div className="button-row field-wide">
            <button type="submit">Enviar solicitud</button>
          </div>
        </form>
      </Panel>
    </AppShell>
  );
}
