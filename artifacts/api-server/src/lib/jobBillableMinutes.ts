/** Hourly billing stores crew minutes on the job. Older databases never received this column. */
export const JOB_BILLABLE_MINUTES_SQL = "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS billable_minutes integer";

/** Drizzle wraps the Postgres error. The cause names billable_minutes; the query text does too. */
export function isJobBillableMinutesMissing(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && typeof current === "object" && depth < 6; depth += 1) {
    const code = "code" in current && current.code != null ? String(current.code) : "";
    const message = "message" in current && typeof current.message === "string" ? current.message : "";
    const namesColumn = /billable_minutes/i.test(message) && !message.startsWith("Failed query:");
    if (namesColumn && (code === "42703" || /does not exist/i.test(message))) return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}
