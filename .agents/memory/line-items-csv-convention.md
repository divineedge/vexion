---
name: Line items CSV/XLSX import-export convention
description: How jobs/estimates lineItems jsonb arrays are packed into a single spreadsheet cell for bulk import-export
---

Jobs and estimates both store a variable-length `lineItems` jsonb array
(`{id, serviceId?, description, qty, unitPrice, markup, discount, isOptional, optionalPitchLine?, acceptedByCustomer}`).
The shared bulk import/export engine (`artifacts/api-server/src/lib/importExport.ts`)
processes exactly one spreadsheet row per entity row — it has no concept of a
secondary "line items" sheet or repeated parent-linked rows.

Line items are therefore packed into a single "Line Items" cell using a
mini-syntax: `item; item; ...` where each item is `key=value` pairs joined by
`|` (e.g. `description=Mow lawn|qty=1|unitprice=75; description=Trim hedges|qty=2|unitprice=40|optional=true`).
Literal `|`/`;` in a value must be backslash-escaped. See
`encodeLineItemsCell`/`decodeLineItemsCell`/`sumLineItems` in importExport.ts.

**Why:** Rewriting the shared engine to support one-row-per-line-item (grouping,
multi-sheet parsing, mapping UI changes, rollback bookkeeping across grouped
rows) would be a major cross-cutting change. A cell-encoded convention fits
the existing row-per-entity architecture with no engine changes, and is still
human-editable in Excel/Sheets.

**How to apply:** When adding line-item import/export support to a new
jsonb-array field, reuse this same encode/decode convention rather than
inventing a new one, unless the shared engine itself is refactored to support
multi-row entities.

**Known gap:** `serviceId` (service catalog link) is not represented in the
CSV convention — only description/qty/pricing survive a round trip.

**Unrelated gotcha found while building this:** `handleImportCommit` inserts/
updates rows, then writes one `import_batches` summary row at the end,
*not* in a transaction. If that final insert fails, already-committed rows
have no rollback tracking. Tracked as a follow-up task, not yet fixed.
