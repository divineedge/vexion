---
name: CSV import column identity
description: Durable rule for reliable column mapping in the shared CSV/XLSX importer.
---

Uploaded spreadsheet columns must be identified by their zero-based position during manual mapping and commit, while the UI displays cleaned, unique labels for people.

**Why:** Header text is not a unique identifier. Real customer files often contain duplicate or blank headers; mapping by text can select the wrong duplicate or make a column impossible to choose.

**How to apply:** Preserve backward compatibility with legacy header-name mappings, but use positional keys for all new mapping UI choices. Convert blank labels to `Column N` and suffix duplicate labels without changing row positions.