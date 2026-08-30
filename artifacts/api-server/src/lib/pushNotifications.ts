import {
  db, crewMembersTable, staffNotificationDevicesTable, staffPushDeliveriesTable, usersTable,
} from "@workspace/db";
import { and, eq, inArray, isNotNull, isNull, lt, lte, or, asc } from "drizzle-orm";
import { logger } from "./logger";
import { isExpoPushToken, isRetiredExpoTokenError } from "./pushNotificationHelpers";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
const MAX_ATTEMPTS = 3;
const RECEIPT_BATCH_SIZE = 100;
const RECEIPT_POLL_INTERVAL_MS = 60_000;
const RETRY_POLL_INTERVAL_MS = 30_000;
const CLAIM_LEASE_MS = 2 * 60_000;
const RETRY_BATCH_SIZE = 50;
let receiptPollTimer: NodeJS.Timeout | undefined;
let retryPollTimer: NodeJS.Timeout | undefined;

export type PushData = Record<string, string | number | boolean | null | undefined>;
export type ExpoFetch = typeof fetch;

export { isExpoPushToken, isRetiredExpoTokenError } from "./pushNotificationHelpers";

export type StaffPush = {
  tenantId: number;
  recipientUserIds: number[];
  eventKey: string;
  title: string;
  body: string;
  data: PushData;
};

/** Resolves assignment recipients from tenant-scoped active records only. */
export async function resolveJobAssignmentRecipientIds(
  tenantId: number, assigneeId: number | null, crewId: number | null,
): Promise<number[]> {
  const candidateIds = new Set<number>();
  if (assigneeId) candidateIds.add(assigneeId);
  if (crewId) {
    const members = await db.select({ userId: crewMembersTable.userId }).from(crewMembersTable).where(and(
      eq(crewMembersTable.tenantId, tenantId), eq(crewMembersTable.crewId, crewId),
    ));
    members.forEach(member => candidateIds.add(member.userId));
  }
  if (!candidateIds.size) return [];
  const active = await db.select({ id: usersTable.id }).from(usersTable).where(and(
    eq(usersTable.tenantId, tenantId), eq(usersTable.isActive, true), inArray(usersTable.id, [...candidateIds]),
  ));
  return active.map(user => user.id);
}

/** Resolves a visit's direct assignee, excluding inactive or cross-tenant accounts. */
export async function resolveVisitAssignmentRecipientIds(tenantId: number, assigneeId: number | null): Promise<number[]> {
  if (!assigneeId) return [];
  const active = await db.select({ id: usersTable.id }).from(usersTable).where(and(
    eq(usersTable.id, assigneeId), eq(usersTable.tenantId, tenantId), eq(usersTable.isActive, true),
  )).limit(1);
  return active.map(user => user.id);
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Sends best-effort only. Callers deliberately never await this as mutation success criteria. */
export async function sendStaffPush(push: StaffPush, fetchImpl: ExpoFetch = fetch): Promise<void> {
  try {
    const recipients = [...new Set(push.recipientUserIds)];
    if (!recipients.length) return;
    const devices = await db.select().from(staffNotificationDevicesTable).where(and(
      eq(staffNotificationDevicesTable.tenantId, push.tenantId),
      eq(staffNotificationDevicesTable.isEnabled, true),
      inArray(staffNotificationDevicesTable.userId, recipients),
    ));
    for (const device of devices) {
      // The insert is the durable per-device idempotency claim.
      const now = new Date();
      const [inserted] = await db.insert(staffPushDeliveriesTable).values({
        tenantId: push.tenantId, deviceId: device.id, eventKey: push.eventKey,
        title: push.title, body: push.body, data: push.data,
        claimExpiresAt: new Date(now.getTime() + CLAIM_LEASE_MS),
      }).onConflictDoNothing().returning({ id: staffPushDeliveriesTable.id });
      const delivery = inserted
        ? { id: inserted.id, title: push.title, body: push.body, data: push.data }
        : await claimRetryableDelivery(device.id, push.eventKey, now);
      if (!delivery) continue;
      await deliver(device.id, device.expoPushToken, delivery.id, {
        ...push, title: delivery.title, body: delivery.body, data: delivery.data as PushData,
      }, fetchImpl);
    }
  } catch (err) {
    logger.error({ err, eventKey: push.eventKey, tenantId: push.tenantId }, "Staff push notification failed");
  }
}

async function deliver(deviceId: number, token: string, deliveryId: number, push: StaffPush, fetchImpl: ExpoFetch): Promise<void> {
  if (!isExpoPushToken(token)) {
    await retireDevice(deviceId, "invalid_token");
    await markDelivery(deliveryId, "retired", 0, "invalid_token");
    return;
  }
  let lastError: string | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetchImpl(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ to: token, title: push.title, body: push.body, data: push.data, collapseId: push.eventKey }),
      });
      const payload = await response.json().catch(() => null) as { data?: Array<{ status?: string; id?: string; details?: { error?: string } }> } | null;
      const expoError = payload?.data?.[0]?.details?.error;
      if (isRetiredExpoTokenError(expoError) || !isExpoPushToken(token)) {
        await retireDevice(deviceId, expoError ?? "invalid_token");
        await markDelivery(deliveryId, "retired", attempt, expoError);
        return;
      }
      if (response.ok && payload?.data?.[0]?.status !== "error") {
        await markDelivery(deliveryId, "sent", attempt, undefined, payload?.data?.[0]?.id);
        return;
      }
      lastError = expoError ?? `HTTP ${response.status}`;
      if (response.status !== 429 && response.status < 500) break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : "network_error";
    }
    if (attempt < MAX_ATTEMPTS) await sleep(100 * 2 ** (attempt - 1));
  }
  await markDelivery(deliveryId, "failed", MAX_ATTEMPTS, lastError, undefined, new Date(Date.now() + RETRY_POLL_INTERVAL_MS));
  logger.warn({ deliveryId, deviceId, eventKey: push.eventKey, err: lastError }, "Staff push delivery failed");
}

