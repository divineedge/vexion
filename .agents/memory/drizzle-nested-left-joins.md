---
name: Nested left-join identity
description: Drizzle can collapse a real joined row when a nullable setting is the first projected column.
---
Use explicit identity-first nested projections for optional joined objects. Prefer an inner join when the related record must exist.

**Why:** Drizzle treated an entire joined company as null because the first projected company column was an unset optional setting, even though the SQL join found the company. Valid public customer-feedback links incorrectly returned not found.

**How to apply:** Select a non-null primary key first and allowlist the remaining fields instead of nesting the entire table. When adding nullable columns, check whole-table nested left-join projections. Regression fixtures should leave optional settings unset, not populate them to hide the problem.
