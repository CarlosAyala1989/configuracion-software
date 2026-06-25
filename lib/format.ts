export function formatDate(value: string | null | undefined) {
  if (!value) return "Sin fecha";
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);
  return new Intl.DateTimeFormat("es-PE", { dateStyle: "medium" }).format(date);
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "Sin fecha";
  return new Intl.DateTimeFormat("es-PE", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function formatMoney(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "No definido";
  return new Intl.NumberFormat("es-PE", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(Number(value));
}

export function pct(value: number | null | undefined) {
  return `${Math.max(0, Math.min(100, Number(value || 0)))}%`;
}
