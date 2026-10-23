---
name: Deposits and scheduling payment rules
description: User-selected deposit priority and separation of deposit, prepaid credit, and saved-card prerequisites.
---
Deposit rules use customer → service → company priority. Unset rules inherit; an explicit no-deposit choice is a waiver.

**Why:** The user selected this priority when asked which rule wins.

Deposits belong to the related estimate and invoice, not the general customer prepayment balance. Show deposit receipts on the customer page. Requiring a saved card and requiring payment are independent; a saved card is not proof of payment.

**Why:** The user specifically asked to keep deposits distinct from prepayment and to support both payment and saved-card requirements.

**How to apply:** Company-wide full-prepayment requirements cannot be waived by customer/service settings. Validate actual payment before all scheduling paths, including recurring generation, plan visits, imported future work, and date moves. General credits must be reserved atomically to prevent the same money satisfying two jobs.

Companies need multiple configurable deposit rules using both estimate amount and service conditions. Estimate acceptance must enforce the applicable deposit requirement.

**Why:** The user asked for multiple company rules and for deposits on accepted estimates to follow the company rule.

**How to apply:** Resolve the applicable rule for the final selected items at acceptance; do not rely solely on manually entered estimate deposit wording. Keep customer → service → company precedence and independent company-wide full-prepay/card requirements.

Changes to deposit rules must not rewrite the terms of an already collected estimate payment.

**Why:** A customer payment was authorized for its recorded terms and selected work; later company configuration is not permission to change that payment.

**How to apply:** Refresh unpaid estimate requirements from current policy, but preserve paid terms and selection snapshots.

Direct documents need working Pay Now / Accept-and-pay actions. Default card saving on, but give customers a visible opt-out and explicit authorization terms for future invoices. Sensitive card details belong only to the payment platform; the app can manage provider-backed cards and display safe summaries.

**Why:** The user explicitly requested saving by default with opt-out, future-payment terms, and no payment credentials stored in this software.

**How to apply:** Respect independent deposit/full-payment rules when accepting estimates; never charge the full estimate merely because Stripe is enabled. Existing saved cards do not imply consent to future automatic charges.

Companies choose staff-initiated charging, charging when an invoice is sent, or automatic charging on its due date. Sent invoices must show successful processing only after the payment platform confirms it.

**Why:** The user chose company control over staff/send timing, then specifically added the due-date option.

**How to apply:** Interpret the due date as a calendar date, using company time for today's date. Skip already paid or fully covered balances. Uncertain payment outcomes must remain unconfirmed, never cause a second charge with a fresh key, and never be inferred from a browser return URL.
