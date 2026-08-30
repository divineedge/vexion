---
name: Customer archive serialization
description: Concurrency rule for reversible customer archive cascades.
---

Customer archive and restore state transitions must be decided only after locking the customer row inside the transaction. A repeated request after the first transition is a no-op and must not replace the cascade timestamp.

**Why:** Concurrent archive requests with different timestamps can otherwise leave the customer and dependent records stamped differently, preventing restore from reactivating the dependents.

**How to apply:** Any future change to customer archive/restore must preserve row-level serialization, use the locked persisted timestamp for restore matching, and return the current row without issuing an empty update for no-op transitions.