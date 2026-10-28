---
name: Software platform monetization
description: Software-owner payment fees and subscription plans sold to business tenants.
---
The software owner must be able to adjust the fees they take in addition to Stripe fees and sell software subscription plans to other businesses.

**Why:** The user expects both platform revenue streams to remain functional when payment methods such as ACH are added.

**How to apply:** Treat software-owner fees and business software subscriptions separately from a business's customer invoices and lawn-service plans. Verify actual fee collection and recurring subscription billing, not just the existence of plan records or pricing cards, before claiming platform monetization works.

Software subscription plans may have a $0 price.

**Why:** The user explicitly requested the ability to set the software-owner plan price to zero.

**How to apply:** Allow an explicitly entered zero in both plan creation and editing. Keep blank/invalid prices distinct from zero and preserve the existing published-version protection for current subscribers.

Offer annual billing as an explicitly priced annual version alongside a monthly version; the owner reviews the full yearly total before saving or publishing. Do not invent an annual discount or silently convert current subscribers.

**Why:** The user requested annual payment for selected plans, while published subscription pricing and features must remain stable.

**How to apply:** Copy selected modules and fee overrides when starting an annual draft. Clearly label yearly charges and distinguish optional commercial modules from essentials that every business retains. When newly gating previously unrestricted modules, grandfather older purchased policies rather than removing access.

Businesses may stay on a plan and purchase additional user slots beyond its included-user allowance. They purchase slots first, rather than being billed automatically whenever an active user is added.

**Why:** The user explicitly requested per-user pricing above the plan maximum and chose “Purchase extra slots first.”

**How to apply:** Count active staff accounts, including owners, not customer-portal users or applicants. Charge purchased slots per plan billing period, including unused purchased slots until reduced. Require explicit provider confirmation and confirmed payment before increasing capacity; preserve existing staff/history rather than deleting or deactivating accounts. Freeze purchased allowance and rates separately from editable catalog drafts.

The plan feature picker must cover integrations and external automation access, not just navigation pages.

**Why:** The user specifically identified missing Quo/OpenPhone, one-way QuickBooks sync, REST API access and MCP access for other AI agents after the main-module checklist was expanded.

**How to apply:** Audit actual integrations and service capabilities alongside app sections. Distinguish provider-account requirements and charges, one-way versus two-way sync, and supported protocols versus verified compatibility with a named agent. Plan inclusion never replaces the owner's explicit per-connection resource permissions.

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
