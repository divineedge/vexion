---
name: Historical customer imports
description: Compatibility rule for importing legacy customer lists that lack fields required for newly created customers.
---

Customer spreadsheet imports must accept historical rows with missing name, email, or phone even when interactive customer creation currently requires those fields. Missing contact fields stay blank; missing names fall back to company, then a row-specific imported-customer label.

**Why:** Long-standing customer lists often predate today’s data requirements. Rejecting those records prevents migration and incorrectly applies new-customer standards to historical data.

**How to apply:** Keep strict requirements on interactive creation where appropriate, but treat bulk customer import as a migration path. Only match an existing customer when a real email is present; never match or merge on blank placeholder values.