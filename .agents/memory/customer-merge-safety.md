---
name: Customer merge safety
description: Inactive duplicate matching, retained identity, payment profiles, policy conflicts, and late financial events
---
Customer merges must include inactive candidates and let staff explicitly choose the record to keep. Preserve balances, documents, work history, archived states, original identity evidence, and the stricter communication opt-outs rather than deleting the duplicate.

**Why:** The user requested merging duplicates including inactive customers and has a standing requirement not to lose business or customer information.

**How to apply:** Preview the records and related history before confirmation. Keep the selected primary's populated profile fields and preserve the source as an archived merged identity with an audit snapshot. Do not reactivate historical work merely because its customer was merged.

Do not automatically combine different external payment profiles or conflicting customer payment requirements.

**Why:** Saved cards belong to an external payment customer, and merging must not weaken required prepayment/deposits or lose the ability to bill an existing payment profile.

**How to apply:** Require reconciliation when profiles or explicit payment policies conflict. The record with the saved payment profile should be retained when the other has none.

Late incoming money may follow the merged identity, but stale operational writes must use the retained customer and re-check their current rules.

**Why:** Redirecting a stale job reference only after application validation could bypass the retained customer's stricter scheduling/payment restrictions; losing a delayed payment would also be unacceptable.

**How to apply:** Preserve financial-event idempotency and reject stale operational references rather than silently creating new work under outdated customer rules.
