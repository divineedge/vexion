---
name: Bulk import/export pattern
description: How CSV/Excel bulk import and export is implemented for business-data entities (customers, properties, jobs, estimates, invoices, equipment, inventory) in this project.
---

Bulk import/export uses `multer` (memory storage, small file size limit) for file uploads on dedicated per-entity routes, not the app's usual presigned-URL object-storage pattern, and `exceljs` for XLSX read/write with hand-rolled CSV parsing/writing.

**Why:** import/export files are transient and small (a spreadsheet the user uploads once and never needs again), unlike the durable media/attachments the presigned-URL flow is built for. Routing this through object storage would add a storage lifecycle for data that has none.

**How to apply:** a shared engine (`artifacts/api-server/src/lib/importExport.ts`) centralizes CSV/XLSX parsing, export building, and the per-row import loop (preview → column mapping → commit with created/updated/skipped/failed counts). Each entity route supplies only a config object: required/optional fields, any FK-resolution lookups (e.g. resolve a customer by email before writing a property/job/estimate/invoice), and a dedupe key (e.g. email, sku, invoice number, or an optional `id` column for update-by-id).

Frontend calls these endpoints via hand-written functions/hooks in `lib/api-client-react/src/manual-hooks.ts` (not orval/OpenAPI codegen) — `customFetch` with `FormData` bodies for uploads and blob responses for downloads, matching the existing `transferProperty`/`getCustomerPropertyHistory` manual-hook precedent. `customFetch` does not force a `content-type` on non-string bodies, so `FormData` uploads work untouched.

A generic `ImportExportControls` component (`artifacts/divine-edge-os/src/components/data-io/ImportExportControls.tsx`) renders the Export dropdown (CSV/XLSX) and the Import wizard (upload → column mapping → commit → results summary), and is reused across all 7 entity list pages rather than building one wizard per entity.
