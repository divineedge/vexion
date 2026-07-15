---
name: Blueprint PDF file size storage
description: pdfSizeBytes is not a column on the blueprints table; it only lives on the linked media_attachments row.
---

`blueprintsTable` only has `pdfObjectPath` and `pdfFileName` columns for its uploaded-PDF source. There is no `pdfSizeBytes`/`pdf_size_bytes` column on `blueprints`.

**Why:** File size is tracked on the `media_attachments` row created alongside the blueprint (`entityType: "blueprint"`, `entityId: <blueprint id>`, `sizeBytes`), which also backs the tenant-ownership check used by the object-serving routes (`GET /storage/objects`, signed URL generation). Writing `pdfSizeBytes` into a Drizzle `.set()` against `blueprintsTable` fails typecheck (`Property 'pdfSizeBytes' does not exist`) because the column simply isn't there.

**How to apply:** Any route that creates or replaces a blueprint's PDF (initial upload in `POST /blueprints`, or a later replace via `PATCH /blueprints/:id`) must update `blueprintsTable.pdfObjectPath`/`pdfFileName` AND separately delete/insert (or update) the corresponding `media_attachments` row with the new `sizeBytes`/`fileKey`/`fileUrl` — updating just one side leaves size stale or ownership checks pointing at the old file.
