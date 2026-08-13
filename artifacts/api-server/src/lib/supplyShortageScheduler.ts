/**
 * Supply Shortage Scheduler
 * Runs daily. Looks at jobs scheduled in the next 21 days, aggregates their
 * suppliesNeeded per inventory item, and creates an internal task when projected
 * consumption would push stock below the item's reorder point.
 *
 * Deduplication: skips creating a new task if ANY 'supply_shortage' task
 * (regardless of status — open, done, rejected, etc.) already exists for the
 * same inventory item + tenant within the last 7 days.
 */

import { db, jobsTable, inventoryItemsTable, internalTasksTable, usersTable, tenantsTable } from "@workspace/db";
import { eq, and, sql, gte, lte, inArray } from "drizzle-orm";
import { logger } from "./logger";
import { ADMIN_ROLES } from "./roles";

interface SupplyItem {
  inventoryItemId: number;
  name: string;
  quantity: number;
  unit: string;
}

/**
 * Normalise a raw JSON value into a validated SupplyItem array.
 * Only items with a positive-integer inventoryItemId and a positive finite
 * quantity are kept — everything else is silently dropped.
 */
function normaliseSupplies(raw: unknown): SupplyItem[] {
  if (!Array.isArray(raw)) return [];
  const out: SupplyItem[] = [];
  for (const s of raw) {
    if (typeof s !== "object" || s === null) continue;
    const { inventoryItemId, name, quantity, unit } = s as Record<string, unknown>;
    // Accept only already-integer IDs — string coercion via parseInt silently
    // truncates "1.5" and "1abc" to 1, so we reject non-integer inputs entirely.
    if (!Number.isInteger(inventoryItemId) || (inventoryItemId as number) <= 0) continue;
    const id = inventoryItemId as number;
    const qty = typeof quantity === "number" ? quantity : NaN;
    if (!isFinite(qty) || qty <= 0) continue;
    if (typeof name !== "string" || !name.trim()) continue;
    out.push({ inventoryItemId: id, name: String(name).trim(), quantity: qty, unit: typeof unit === "string" ? unit.trim() : "" });
  }
  return out;
}

async function runSupplyShortageCheck(): Promise<void> {
  logger.info("Supply shortage scheduler: starting daily check");

  const now = new Date();
  const cutoff = new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000);

  const tenants = await db.select({ id: tenantsTable.id }).from(tenantsTable);

  for (const tenant of tenants) {
    try {
      await checkTenant(tenant.id, now, cutoff);
    } catch (err) {
      logger.error({ err, tenantId: tenant.id }, "Supply shortage check failed for tenant");
    }
  }

  logger.info("Supply shortage scheduler: daily check complete");
}

async function checkTenant(tenantId: number, now: Date, cutoff: Date): Promise<void> {
  // Fetch upcoming scheduled jobs that have at least one supply entry
  const jobs = await db
    .select({ id: jobsTable.id, suppliesNeeded: jobsTable.suppliesNeeded })
    .from(jobsTable)
    .where(
      and(
        eq(jobsTable.tenantId, tenantId),
        eq(jobsTable.status, "scheduled"),
        gte(jobsTable.scheduledAt, now),
        lte(jobsTable.scheduledAt, cutoff),
        sql`${jobsTable.suppliesNeeded} IS NOT NULL AND jsonb_array_length(${jobsTable.suppliesNeeded}) > 0`,
      )
    );

  if (jobs.length === 0) return;

  // Aggregate total quantity needed per inventory item (IDs already validated by normaliseSupplies)
  const totals = new Map<number, { name: string; unit: string; qty: number }>();
  for (const job of jobs) {
    for (const s of normaliseSupplies(job.suppliesNeeded)) {
      const existing = totals.get(s.inventoryItemId);
      if (existing) {
        existing.qty += s.quantity;
      } else {
        totals.set(s.inventoryItemId, { name: s.name, unit: s.unit, qty: s.quantity });
      }
    }
  }

  if (totals.size === 0) return;

  const itemIds = Array.from(totals.keys());

  // Fetch current stock for involved items — use inArray (parameterised) for safety
  const items = await db
    .select({
      id: inventoryItemsTable.id,
      name: inventoryItemsTable.name,
      quantity: inventoryItemsTable.quantity,
      reorderPoint: inventoryItemsTable.reorderPoint,
      unit: inventoryItemsTable.unit,
    })
    .from(inventoryItemsTable)
    .where(
      and(
        eq(inventoryItemsTable.tenantId, tenantId),
        inArray(inventoryItemsTable.id, itemIds),
      )
    );

  // Find the first active admin/office user to act as task creator.
  // Uses ADMIN_ROLES — the canonical set shared with the rest of the server.
  const [systemUser] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.tenantId, tenantId),
        inArray(usersTable.role, Array.from(ADMIN_ROLES)),
      )
    )
    .limit(1);

  if (!systemUser) return;

  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  for (const item of items) {
    const needed = totals.get(item.id);
    if (!needed) continue;

    const projectedStock = item.quantity - needed.qty;
    if (projectedStock >= item.reorderPoint) continue;

    // Deduplication: any task for this item in the last 7 days — status-independent —
    // suppresses a new one. Once staff dismiss/complete the task, the alert stays
    // suppressed for the rest of the week. The next weekly run re-evaluates fresh.
    const [existing] = await db
      .select({ id: internalTasksTable.id })
      .from(internalTasksTable)
      .where(
        and(
          eq(internalTasksTable.tenantId, tenantId),
          eq(internalTasksTable.taskType, "supply_shortage"),
          eq(internalTasksTable.contextType, "inventory"),
          eq(internalTasksTable.contextId, item.id),
          gte(internalTasksTable.createdAt, oneWeekAgo),
        )
      )
      .limit(1);

    if (existing) continue;

    const shortage = item.reorderPoint - projectedStock;
    const title = `Low supply: ${item.name} will run short in next 21 days`;
    const description =
      `Current stock: ${item.quantity} ${item.unit}. ` +
      `Upcoming jobs need ${needed.qty} ${item.unit}. ` +
      `Projected remaining: ${projectedStock} ${item.unit} ` +
      `(reorder point: ${item.reorderPoint} ${item.unit}, short by ${shortage} ${item.unit}). ` +
      `Consider reordering before scheduled jobs begin.`;

    await db.insert(internalTasksTable).values({
      tenantId,
      title,
      description,
      taskType: "supply_shortage",
      createdById: systemUser.id,
      assignedToRole: "admin_office",
      priority: shortage > item.reorderPoint ? "high" : "normal",
      status: "open",
      contextType: "inventory",
      contextId: item.id,
    });

    logger.info(
      { tenantId, itemId: item.id, itemName: item.name, projectedStock, reorderPoint: item.reorderPoint },
      "Supply shortage task created"
    );
  }
}

export function startSupplyShortageScheduler(): void {
  logger.info("Starting supply shortage scheduler (runs every 24 hours)");

  runSupplyShortageCheck().catch(err =>
    logger.error({ err }, "Supply shortage scheduler: startup check failed")
  );

  setInterval(
    () => runSupplyShortageCheck().catch(err =>
      logger.error({ err }, "Supply shortage scheduler: periodic check failed")
    ),
    24 * 60 * 60 * 1000,
  );
}
