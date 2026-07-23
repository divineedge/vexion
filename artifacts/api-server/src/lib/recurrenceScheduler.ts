/**
 * Recurrence Scheduler
 * Runs every hour and generates the next job instance for each active recurring
 * series whose next occurrence falls within the look-ahead window.
 *
 * Look-ahead window: 7 days (configurable via RECURRENCE_LOOKAHEAD_DAYS env var).
 *
 * Date computation is fully count-based and deterministic:
 *   nextDate = nthOccurrenceAfterRoot(rule, root.scheduledAt, root.recurrenceCount)
 *
 * This means:
 *  - Skipping (incrementing recurrenceCount) naturally advances the series to
 *    the next slot — no reliance on lastChild.scheduledAt, so skip is correct.
 *  - The series list uses the same formula and is always consistent.
 *  - Multi-instance safety: atomic CAS on recurrenceCount prevents duplicates.
 */

import { db, jobsTable, servicesTable } from "@workspace/db";
import { eq, and, isNull, isNotNull, ne } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { logger } from "./logger";
import { nthOccurrenceAfterRoot, type RecurrenceRule } from "./recurrenceEngine";
import { isInOffSeason, firstDayAfterOffSeason } from "./offSeasonUtils";

const LOOKAHEAD_DAYS = parseInt(process.env.RECURRENCE_LOOKAHEAD_DAYS ?? "60", 10);

/** Off-season pause: auto-resume any paused series root whose resumeAt date has arrived. */
async function processAutoResume() {
  const now = new Date();
  const resumed = await db.execute(sql`
    UPDATE jobs
    SET is_recurrence_paused = false, resume_at = NULL
    WHERE is_recurrence_paused = true
      AND resume_at IS NOT NULL
      AND resume_at <= ${now}
    RETURNING id
  `);
  const count = (resumed as unknown as { rowCount: number }).rowCount ?? 0;
  if (count > 0) {
    logger.info({ count }, "Recurrence scheduler: auto-resumed off-season series");
  }
}

