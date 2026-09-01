---
name: Route sequencing design decisions (Divine Edge OS)
description: Route order remains deterministic locally while route-day travel and operational starts use Google Routes with a per-leg estimate fallback.
---

# Route sequencing design decisions (Divine Edge OS)

**The decision:** Keep nearest-neighbor haversine sequencing for deterministic stop order, then calculate ordered road legs through Google Routes. Fall back per leg to the 28 mph estimate and derive operational starts from travel plus prior job duration.

**Why:** The user explicitly requested map-based drive times and cascading estimated starts. Separating order from timing keeps optimization predictable while allowing partial Google failures without making route detail unusable.

**How to apply:** Preserve the local ordering algorithm unless optimization requirements change. Route-day displays and capacity should use resolved road legs, clearly label Google/mixed/estimated sources, and never overwrite requested appointment times with operational estimates.
