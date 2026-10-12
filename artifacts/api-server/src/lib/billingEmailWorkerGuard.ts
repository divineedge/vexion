import { createDedicatedDbSession } from "@workspace/db";
import { logger } from "./logger";

// These sessions are deliberately separate from the query pool. Bound them per
// process so parallel manual retries cannot exhaust server connection capacity.
const MAX_SENDERS = 4;
let active = 0;
const waiting: Array<() => void> = [];

export async function withBillingEmailWorkerGuard(id: number, work: () => Promise<void>) {
  if (active >= MAX_SENDERS) await new Promise<void>(resolve => waiting.push(resolve));
  else active++;
  const session = createDedicatedDbSession();
  session.on("error", err => logger.error({ err }, "Billing email guard connection failed"));
  try {
    await session.connect();
    const lock = await session.query<{ acquired: boolean }>("select pg_try_advisory_lock(672, $1) as acquired", [id]);
    if (!lock.rows[0]?.acquired) return;
    // The session lock is compatible with recovery's transaction-scoped lock.
    // Closing this session releases it, including on crash; no open transaction
    // or borrowed pool connection is retained during provider I/O.
    await work();
  } finally {
    await session.end().catch(err => logger.warn({ err }, "Closing billing email guard failed"));
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}
