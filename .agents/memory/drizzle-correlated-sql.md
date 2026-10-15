---
name: Drizzle correlated SQL
description: Outer column qualification can disappear in SQL fragments used by single-table selects
---
Explicitly qualify outer-table columns inside correlated SQL fragments instead of interpolating a Drizzle column object.

**Why:** Drizzle's single-table select rendering can strip table qualifiers from interpolated columns. A nested property query comparing its customer ID to an outer customer ID then resolves the bare ID to the inner property's ID, silently missing valid matches.

**How to apply:** Use a static, explicit outer-table qualifier within the SQL fragment and test with different outer and inner IDs. Continue parameterizing all user-provided values.
