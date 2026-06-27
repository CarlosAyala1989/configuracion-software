import "server-only";

import type { PoolConnection } from "mysql2/promise";

import { buildDeliveryPeriods, type DeliveryCadence } from "@/lib/deliveries";

export async function replaceProjectDeliveryPlan(
  connection: PoolConnection,
  options: {
    projectId: number;
    startDate: string;
    endDate: string;
    cadence: DeliveryCadence;
    createdBy: number;
  }
) {
  const periods = buildDeliveryPeriods(options.startDate, options.endDate, options.cadence);
  if (periods.length === 0) throw new Error("El rango de fechas del proyecto no es valido.");

  await connection.execute("DELETE FROM project_delivery_plans WHERE project_id = ?", [
    options.projectId
  ]);
  await connection.execute(
    `INSERT INTO project_delivery_plans (project_id, cadence, created_by)
     VALUES (?, ?, ?)`,
    [options.projectId, options.cadence, options.createdBy]
  );

  const values = periods.map(() => "(?, ?, ?, ?)").join(", ");
  const params = periods.flatMap((period) => [
    options.projectId,
    period.sequenceNumber,
    period.startDate,
    period.endDate
  ]);
  await connection.execute(
    `INSERT INTO project_deliveries (project_id, sequence_number, start_date, end_date)
     VALUES ${values}`,
    params
  );

  return periods.length;
}