async function markDelivery(id: number, status: string, attemptCount: number, lastError?: string | null, expoTicketId?: string, nextAttemptAt?: Date | null) {
  await db.update(staffPushDeliveriesTable).set({
    status, attemptCount, lastError: lastError ?? null, expoTicketId,
    sentAt: status === "sent" ? new Date() : undefined,
    nextAttemptAt: nextAttemptAt ?? null, claimExpiresAt: null,
  }).where(eq(staffPushDeliveriesTable.id, id));
}

async function claimRetryableDelivery(deviceId: number, eventKey: string, now: Date) {
  const [delivery] = await db.update(staffPushDeliveriesTable).set({
    status: "claimed", claimExpiresAt: new Date(now.getTime() + CLAIM_LEASE_MS), nextAttemptAt: null,
  }).where(and(
    eq(staffPushDeliveriesTable.deviceId, deviceId), eq(staffPushDeliveriesTable.eventKey, eventKey),
    or(
      and(eq(staffPushDeliveriesTable.status, "failed"), lte(staffPushDeliveriesTable.nextAttemptAt, now)),
      and(eq(staffPushDeliveriesTable.status, "claimed"), lt(staffPushDeliveriesTable.claimExpiresAt, now)),
    ),
  )).returning({
    id: staffPushDeliveriesTable.id, title: staffPushDeliveriesTable.title,
    body: staffPushDeliveriesTable.body, data: staffPushDeliveriesTable.data,
  });
  return delivery;
}

/** Reclaims durable failed/crashed deliveries after a process restart. */
export async function processRetryableStaffPushDeliveries(fetchImpl: ExpoFetch = fetch): Promise<void> {
  try {
    const now = new Date();
    const deliveries = await db.select({
      id: staffPushDeliveriesTable.id, deviceId: staffPushDeliveriesTable.deviceId,
      eventKey: staffPushDeliveriesTable.eventKey, tenantId: staffPushDeliveriesTable.tenantId,
      title: staffPushDeliveriesTable.title, body: staffPushDeliveriesTable.body, data: staffPushDeliveriesTable.data,
      token: staffNotificationDevicesTable.expoPushToken,
    }).from(staffPushDeliveriesTable).innerJoin(staffNotificationDevicesTable,
      eq(staffPushDeliveriesTable.deviceId, staffNotificationDevicesTable.id),
    ).where(and(eq(staffNotificationDevicesTable.isEnabled, true), or(
      and(eq(staffPushDeliveriesTable.status, "failed"), lte(staffPushDeliveriesTable.nextAttemptAt, now)),
      and(eq(staffPushDeliveriesTable.status, "claimed"), lt(staffPushDeliveriesTable.claimExpiresAt, now)),
    ))).orderBy(asc(staffPushDeliveriesTable.createdAt)).limit(RETRY_BATCH_SIZE);
    for (const row of deliveries) {
      const claimed = await claimRetryableDelivery(row.deviceId, row.eventKey, now);
      if (!claimed) continue;
      await deliver(row.deviceId, row.token, claimed.id, {
        tenantId: row.tenantId, recipientUserIds: [], eventKey: row.eventKey,
        title: claimed.title, body: claimed.body, data: claimed.data as PushData,
      }, fetchImpl);
    }
  } catch (err) {
    logger.warn({ err }, "Staff push recovery polling failed");
  }
}

