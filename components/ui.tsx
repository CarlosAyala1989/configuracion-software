import Link from "next/link";
import type { ReactNode } from "react";

import { CHANGE_STATUS_LABELS, WORK_STATUS_LABELS } from "@/lib/types";

export function StatusBadge({ status, compact = false }: { status: string; compact?: boolean }) {
  const tone = status.includes("REJECT") || status.includes("NEGOTIATION") ? "danger" : status.includes("CLOSED") || status.includes("APPROVED") ? "success" : status.includes("CCB") || status.includes("QA") ? "warning" : "info";
  return (
    <span className={`badge badge-${tone} ${compact ? "badge-compact" : ""}`}>
      {CHANGE_STATUS_LABELS[status] || WORK_STATUS_LABELS[status] || status}
    </span>
  );
}

export function PriorityBadge({ value }: { value: string }) {
  const tone = value === "CRITICAL" || value === "HIGH" ? "danger" : value === "LOW" ? "neutral" : "warning";
  return <span className={`badge badge-${tone}`}>{value}</span>;
}

export function ProgressBar({ value }: { value: number }) {
  const width = Math.max(0, Math.min(100, Number(value || 0)));
  return (
    <div className="progress" aria-label={`Avance ${width}%`}>
      <span style={{ width: `${width}%` }} />
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      {children ? <p>{children}</p> : null}
    </div>
  );
}

export function Panel({
  id,
  title,
  eyebrow,
  children,
  actions
}: {
  id?: string;
  title: string;
  eyebrow?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section id={id} className="panel">
      <div className="panel-header">
        <div>
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h2>{title}</h2>
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Field({
  label,
  name,
  type = "text",
  required = false,
  defaultValue,
  placeholder
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  defaultValue?: string | number | null;
  placeholder?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue ?? undefined}
        placeholder={placeholder}
      />
    </label>
  );
}

export function TextArea({
  label,
  name,
  required = false,
  defaultValue,
  placeholder,
  rows = 4
}: {
  label: string;
  name: string;
  required?: boolean;
  defaultValue?: string | null;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <label className="field field-wide">
      <span>{label}</span>
      <textarea name={name} required={required} defaultValue={defaultValue ?? undefined} placeholder={placeholder} rows={rows} />
    </label>
  );
}

export function SelectField({
  label,
  name,
  options,
  defaultValue
}: {
  label: string;
  name: string;
  options: { label: string; value: string | number }[];
  defaultValue?: string | number | null;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select name={name} defaultValue={defaultValue ?? undefined}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function RequestLink({ id, code, title }: { id: number; code: string; title: string }) {
  return (
    <Link className="table-link" href={`/requests/${id}`}>
      <strong>{code}</strong>
      <span>{title}</span>
    </Link>
  );
}
