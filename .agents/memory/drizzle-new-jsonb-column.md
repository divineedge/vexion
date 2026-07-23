---
name: Drizzle new jsonb column silent drop
description: Newly-added jsonb columns are silently ignored by Drizzle's ORM set() mapper even when present in the schema source; use raw SQL for them.
---

## Rule
When a new `jsonb()` column is added to a Drizzle table schema, its updates are silently dropped by `db.update(table).set(updates)` — even though the column appears in the esbuild bundle at runtime. Use a raw SQL statement for the update:

```ts
await db.execute(sql`
  UPDATE tenants
  SET my_new_column = ${JSON.stringify(value)}::jsonb
  WHERE id = ${tenantId}
`);
```

**Why:** Drizzle's internal `mapUpdateSet` maps JS object keys to column SQL expressions using a runtime registry. Newly-added jsonb columns sometimes fail to register correctly in the bundled artifact, causing them to be silently excluded from the SET clause.

**How to apply:** Any `Partial<typeof table.$inferInsert>` update that includes a column added after the original schema was compiled. Run the jsonb update separately with raw SQL, then re-fetch the row if the response needs the updated value.

## Pattern for settings-style routes
```ts
// 1. Raw SQL for the new jsonb column
if (notificationTemplates !== undefined) {
  await db.execute(sql`UPDATE tenants SET notification_templates = ${JSON.stringify(notificationTemplates)}::jsonb WHERE id = ${tenantId}`);
}
// 2. Guard against empty main updates
if (Object.keys(updates).length === 0) {
  const [current] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  if (!current) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatTenant(current)); return;
}
// 3. Normal Drizzle update for everything else
const [updated] = await db.update(tenantsTable).set(updates).where(eq(tenantsTable.id, tenantId)).returning();
res.json(formatTenant(updated));
```
