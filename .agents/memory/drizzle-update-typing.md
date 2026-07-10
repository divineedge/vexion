---
name: Drizzle update typing
description: Correct TypeScript typing for Drizzle ORM update payloads in route handlers
---

When building partial update objects to pass to `db.update(table).set(...)`, use `Partial<typeof table.$inferInsert>` as the type — not `Record<string, unknown>`.

```typescript
// CORRECT
const updates: Partial<typeof inventoryItemsTable.$inferInsert> = {};
if (name) updates.name = name;
await db.update(inventoryItemsTable).set(updates).where(...);

// WRONG — causes TS2352/TS2559
const updates: Record<string, unknown> = {};
await db.update(inventoryItemsTable).set(updates as Parameters<typeof db.update>[0]).where(...);
```

**Why:** Drizzle's `.set()` expects a typed partial matching the table's insert schema. Casting `Record<string, unknown>` causes TypeScript to reject the cast because the types don't overlap sufficiently.

**How to apply:** Any route handler that builds a dynamic update object (PATCH endpoints) must declare it as `Partial<typeof <tableName>.$inferInsert>`.
