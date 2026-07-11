---
name: Import batch rollback
description: Durable gotcha with replaying jsonb-stored row snapshots for undo/rollback features.
---

When a feature snapshots a row's prior values into a jsonb column so it can be replayed later (e.g. to undo an edit), any `Date` fields in that snapshot become ISO strings after the JSON round-trip and are never auto-revived.

**Why:** ORMs generally expect a real `Date` instance for timestamp columns and will crash (e.g. `value.toISOString is not a function`) if handed the string instead.

**How to apply:** Before replaying a jsonb-stored snapshot back into an update, revive ISO-8601-looking string values to `Date` instances first. Applies to any "capture now, reapply later" pattern (undo, rollback, audit-replay), not just imports.
