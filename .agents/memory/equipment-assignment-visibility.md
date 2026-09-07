---
name: Equipment assignment visibility
description: Defines the durable row-level access policy for assigned equipment and all equipment-linked records.
---

Equipment may be assigned directly to an employee, to a crew, to both, or to neither. Direct and crew assignments are additive. Company owners, office managers, and department managers retain tenant-wide access, including unassigned equipment. Other field roles may access only equipment assigned directly to them or to a crew where they are a current member.

**Why:** Client-side filtering is insufficient. Equipment IDs also appear in pre-trip inspections, fuel and meter updates, maintenance, media, task bundles, internal tasks, and job-equipment-use history; any unguarded linked route can leak or mutate another crew's asset.

**How to apply:** Enforce current assignment on the server before returning, enriching, creating, updating, or deleting equipment-linked records. Return not-found for unauthorized specific records. Existing unassigned equipment remains manager-only, and assignment changes take effect immediately across current and historical linked views.