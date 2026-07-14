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
