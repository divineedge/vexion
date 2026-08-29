---
name: Field schedule tenant dates
description: Calendar-day invariants for Field App schedules across tenant, device, server, and extreme timezones.
---

Represent a selected Field App schedule day as a validated `YYYY-MM-DD` key in the tenant's IANA timezone. Use that key consistently for navigation, API bounds, grouping, route lookup, cache keys, labels, and offline fallbacks. Do not round-trip it through a JavaScript `Date` carrier or device-local calendar helpers.

**Why:** Device-local dates, server-local midnight, and even a UTC-noon carrier can shift the intended tenant day for traveling staff or UTC+13/+14 tenants. Partial conversion also makes online, offline, route-order, and geofence views disagree.

**How to apply:** For schedule work, derive exact timezone-aware `[start, end)` instants only at API boundaries. Perform calendar arithmetic directly on date-key components, format labels from the key, and test device/tenant mismatch, DST, and Pacific/Kiritimati.