/**
 * Hard Clock-Out Scheduler
 * Runs every 15 minutes. For any tenant with a configured maxClockInHours,
 * force-closes any master-clock time entry that has been open longer than
 * that limit, so staff can't accidentally leave the clock running overnight
 * (or longer) and inflate payroll hours.
 */

import { db, timeEntriesTable, tenantsTable } from "@workspace/db";
import { eq, and, isNull, sql } from "drizzle-orm";
import { logger } from "./logger";

async function processHardClockOuts() {
  const tenants = await db
    .select({ id: tenantsTable.id, maxClockInHours: tenantsTable.maxClockInHours })
    .from(tenantsTable)
    .where(sql`${tenantsTable.maxClockInHours} IS NOT NULL AND ${tenantsTable.maxClockInHours} > 0`);

  let closed = 0;

  for (const tenant of tenants) {
    const maxHours = tenant.maxClockInHours;
    if (!maxHours) continue;
    const cutoff = new Date(Date.now() - maxHours * 60 * 60 * 1000);

    const openEntries = await db
      .select()
      .from(timeEntriesTable)
      .where(
        and(
          eq(timeEntriesTable.tenantId, tenant.id),
          eq(timeEntriesTable.isMasterClock, true),
          isNull(timeEntriesTable.clockedOutAt),
          sql`${timeEntriesTable.clockedInAt} <= ${cutoff}`,
        ),
      );

    for (const entry of openEntries) {
      // Auto clock-out exactly at the max-hours mark, not at "now", so the
      // recorded duration always matches the configured limit regardless of
      // how long it takes the scheduler to notice.
      const clockedOutAt = new Date(entry.clockedInAt.getTime() + maxHours * 60 * 60 * 1000);
      const totalMinutes = Math.round((clockedOutAt.getTime() - entry.clockedInAt.getTime()) / 60000);

      await db
        .update(timeEntriesTable)
        .set({ clockedOutAt, totalMinutes })
        .where(and(eq(timeEntriesTable.id, entry.id), isNull(timeEntriesTable.clockedOutAt)));

      closed++;
      logger.info(
        { tenantId: tenant.id, timeEntryId: entry.id, userId: entry.userId, maxHours },
        "Hard clock-out: auto clocked out an entry past the max duration",
      );
    }
  }

  if (closed > 0) {
    logger.info({ closed }, "Hard clock-out scheduler: closed entries");
  }
}

export function startClockOutScheduler() {
  logger.info("Starting hard clock-out scheduler (runs every 15 minutes)");

  void processHardClockOuts().catch(err => logger.error({ err }, "Hard clock-out scheduler error"));

  const interval = setInterval(() => {
    void processHardClockOuts().catch(err => logger.error({ err }, "Hard clock-out scheduler error"));
  }, 15 * 60 * 1000);

  interval.unref();
}