export async function retireDevice(deviceId: number, reason: string): Promise<void> {
  await db.update(staffNotificationDevicesTable).set({ isEnabled: false, disabledAt: new Date() })
    .where(eq(staffNotificationDevicesTable.id, deviceId));
  logger.info({ deviceId, reason }, "Retired staff push device");
}

/** Polls the delayed Expo receipts for a bounded batch of successful sends. */
export async function processExpoPushReceipts(fetchImpl: ExpoFetch = fetch): Promise<void> {
  try {
    const queriedDeliveries = await db.select({
      id: staffPushDeliveriesTable.id,
      deviceId: staffPushDeliveriesTable.deviceId,
      ticketId: staffPushDeliveriesTable.expoTicketId,
    }).from(staffPushDeliveriesTable).where(and(
      eq(staffPushDeliveriesTable.status, "sent"),
      isNotNull(staffPushDeliveriesTable.expoTicketId),
      isNull(staffPushDeliveriesTable.receiptCheckedAt),
      // Expo receipts are asynchronous; allow a short age before the single
      // receipt check so a not-yet-created receipt cannot monopolize the batch.
      lt(staffPushDeliveriesTable.sentAt, new Date(Date.now() - 30_000)),
    )).orderBy(asc(staffPushDeliveriesTable.sentAt)).limit(RECEIPT_BATCH_SIZE);
    const deliveries = queriedDeliveries.filter((delivery): delivery is typeof delivery & { ticketId: string } => delivery.ticketId !== null);
    if (!deliveries.length) return;
    const ticketIds = deliveries.map(delivery => delivery.ticketId);
    const response = await fetchImpl(EXPO_RECEIPTS_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ ids: ticketIds }),
    });
    if (!response.ok) throw new Error(`Expo receipt request failed: HTTP ${response.status}`);
    const payload = await response.json() as { data?: Record<string, { status?: string; details?: { error?: string } }> };
    for (const delivery of deliveries) {
      const receipt = payload.data?.[delivery.ticketId];
      // A missing receipt is normal while Expo processes the ticket; leave it
      // eligible for the next bounded polling run.
      if (!receipt) {
        // This is our durable cursor: later receipt IDs can proceed on the next
        // batch instead of one missing Expo receipt starving the queue forever.
        await db.update(staffPushDeliveriesTable).set({ receiptCheckedAt: new Date() })
          .where(eq(staffPushDeliveriesTable.id, delivery.id));
        continue;
      }
      const error = receipt.details?.error;
      if (isRetiredExpoTokenError(error)) {
        await retireDevice(delivery.deviceId, error ?? "invalid_token");
        await db.update(staffPushDeliveriesTable).set({ status: "retired", lastError: error ?? "invalid_token", receiptCheckedAt: new Date() })
          .where(eq(staffPushDeliveriesTable.id, delivery.id));
      } else if (receipt.status === "ok") {
        await db.update(staffPushDeliveriesTable).set({ status: "confirmed", receiptCheckedAt: new Date() })
          .where(eq(staffPushDeliveriesTable.id, delivery.id));
      } else if (receipt.status === "error") {
        await db.update(staffPushDeliveriesTable).set({ status: "receipt_failed", lastError: error ?? "receipt_error", receiptCheckedAt: new Date() })
          .where(eq(staffPushDeliveriesTable.id, delivery.id));
      }
    }
  } catch (err) {
    logger.warn({ err }, "Expo push receipt polling failed");
  }
}

/** Starts exactly one non-blocking receipt poller per API process. */
export function startExpoPushReceiptPolling(): void {
  if (receiptPollTimer) return;
  void processExpoPushReceipts();
  receiptPollTimer = setInterval(() => { void processExpoPushReceipts(); }, RECEIPT_POLL_INTERVAL_MS);
  receiptPollTimer.unref();
}

export function startStaffPushRecoveryPolling(): void {
  if (retryPollTimer) return;
  void processRetryableStaffPushDeliveries();
  retryPollTimer = setInterval(() => { void processRetryableStaffPushDeliveries(); }, RETRY_POLL_INTERVAL_MS);
  retryPollTimer.unref();
}