---
name: MeasurementZone/ZoneType schema spans many locations
description: Extending the property satellite-map zone data model (area vs linear, or any new field) touches ~7 files across spec, db, api, and 3 frontend components — miss one and it silently doesn't propagate.
---

## The pattern

The zone drawing feature's data model (`MeasurementZone` on properties, `ZoneType` on tenant settings) is duplicated, not shared, across:

1. `lib/api-spec/openapi.yaml` — schema definitions (property's zone array item, and *two* separate tenant-settings zone-type-item schemas: one for the GET/settings response, one for the PATCH/update body)
2. `lib/db/src/schema/tenants.ts` — jsonb column default array (new tenants only; never retroactively applied to existing tenants' saved arrays)
3. `artifacts/api-server/src/routes/settings.ts` — `formatTenant()` zone-type derivation (handles both stored zone types and legacy-label-derived fallback)
4. `artifacts/divine-edge-os/src/components/map/PropertySatelliteMap.tsx` — local `MeasurementZone`/`ZoneType` interfaces + `DEFAULT_ZONE_TYPES` + all drawing/rendering logic
5. `artifacts/divine-edge-os/src/components/property/QuickQuotePanel.tsx` — its own local (duplicate, not imported) `MeasurementZone`/`ZoneType` interfaces
6. `artifacts/divine-edge-os/src/pages/settings.tsx` — zone type manager UI + its own default array + save payload
7. `artifacts/divine-edge-os/src/pages/property-detail.tsx` — normalizes zone types from `rawZoneTypes` or legacy `measurementZoneLabels`

A public-facing sibling, `artifacts/divine-edge-os/src/pages/quote-public.tsx`, has its own separate legacy zone/pricing model (flat/per_sqft only) that is NOT wired to this one at all — don't assume adding a field here reaches it.

**Why:** No shared type/module backs these; each was hand-rolled at different times. A field added in only some of them compiles fine (all fields are optional) but silently fails to display or persist in the untouched spots.

**How to apply:** When changing this data model, grep all 7 locations above (plus quote-public.tsx if pricing/display parity matters there) before considering the change complete. Also remember: DB column *default* changes only affect brand-new tenants — never write a migration that mutates existing tenants' already-saved jsonb unless explicitly asked.
