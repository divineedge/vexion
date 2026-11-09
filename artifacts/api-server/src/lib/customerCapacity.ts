import { and, eq, isNull, sql } from "drizzle-orm";
import { customersTable, db, plansTable, softwareBillingAccountsTable } from "@workspace/db";
import { customerLimitReached, customerPlanLimitMessage, resolveCustomerLimit } from "./customerPlanLimit";

type CapacityTx = Pick<typeof db, "select" | "execute">;

export class CustomerPlanLimitError extends Error {
  status = 402;
  code = "customer_plan_limit";
}

export async function readCustomerPlanUsage(tenantId: number, tx: CapacityTx = db): Promise<{ limit: number | null; activeCount: number }> {
  const [account] = await tx.select({
    planId: softwareBillingAccountsTable.planId,
    planPolicy: softwareBillingAccountsTable.planPolicy,
  }).from(softwareBillingAccountsTable).where(eq(softwareBillingAccountsTable.tenantId, tenantId)).limit(1);
  const [plan] = account?.planId
    ? await tx.select({ maxCustomers: plansTable.maxCustomers, tier: plansTable.tier }).from(plansTable).where(eq(plansTable.id, account.planId)).limit(1)
    : [];
  const limit = resolveCustomerLimit(plan ?? null, account?.planPolicy ?? null);
  const [countRow] = await tx.select({ count: sql<number>`count(*)::int` }).from(customersTable).where(and(
    eq(customersTable.tenantId, tenantId),
    isNull(customersTable.archivedAt),
    isNull(customersTable.mergedIntoCustomerId),
  ));
  return { limit, activeCount: Number(countRow?.count ?? 0) };
}

/** Blocks a new customer only when the active software plan sets a customer maximum. */
export async function assertCustomerPlanLimit(tenantId: number, additional = 1, tx: CapacityTx = db): Promise<void> {
  if (additional <= 0) return;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(426983, ${tenantId})`);
  const usage = await readCustomerPlanUsage(tenantId, tx);
  if (customerLimitReached(usage.activeCount, additional, usage.limit)) {
    throw new CustomerPlanLimitError(customerPlanLimitMessage(usage.limit as number));
  }
}