async function processRecurring() {
  await processAutoResume();

  const now = new Date();
  const lookahead = new Date(now.getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);

  // Fetch all series roots that are active (not paused, not cancelled)
  const roots = await db
    .select()
    .from(jobsTable)
    .where(
      and(
        isNotNull(jobsTable.recurrenceRule),
        isNull(jobsTable.recurrenceParentId),
        eq(jobsTable.isRecurrencePaused, false),
        ne(jobsTable.status, "cancelled"),
      ),
    );

  let generated = 0;

  // Pre-load services for off-season checks (one query, shared across all roots)
  const allServices = await db.select({
    id: servicesTable.id,
    offSeasonStart: servicesTable.offSeasonStart,
    offSeasonEnd: servicesTable.offSeasonEnd,
  }).from(servicesTable);
  const serviceMap = new Map(allServices.map(s => [s.id, s]));

  for (const root of roots) {
    if (!root.recurrenceRule) continue;

    const rule = root.recurrenceRule as unknown as RecurrenceRule;
    const service = root.serviceId ? serviceMap.get(root.serviceId) : null;

    // localCount tracks how many slots we've consumed for this root during this
    // scheduler run. It starts at the DB value and advances with each generated
    // or skipped occurrence, letting us fill the entire look-ahead window in one
    // pass rather than waiting for the next hourly tick.
    let localCount = root.recurrenceCount ?? 0;
    const MAX_PER_ROOT = 52; // safety cap — one year of weekly jobs max per run

    for (let safety = 0; safety < MAX_PER_ROOT; safety++) {
      // Deterministic: compute the next date from root + localCount
      let nextDate = nthOccurrenceAfterRoot(rule, root.scheduledAt, localCount);
      if (!nextDate) break; // series exhausted

      // Off-season: skip occurrences that fall inside the off-season window.
      let skipCount = 0;
      if (service?.offSeasonStart && service?.offSeasonEnd) {
        while (nextDate && isInOffSeason(nextDate, service.offSeasonStart, service.offSeasonEnd)) {
          skipCount++;
          nextDate = nthOccurrenceAfterRoot(rule, root.scheduledAt, localCount + skipCount);
        }
        if (!nextDate) break; // series exhausted after skipping
      }

      // Stop filling once we're past the look-ahead window
      if (nextDate > lookahead) break;

      // Wrap claim + insert in a transaction; CAS on the current localCount.
      let didGenerate = false;
      try {
        await db.transaction(async tx => {
          const claimed = await tx.execute(sql`
            UPDATE jobs
            SET recurrence_count = recurrence_count + ${skipCount + 1}
            WHERE id = ${root.id}
              AND recurrence_count = ${localCount}
          `);
          if ((claimed as unknown as { rowCount: number }).rowCount === 0) {
            throw new Error("CAS_MISS");
          }

          await tx.insert(jobsTable).values({
            tenantId: root.tenantId,
            title: root.title,
            description: root.description,
            status: "scheduled",
            priority: root.priority,
            customerId: root.customerId,
            propertyId: root.propertyId,
            assigneeId: root.assigneeId,
            crewId: root.crewId,
            blueprintId: root.blueprintId,
            planId: root.planId,
            scheduledAt: nextDate,
            estimatedDuration: root.estimatedDuration,
            lineItems: root.lineItems,
            totalAmount: root.totalAmount,
            recurrenceParentId: root.id,
            recurrenceIndex: localCount + skipCount,
            smsReminderEnabled: root.smsReminderEnabled,
          });

          didGenerate = true;
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === "CAS_MISS") {
          // Another instance is generating for this root concurrently — stop
          // filling this root for now; the other instance will handle it.
          break;
        }
        logger.error({ err, rootJobId: root.id }, "Failed to generate recurring job instance");
        break; // don't spin on a hard error
      }

      if (didGenerate) {
        generated++;
        logger.info(
          { rootJobId: root.id, nextDate: nextDate.toISOString(), index: localCount + skipCount },
          "Generated recurring job instance",
        );
        localCount += skipCount + 1; // advance past what we just consumed
      }
    }
  }

  if (generated > 0) {
    logger.info({ generated }, "Recurrence scheduler: generated instances");
  }
}

/** Dev/Test Panel: preview which recurring series for this tenant would generate a new instance right now, without writing anything. */
export async function previewRecurrenceForTenant(tenantId: number) {
  const now = new Date();
  const lookahead = new Date(now.getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);

  const roots = await db
    .select()
    .from(jobsTable)
    .where(and(
      eq(jobsTable.tenantId, tenantId),
      isNotNull(jobsTable.recurrenceRule),
      isNull(jobsTable.recurrenceParentId),
      eq(jobsTable.isRecurrencePaused, false),
      ne(jobsTable.status, "cancelled"),
    ));

  return roots.flatMap(root => {
    if (!root.recurrenceRule) return [];
    const rule = root.recurrenceRule as unknown as RecurrenceRule;
    const currentCount = root.recurrenceCount ?? 0;
    const nextDate = nthOccurrenceAfterRoot(rule, root.scheduledAt, currentCount);
    if (!nextDate) return [];
    return [{
      rootJobId: root.id,
      title: root.title,
      nextDate: nextDate.toISOString(),
      wouldGenerate: nextDate <= lookahead,
    }];
  });
}

/** Dev/Test Panel: actually runs the recurrence generation pass scoped to this tenant right now. */
export async function runRecurrenceForTenantNow(tenantId: number) {
  const now = new Date();
  const lookahead = new Date(now.getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);

  const roots = await db
    .select()
    .from(jobsTable)
    .where(and(
      eq(jobsTable.tenantId, tenantId),
      isNotNull(jobsTable.recurrenceRule),
      isNull(jobsTable.recurrenceParentId),
      eq(jobsTable.isRecurrencePaused, false),
      ne(jobsTable.status, "cancelled"),
    ));

  const results: Array<{ rootJobId: number; title: string; generated: boolean; newJobId?: number }> = [];

  for (const root of roots) {
    if (!root.recurrenceRule) continue;
    const rule = root.recurrenceRule as unknown as RecurrenceRule;
    const currentCount = root.recurrenceCount ?? 0;
    const nextDate = nthOccurrenceAfterRoot(rule, root.scheduledAt, currentCount);
    if (!nextDate || nextDate > lookahead) { results.push({ rootJobId: root.id, title: root.title, generated: false }); continue; }

    let newJobId: number | undefined;
    try {
      await db.transaction(async tx => {
        const claimed = await tx.execute(sql`
          UPDATE jobs SET recurrence_count = recurrence_count + 1
          WHERE id = ${root.id} AND recurrence_count = ${currentCount}
        `);
        if ((claimed as unknown as { rowCount: number }).rowCount === 0) throw new Error("CAS_MISS");

        const [inserted] = await tx.insert(jobsTable).values({
          tenantId: root.tenantId,
          title: root.title,
          description: root.description,
          status: "scheduled",
          priority: root.priority,
          customerId: root.customerId,
          propertyId: root.propertyId,
          assigneeId: root.assigneeId,
          crewId: root.crewId,
          blueprintId: root.blueprintId,
          planId: root.planId,
          scheduledAt: nextDate,
          estimatedDuration: root.estimatedDuration,
          lineItems: root.lineItems,
          totalAmount: root.totalAmount,
          recurrenceParentId: root.id,
          recurrenceIndex: currentCount,
          smsReminderEnabled: root.smsReminderEnabled,
        }).returning({ id: jobsTable.id });
        newJobId = inserted.id;
      });
      results.push({ rootJobId: root.id, title: root.title, generated: true, newJobId });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg !== "CAS_MISS") logger.error({ err, rootJobId: root.id }, "Dev-tools recurrence run failed");
      results.push({ rootJobId: root.id, title: root.title, generated: false });
    }
  }
  return results;
}

export function startRecurrenceScheduler() {
  logger.info("Starting recurrence scheduler (runs every hour)");

  // Run immediately then every hour
  void processRecurring().catch(err => logger.error({ err }, "Recurrence scheduler error"));

  const interval = setInterval(() => {
    void processRecurring().catch(err => logger.error({ err }, "Recurrence scheduler error"));
  }, 60 * 60 * 1000);

  interval.unref();
}
