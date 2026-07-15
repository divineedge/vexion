---
name: Blueprint canvas element data model
description: How the Blueprint canvas's point/line element types, inventory links, and estimate math fit together — read before extending the canvas tool or its estimate calculation.
---

# Blueprint canvas element data model

**The decision:** A blueprint's canvas data stays an untyped jsonb blob end-to-end (DB column, OpenAPI schema `additionalProperties: true`, no migration). Richer per-element attributes (fixture/material type, label, pipe type, linked inventory item id) are only typed in the frontend's element type unions and read defensively on the backend.

**Why:** Avoids a schema migration for every new canvas element attribute, and matches how this jsonb field was already treated as free-form before this feature.

**How to apply:** When adding new placeable element kinds or attributes, extend the frontend element type unions and palette config; don't add DB columns or named OpenAPI schemas for them. Only add a real DB column when the fact is genuinely relational and queried/filtered on its own (e.g. a boolean flag on inventory items gating which rows are pickable in the palette).

**Real-world length:** Reuse the blueprint's existing pixel-per-foot calibration value for any pixel→feet conversion on drawn lines — don't add a second calibration mechanism.

**Estimate math:** Quantity estimation should prefer real linked-element data (counts for point elements, computed length for line/pipe elements) over generic node/line-count heuristics, merging additively with any manually-entered parts, and falling back to the old heuristic only when nothing is linked — this keeps older blueprints working unchanged.

**Legacy shape trap:** Some older/seeded blueprints store canvasData under a different shape (`nodes`/`type` + `lines` with `to`/`from`) instead of the current `points`/`elementType` + `lines` with `startId`/`endId`. Nothing migrates this on read, so any code that does `canvasData.points ?? []` silently treats these as empty and a full re-save (the canvas's own Save button, or any endpoint that persists a merged/updated canvasData) permanently overwrites the old field names, losing the original layout. When writing new endpoints that read-modify-write canvasData, be aware this data loss is pre-existing/systemic, not something a merge-only endpoint alone can safely fix.

**Scoped/partial generation pattern:** For AI generation limited to specific canvas regions (e.g. zone-based generation), read the current `points`/`lines`, generate only new elements (namespaced ids, e.g. a per-request prefix) for the targeted region, and write back `{ points: [...existing, ...new], lines: [...existing, ...new] }` — merge, never replace with only the new elements — so untouched areas of the canvas survive the request.

**Areas vs. points vs. lines:** Not every canvas material is a point. Ground-cover materials (gravel, dry river bed) are quantified by footprint, not count, so they're stored as a separate `areas` array (`{id, elementType, polygon, label?, inventoryItemId?}`) alongside `points`/`lines`, and their estimate quantity is a shoelace-formula sq-ft conversion, not a per-item count. A material like trench is quantified by length, so it's a `lines` entry (one line per segment, sharing one label) even though it used to be modeled as a chain of labeled points — pick the element kind (point/line/area) by what real-world unit the material is measured in (each/ft/sq ft), not by how it happens to be drawn.

**Legacy palette compat:** When moving a material from one element kind to another (e.g. points → areas/lines), keep the old type value in the point-type union and its old renderer for backward compatibility with already-saved data, but remove it from the *placement* palette so it can't be newly created as the old kind. A material-selection UI that lists "what can this material be" (e.g. a per-zone material picker) needs its own combined list across all element-kind palettes — it will silently go stale if it only reads from one kind's palette.

**Async-effect-cancellation footgun:** Don't cancel an in-flight async effect (e.g. `let cancelled = false; ...; return () => { cancelled = true; }`) when its dependency array includes a value that changes on every tick during mount (e.g. a `{width,height}` object updated by a `ResizeObserver` while a sidebar/container is still animating/settling). Each dependency change re-runs the effect and fires the *previous* run's cleanup, so a slow-resolving request (e.g. a probed image load) gets cancelled every time before it can ever finish. If an effect is guarded to "only start once" (e.g. via a `builtRef`), use a true unmount-only ref for cancellation, not a per-run local flag — otherwise the guard prevents restarting the request but not the churn from cancelling the one request that's in flight.
