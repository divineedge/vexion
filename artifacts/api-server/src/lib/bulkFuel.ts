import { and, eq } from "drizzle-orm";
import {
  bulkFuelTanksTable,
  bulkFuelTransactionsTable,
  equipmentFuelLogsTable,
  equipmentTable,
} from "@workspace/db";

/** PostgreSQL integer columns are deliberately used for inventory arithmetic. */
export const MAX_INVENTORY_INT = 2_000_000_000;

export type BulkFuelLossAlertSettings = {
  periodDays: number;
  gallonThreshold: number | null;
  valueThreshold: number | null;
};

export const DEFAULT_BULK_FUEL_LOSS_ALERT_SETTINGS: BulkFuelLossAlertSettings = {
  periodDays: 30,
  gallonThreshold: null,
  valueThreshold: null,
};

export function parseBulkFuelLossAlertSettings(body: unknown): BulkFuelLossAlertSettings {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("settings body is required");
  }
  const { periodDays, gallonThreshold, valueThreshold } = body as Record<string, unknown>;
  if (!Number.isInteger(periodDays) || (periodDays as number) < 1 || (periodDays as number) > 365) {
    throw new Error("periodDays must be an integer from 1 to 365");
  }
  for (const [name, value] of [["gallonThreshold", gallonThreshold], ["valueThreshold", valueThreshold]] as const) {
    if (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value <= 0)) {
      throw new Error(`${name} must be a positive finite number or null`);
    }
  }
  return {
    periodDays: periodDays as number,
    gallonThreshold: gallonThreshold as number | null,
    valueThreshold: valueThreshold as number | null,
  };
}

export function bulkFuelLossExceedsThreshold(
  lossGallons: number,
  lossValue: number,
  settings: BulkFuelLossAlertSettings,
): boolean {
  return (settings.gallonThreshold !== null && lossGallons > settings.gallonThreshold)
    || (settings.valueThreshold !== null && lossValue > settings.valueThreshold);
}

export function gallonsToThousandths(value: unknown, label = "gallons"): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${label} must be a positive finite number`);
  const result = Math.round(n * 1000);
  if (!Number.isSafeInteger(result) || result <= 0 || result > MAX_INVENTORY_INT) throw new Error(`${label} is too large`);
  return result;
}

export function dollarsToCents(value: unknown, label = "totalCost"): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${label} must be a non-negative finite number`);
  const result = Math.round(n * 100);
  if (!Number.isSafeInteger(result) || result > MAX_INVENTORY_INT) throw new Error(`${label} is too large`);
  return result;
}

export function meterToThousandths(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 ||
    value * 1000 > MAX_INVENTORY_INT || Math.abs(value * 1000 - Math.round(value * 1000)) > 0.00001) {
    throw new Error("Meter reading must be between 0 and 2,000,000 gallons with up to 3 decimal places");
  }
  return Math.round(value * 1000);
}

export function validateMeterInput(meterReading: unknown, expectedMeterReading: unknown, isBulk: boolean): void {
  if (meterReading === undefined && expectedMeterReading === undefined) return;
  if (!isBulk) throw new Error("Tank meter readings require bulk tank fuel");
  const end = meterToThousandths(meterReading);
  const start = meterToThousandths(expectedMeterReading);
  if (end <= start) throw new Error("New tank meter reading must be greater than the previous reading");
}

export function tenantDateKey(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find(part => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Accept date-only legacy form values or complete ISO instants, then persist a tenant calendar key. */
export function normalizeFuelDate(value: unknown, timezone: string): string {
  if (isDateKey(value)) return value;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new Error("date must be YYYY-MM-DD or an ISO timestamp with timezone");
  }
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) throw new Error("date must be a valid ISO timestamp");
  return tenantDateKey(instant, timezone);
}

export function isDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  return month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function formatTank(tank: typeof bulkFuelTanksTable.$inferSelect) {
  return {
    id: tank.id, name: tank.name, fuelType: tank.fuelType,
    capacityGallons: tank.capacityThousandths == null ? null : tank.capacityThousandths / 1000,
    isActive: tank.isActive, availableGallons: tank.availableThousandths / 1000,
    inventoryValue: tank.inventoryValueCents / 100,
    currentMeterReading: tank.meterThousandths == null ? null : tank.meterThousandths / 1000,
    unitCostPerGallon: tank.availableThousandths > 0
      ? Math.round((tank.inventoryValueCents / tank.availableThousandths) * 1_000_000) / 100_000
      : 0,
    createdAt: tank.createdAt.toISOString(),
  };
}

