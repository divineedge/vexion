---
name: Denormalized display fields need an explicit join
description: API responses that promise a denormalized name field (e.g. crewName) silently return it as missing unless the handler joins the source table.
---

# Denormalized display fields need an explicit join

**The rule:** If a list/detail response shape promises a denormalized display field derived from a foreign key (e.g. a name resolved from another table), the query must join that table — returning just the raw foreign key silently breaks the field instead of erroring.

**Why:** These fields fail quietly (`null`/missing) rather than throwing, so the gap is easy to miss in review and only surfaces as a confusing blank in the UI.

**How to apply:** When adding a denormalized field to a response shape, verify the query joins the table it's derived from before considering the field done.
