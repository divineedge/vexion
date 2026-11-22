import { getTableColumns } from "drizzle-orm";
import { customersTable } from "@workspace/db";

/** Postgres rejected the list because customers.hidden_at is not in this database yet. */
export function isHiddenColumnMissing(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && typeof current === "object" && depth < 6; depth += 1) {
    const code = "code" in current && current.code != null ? String(current.code) : "";
    const message = "message" in current && typeof current.message === "string" ? current.message : "";
    const namesHiddenColumn = /hidden_at/i.test(message) && !message.startsWith("Failed query:");
    if (namesHiddenColumn && (code === "42703" || /does not exist/i.test(message))) return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

/** Drizzle selects every schema column. Omit hidden_at when that column is not in the database. */
export function customerColumnsWithoutHidden() {
  const { hiddenAt: _hiddenAt, ...columns } = getTableColumns(customersTable);
  return columns;
}
