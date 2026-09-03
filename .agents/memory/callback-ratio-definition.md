---
name: Callback ratio definition
description: The agreed formula and attribution rules for callback quality metrics.
---

**The rule:** Callback ratio is every callback ticket created in the selected period divided by every job completed in that same period. Repeat callback tickets against one original job each count in the numerator.

**Why:** The user explicitly chose ticket count rather than unique callback jobs. Previously, company, employee, crew, and service views mixed lifetime and period data and used inconsistent joins, producing conflicting ratios.

**How to apply:** Use callback creation time for the numerator, job completion time for the denominator, and the same date boundaries on both. Attribute employee callbacks to the snapshotted original assignee and crew/service callbacks through the original job.