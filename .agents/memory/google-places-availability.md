---
name: Google Places availability
description: Durable provider/fallback behavior for address autocomplete.
---

Address autocomplete must remain usable when the preferred Google provider is unavailable.

**Why:** Treating provider errors as zero results silently degrades address quality and makes an unhealthy provider look healthy.

**How to apply:** Prefer Google, retain Photon/Nominatim fallback, label fallback results honestly, return the tenant center independently of query matches, enforce the service radius, and persist selected coordinates.