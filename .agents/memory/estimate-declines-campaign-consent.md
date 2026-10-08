---
name: Estimate declines and campaign consent
description: Customer feedback snapshots, configurable choices, and not-now marketing consent.
---
Businesses define decline choices; customers can choose Other and explain.
Reports must group by the reason recorded when the estimate was declined,
not the current settings label.

**Why:** The user wants configurable reasons and a report without changing old
feedback when the business edits its choices.

**How to apply:** Snapshot the selected label and preserve the comment separately.
Treat legacy unclassified comments as Other and missing responses as No reason given.

Not interested right now routes customers into a staff-selected follow-up
campaign and suppresses the original campaign, without unsubscribing.
Unsubscribe always overrides that enrollment. GET links must only display
confirmation; POST records the action to avoid email-scanner mutations.

**Why:** The user explicitly chose configurable destination campaigns and
requires both options in campaign emails. Re-enrollment is not a new customer
acquisition and must not inflate acquisition/ROAS metrics.

**How to apply:** Keep follow-up audience membership separate from acquisition
attribution. Apply opt-outs and campaign suppression to immediate sends,
scheduled sends, previews, and send-time eligibility rechecks. Never clear
global opt-out because an older Not interested link was clicked.
