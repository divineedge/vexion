---
name: Blueprint legacy canvas shape
description: Some blueprints store canvasData as {nodes,lines{from,to}} instead of the current {points,lines{startId,endId},areas}; normalize on every read.
---

Real seeded/legacy blueprint rows exist with `canvasData = { nodes: [{id,x,y,type}], lines: [{id,from,to}] }` instead of the current `{ points: [{id,x,y,elementType}], lines: [{id,startId,endId}], areas: [] }` shape the canvas editor and estimate logic expect.

**Why:** Any code path that reads `bp.canvasData` directly from the DB (not through the normalizing `formatBlueprint`) sees empty points/lines for these rows. The canvas editor then renders a blank canvas, and saving — including the AI zone-generation save-on-generate step, which merges into "existing" canvasData read straight from the DB — permanently overwrites the legacy fields with empty arrays, discarding the original layout.

**How to apply:** `normalizeCanvasData()` in `artifacts/api-server/src/routes/blueprints.ts` converts both shapes to the current one (best-effort mapping of legacy `type` -> `elementType` via `LEGACY_NODE_TYPE_MAP`; unrecognized types become plain generic points). Every route that reads canvasData must go through it — either via `formatBlueprint` (GET/PATCH/POST responses) or by calling it directly before merging with new data (e.g. `generate-ai-zones`, `/estimate`). If you add a new route that reads `bp.canvasData` from the DB, normalize it there too, or you'll reintroduce the data-loss bug for legacy rows.