export function formatTransaction(
  row: typeof bulkFuelTransactionsTable.$inferSelect,
) {
  return {
    id: row.id, tankId: row.tankId, type: row.type as "delivery" | "opening_balance" | "dispense" | "reversal" | "adjustment",
    reason: row.reason ?? null, actorId: row.actorId ?? null, actorName: row.actorName ?? null,
    beforeGallons: row.beforeThousandths == null ? null : row.beforeThousandths / 1000,
    afterGallons: row.afterThousandths == null ? null : row.afterThousandths / 1000,
    beforeValue: row.beforeValueCents == null ? null : row.beforeValueCents / 100,
    afterValue: row.afterValueCents == null ? null : row.afterValueCents / 100,
    date: row.date, gallons: row.gallonsThousandths / 1000, totalCost: row.totalCostCents / 100,
    costPerGallon: row.gallonsThousandths === 0 ? 0 : Math.round((row.totalCostCents / row.gallonsThousandths) * 1_000_000) / 100_000,
    supplier: row.supplier ?? null, reference: row.reference ?? null, notes: row.notes ?? null,
    equipmentId: row.equipmentId ?? null, equipmentName: row.equipmentName ?? null,
    fuelLogId: row.fuelLogId ?? null, createdAt: row.createdAt.toISOString(),
    meterReadingBefore: row.meterBeforeThousandths == null ? null : row.meterBeforeThousandths / 1000,
    meterReadingAfter: row.meterAfterThousandths == null ? null : row.meterAfterThousandths / 1000,
  };
}

export function formatFuelLog(row: typeof equipmentFuelLogsTable.$inferSelect) {
  return {
    ...row,
    fuelSource: row.fuelSource as "purchased" | "bulk_tank",
    bulkFuelTankId: row.bulkFuelTankId ?? null,
    bulkFuelTankName: row.bulkFuelTankName ?? null,
    costPerGallon: row.costPerGallon ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

type Tx = any;

/** Caller must already lock the equipment row. Locks tank second to enforce order. */
export async function dispenseBulkFuel(tx: Tx, args: {
  tenantId: number; equipment: typeof equipmentTable.$inferSelect; tankId: number;
  date: string; gallonsThousandths: number; jobId: number | null; odometerReading: number | null;
  idempotencyKey: string;
  meterReading?: number; expectedMeterReading?: number;
}) {
  const [tank] = await tx.select().from(bulkFuelTanksTable).where(and(
    eq(bulkFuelTanksTable.id, args.tankId), eq(bulkFuelTanksTable.tenantId, args.tenantId),
  )).for("update");
  if (!tank) throw new Error("Bulk fuel tank not found");
  if (!tank.isActive) throw new Error("Bulk fuel tank is inactive");
  validateMeterInput(args.meterReading, args.expectedMeterReading, true);
  let meterAfter: number | null = tank.meterThousandths == null ? null : tank.meterThousandths + args.gallonsThousandths;
  if (args.meterReading !== undefined) {
    if (tank.meterThousandths == null) throw new Error("Set the tank's starting meter reading before recording meter-based fills");
    if (meterToThousandths(args.expectedMeterReading) !== tank.meterThousandths) {
      throw new Error("Tank meter reading changed. Refresh the tank and reconfirm this fill before saving.");
    }
    meterAfter = meterToThousandths(args.meterReading);
    const dispensed = meterAfter - tank.meterThousandths;
    if (dispensed <= 0 || dispensed !== args.gallonsThousandths) throw new Error("Gallons must match the change in tank meter reading");
    args = { ...args, gallonsThousandths: dispensed };
  }
  if (meterAfter != null && meterAfter > MAX_INVENTORY_INT) throw new Error("Tank meter reading exceeds its supported range");
  if (tank.availableThousandths < args.gallonsThousandths) throw new Error("Insufficient bulk fuel inventory");

  // This allocation preserves all cents on the final draw.  Earlier log prices
  // are snapshots and are never revised after later deliveries.
  const allocatedCents = args.gallonsThousandths === tank.availableThousandths
    ? tank.inventoryValueCents
    : Math.round(tank.inventoryValueCents * args.gallonsThousandths / tank.availableThousandths);
  const remainingGallons = tank.availableThousandths - args.gallonsThousandths;
  const remainingValue = tank.inventoryValueCents - allocatedCents;
  const gallons = args.gallonsThousandths / 1000;
  const cost = allocatedCents / 100;
  const costPerGallon = gallons ? cost / gallons : 0;
  const [fuel] = await tx.insert(equipmentFuelLogsTable).values({
    equipmentId: args.equipment.id, tenantId: args.tenantId, jobId: args.jobId, date: args.date,
    gallons, cost, costPerGallon, odometerReading: args.odometerReading,
    fuelSource: "bulk_tank", bulkFuelTankId: tank.id, bulkFuelTankName: tank.name,
    idempotencyKey: args.idempotencyKey,
  }).returning();
  await tx.update(bulkFuelTanksTable).set({
    availableThousandths: remainingGallons, inventoryValueCents: remainingValue,
    meterThousandths: meterAfter,
  }).where(eq(bulkFuelTanksTable.id, tank.id));
  const [movement] = await tx.insert(bulkFuelTransactionsTable).values({
    tankId: tank.id, tenantId: args.tenantId, type: "dispense", date: args.date,
    gallonsThousandths: -args.gallonsThousandths, totalCostCents: -allocatedCents,
    equipmentId: args.equipment.id, equipmentName: args.equipment.name, fuelLogId: fuel.id,
    idempotencyKey: args.idempotencyKey,
    meterBeforeThousandths: tank.meterThousandths,
    meterAfterThousandths: meterAfter,
  }).returning();
  return { fuel, movement, tank, cost, costPerGallon };
}