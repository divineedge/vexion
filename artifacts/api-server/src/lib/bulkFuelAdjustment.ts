import { and, desc, eq } from "drizzle-orm";
import { bulkFuelTanksTable, bulkFuelTransactionsTable } from "@workspace/db";
import { MAX_INVENTORY_INT, isDateKey, formatTank, formatTransaction } from "./bulkFuel";

export class AdjustmentError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function adjustmentInput(body: any, commit: boolean) {
  if (!body || typeof body !== "object") throw new AdjustmentError("Adjustment body is required");
  if (typeof body.measuredGallons !== "number" || !Number.isFinite(body.measuredGallons) || body.measuredGallons < 0)
    throw new AdjustmentError("measuredGallons must be a non-negative finite number");
  const qty = Math.round(body.measuredGallons * 1000);
  if (!Number.isSafeInteger(qty) || qty > MAX_INVENTORY_INT) throw new AdjustmentError("measuredGallons is too large");
  if (typeof body.reason !== "string" || !body.reason.trim() || body.reason.trim().length > 2000)
    throw new AdjustmentError("A reason is required (maximum 2000 characters)");
  if (!isDateKey(body.date)) throw new AdjustmentError("date must be YYYY-MM-DD");
  if (commit && (typeof body.idempotencyKey !== "string" || !body.idempotencyKey.trim() || body.idempotencyKey.length > 200))
    throw new AdjustmentError("idempotencyKey is required (maximum 200 characters)");
  if (commit && (!Number.isSafeInteger(body.expectedMovementId) || body.expectedMovementId < 0))
    throw new AdjustmentError("expectedMovementId from the preview is required");
  return { qty, reason: body.reason.trim(), date: body.date as string,
    key: commit ? body.idempotencyKey.trim() as string : null,
    expectedMovementId: body.expectedMovementId as number };
}

/** Shares the tank row lock with intakes, dispensing and reversals. Never locks equipment. */
export async function reconcileBulkFuel(tx: any, args: {
  tenantId: number; tankId: number; actorId: number; actorName: string; body: any; commit: boolean;
}) {
  const input = adjustmentInput(args.body, args.commit);
  const [tank] = await tx.select().from(bulkFuelTanksTable).where(and(
    eq(bulkFuelTanksTable.id, args.tankId), eq(bulkFuelTanksTable.tenantId, args.tenantId),
  )).for("update");
  if (!tank) throw new AdjustmentError("Bulk fuel tank not found", 404);
  if (args.commit) {
    const [prior] = await tx.select().from(bulkFuelTransactionsTable).where(and(
      eq(bulkFuelTransactionsTable.tankId, tank.id), eq(bulkFuelTransactionsTable.idempotencyKey, input.key!),
    )).limit(1);
    if (prior) {
      if (prior.type !== "adjustment" || prior.afterThousandths !== input.qty || prior.reason !== input.reason ||
        prior.date !== input.date || prior.expectedMovementId !== input.expectedMovementId || prior.actorId !== args.actorId)
        throw new AdjustmentError("Idempotency key was already used with different adjustment details", 409);
      return { tank: formatTank(tank), transaction: formatTransaction(prior), duplicate: true };
    }
  }
  if (!tank.isActive) throw new AdjustmentError("Bulk fuel tank is inactive");
  const [latest] = await tx.select({ id: bulkFuelTransactionsTable.id }).from(bulkFuelTransactionsTable)
    .where(eq(bulkFuelTransactionsTable.tankId, tank.id)).orderBy(desc(bulkFuelTransactionsTable.id)).limit(1);
  const expectedMovementId = latest?.id ?? 0;
  if (args.commit && input.expectedMovementId !== expectedMovementId)
    throw new AdjustmentError("Tank stock changed since preview. Review a new preview before confirming.", 409);
  if (tank.capacityThousandths != null && input.qty > tank.capacityThousandths)
    throw new AdjustmentError("Measured gallons exceed tank capacity");
  if (input.qty === tank.availableThousandths) throw new AdjustmentError("Measured gallons match recorded stock; no adjustment is needed");
  if (tank.availableThousandths === 0 && input.qty > 0)
    throw new AdjustmentError("Cannot increase empty stock without a valuation basis. Record a delivery or opening balance instead.");
  const afterValueCents = input.qty === 0 ? 0 : Math.round(tank.inventoryValueCents * input.qty / tank.availableThousandths);
  if (!Number.isSafeInteger(afterValueCents) || afterValueCents > MAX_INVENTORY_INT)
    throw new AdjustmentError("Adjusted inventory value is too large");
  const preview = {
    beforeGallons: tank.availableThousandths / 1000, afterGallons: input.qty / 1000,
    gallonsChange: (input.qty - tank.availableThousandths) / 1000,
    beforeValue: tank.inventoryValueCents / 100, afterValue: afterValueCents / 100,
    valueChange: (afterValueCents - tank.inventoryValueCents) / 100, expectedMovementId,
  };
  if (!args.commit) return preview;
  const [movement] = await tx.insert(bulkFuelTransactionsTable).values({
    tenantId: args.tenantId, tankId: tank.id, type: "adjustment", date: input.date,
    gallonsThousandths: input.qty - tank.availableThousandths,
    totalCostCents: afterValueCents - tank.inventoryValueCents,
    reason: input.reason, actorId: args.actorId, actorName: args.actorName,
    beforeThousandths: tank.availableThousandths, afterThousandths: input.qty,
    beforeValueCents: tank.inventoryValueCents, afterValueCents,
    expectedMovementId, idempotencyKey: input.key,
  }).returning();
  const [updated] = await tx.update(bulkFuelTanksTable).set({
    availableThousandths: input.qty, inventoryValueCents: afterValueCents,
  }).where(eq(bulkFuelTanksTable.id, tank.id)).returning();
  return { tank: formatTank(updated), transaction: formatTransaction(movement), duplicate: false };
}