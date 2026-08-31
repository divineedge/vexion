---
name: CSV import column identity
description: Durable rule for reliable column mapping in the shared CSV/XLSX importer.
---

Uploaded spreadsheet columns must be identified by their zero-based position during manual mapping and commit, while the UI displays cleaned, unique labels for people.

**Why:** Header text is not a unique identifier. Real customer files often contain duplicate or blank headers; mapping by text can select the wrong duplicate or make a column impossible to choose.

**How to apply:** Preserve backward compatibility with legacy header-name mappings, but use positional keys for all new mapping UI choices. Convert blank labels to `Column N` and suffix duplicate labels without changing row positions.

Auto-mapping must reserve exact matches for every field before attempting partial/fuzzy matches, and a source column may be suggested for only one destination field. Manual mapping may still reuse a source column when staff intentionally choose it.

**Why:** Sequential fuzzy matching lets broad destinations such as `Name` steal `First Name`, and can map a generic `Email` source into both customer email and referring-customer email.

**How to apply:** Run auto-mapping in two passes (exact, then fuzzy) while tracking used source positions. Keep the one-use rule limited to suggestions rather than rejecting deliberate manual reuse.