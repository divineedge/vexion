---
name: Job service price and duration snapshots
description: Selected catalog services resolve immutable job billing and duration values at scheduling time.
---

**The rule:** A job linked to a service must snapshot its resolved line item, total, and estimated duration when scheduled. Matrix tiers may supply both price and minutes from the same property measurement.

**Why:** Service catalog and matrix edits must not retroactively change an existing job or its invoice, and route timing must use the same duration that was priced.

**How to apply:** Resolve tenant-scoped active services during job creation and whenever an existing job changes services; update serviceId, line items, total, and duration together. Preserve explicit caller overrides, keep matrix pricing unresolved when required measurements are missing, and clone all snapshots into recurring children.