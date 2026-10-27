---
name: Software platform monetization
description: Software-owner payment fees and subscription plans sold to business tenants.
---
The software owner must be able to adjust the fees they take in addition to Stripe fees and sell software subscription plans to other businesses.

**Why:** The user expects both platform revenue streams to remain functional when payment methods such as ACH are added.

**How to apply:** Treat software-owner fees and business software subscriptions separately from a business's customer invoices and lawn-service plans. Verify actual fee collection and recurring subscription billing, not just the existence of plan records or pricing cards, before claiming platform monetization works.

Platform fees come out of the business's proceeds, not an added customer surcharge.

**Why:** The user explicitly selected deduction from business proceeds.

**How to apply:** Leave customer invoice totals unchanged and show the business gross receipts, Stripe transaction fees, platform fees, and net transfer separately. Do not silently convert these fees to a customer surcharge.

Preserve existing platform-scoped Stripe customer/payment-method identities when adding business payouts.

**Why:** Moving existing saved profiles into connected-account charge contexts can invalidate them or change the merchant authorization. Separate charges and transfers preserves those existing identities but makes the platform responsible for Stripe fees, refunds, and negative-balance risk.

**How to apply:** Require provider-confirmed successful payments and actual transaction fees before transferring proceeds. Snapshot fee terms per payment. Pausing new platform fees must not stop funds already owed to connected businesses. Review partial returns and uncertain expired transfer attempts rather than blindly issuing new transfers.

Draft software-plan edits must not silently reprice existing subscriptions or change their published feature and fee overrides.

**Why:** Editing a catalog is not customer authorization to change an existing recurring price, included features, or collect an unpublished fee.

**How to apply:** Keep existing Stripe Price relationships, publish new recurring prices for future purchases, and freeze each published version's actual feature selections and fee overrides. Blank overrides continue to inherit global defaults. Preserve legacy companies' access rather than inventing entitlements from old marketing labels; require real feature selections before publishing a new version. Software-owner grants bind trusted existing account identities, never an unverified email signup claim.

Confirm software-owner identity separately in preview and production.

**Why:** Accounts with the same sign-in email can have different user and company IDs in the two databases. A development grant does not establish published access, and copying development IDs can authorize the wrong account.

**How to apply:** Read the existing production identity through the read-only production database tools. When using the explicit owner bootstrap pair, scope it to production only; never use a shared environment setting with development IDs or authorize owners by email claims.

Minimum and maximum fees apply to the software owner's added fee, separately for both ACH and credit cards—not to payment amount limits or Stripe's charges.

**Why:** The user explicitly clarified “Your added ACH fee” and “same on credit card fees.”

**How to apply:** Apply the bounds after percentage plus fixed fee, preserve processor-fee deductions separately, and never promise a fee larger than the available proceeds. State clearly that platform fees are additional to Stripe fees but do not increase the customer's invoice total.
