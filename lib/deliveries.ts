export const DELIVERY_CADENCES = ["DAY", "WEEK"] as const;

export type DeliveryCadence = (typeof DELIVERY_CADENCES)[number];

export type DeliveryPeriod = {
  sequenceNumber: number;
  startDate: string;
  endDate: string;
};

export function parseDeliveryCadence(value: string | null | undefined): DeliveryCadence | null {
  return DELIVERY_CADENCES.includes(value as DeliveryCadence) ? (value as DeliveryCadence) : null;
}

export function deliveryCadenceLabel(value: string | null | undefined) {
  return value === "DAY" ? "Diarias" : value === "WEEK" ? "Semanales" : "Pendiente";
}

function parseIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || formatIsoDate(date) !== value ? null : date;
}

function formatIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function buildDeliveryPeriods(
  startDate: string,
  endDate: string,
  cadence: DeliveryCadence
): DeliveryPeriod[] {
  const projectStart = parseIsoDate(startDate);
  const projectEnd = parseIsoDate(endDate);
  if (!projectStart || !projectEnd || projectStart > projectEnd) return [];

  const periods: DeliveryPeriod[] = [];
  let periodStart = projectStart;

  while (periodStart <= projectEnd) {
    const cadenceEnd = cadence === "WEEK" ? addDays(periodStart, 6) : periodStart;
    const periodEnd = cadenceEnd > projectEnd ? projectEnd : cadenceEnd;
    periods.push({
      sequenceNumber: periods.length + 1,
      startDate: formatIsoDate(periodStart),
      endDate: formatIsoDate(periodEnd)
    });
    periodStart = addDays(periodEnd, 1);
  }

  return periods;
}
