---
name: Drizzle empty-updates guard
description: Drizzle throws "No values to set" when db.update().set({}) is called with an empty object; must guard before calling.
---

## Rule
Before calling `db.update(table).set(updates)`, check that `updates` is non-empty:

```ts
if (Object.keys(updates).length === 0) {
  const [current] = await db.select().from(table).where(eq(table.id, id));
  return res.json(formatRow(current));
}
const [updated] = await db.update(table).set(updates).where(...).returning();
```

**Why:** Drizzle's `mapUpdateSet` iterates the object's keys and throws `Error: No values to set` if none map to recognized columns. This silently crashes requests where the caller only sends fields that are handled outside the main `updates` object (e.g. via raw SQL).

**How to apply:** Any settings-style PATCH handler that may receive only a subset of fields.
