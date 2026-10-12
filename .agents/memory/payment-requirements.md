---
name: Deposits and scheduling payment rules
description: User-selected deposit priority and separation of deposit, prepaid credit, and saved-card prerequisites.
---
Deposit rules use customer → service → company priority. Unset rules inherit; an explicit no-deposit choice is a waiver.

**Why:** The user selected this priority when asked which rule wins.

Deposits belong to the related estimate and invoice, not the general customer prepayment balance. Show deposit receipts on the customer page. Requiring a saved card and requiring payment are independent; a saved card is not proof of payment.

**Why:** The user specifically asked to keep deposits distinct from prepayment and to support both payment and saved-card requirements.

**How to apply:** Company-wide full-prepayment requirements cannot be waived by customer/service settings. Validate actual payment before all scheduling paths, including recurring generation, plan visits, imported future work, and date moves. General credits must be reserved atomically to prevent the same money satisfying two jobs.
