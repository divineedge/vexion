---
name: Property map location source of truth
description: Product decisions for property geocoding, saved-pin centering, and measurement boundaries.
---

Use Google address geocoding as the primary coordinate source when configured, with the secondary geocoder only as a fallback.

**Why:** The user compares locations against Google Maps and reported that coordinates from the secondary provider placed property pins incorrectly.

**How to apply:** All automatic property geocoding paths—create, address update, manual auto-detect, and backfill—must share the same Google-first lookup.

The saved property pin is the viewport center whenever a property map is opened or its saved coordinates change.

**Why:** A manually corrected pin is intentional and must override any address-derived idea of where the property should be.

**How to apply:** Map components should move both the marker and viewport from persisted coordinates after saves/refetches; do not independently recenter from the address.

Never generate a suggested measurement boundary from a geocoder bounding box.

**Why:** Geocoder bounds are search-result extents, not reliable property boundaries, and were usually inaccurate.

**How to apply:** New and backfilled properties start with no measurement zones; staff explicitly draw area polygons or linear paths. Hide legacy generated zones identified as `id: "boundary"` or label `"Suggested Boundary"`.