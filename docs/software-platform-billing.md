# Software-owner fees and business subscriptions

## Access

Software-owner access is separate from `company_owner`. Business owners can manage
only their own software subscription and payout setup. They cannot edit software
plans, platform fees, or another business's billing.

Create the intended owner account normally, with a real password. A trusted
workspace operator can then grant development access:

```
pnpm --filter @workspace/api-server exec tsx src/scripts/grantSoftwareOwner.ts <existing-sign-in-email>
```

The script refuses missing/ambiguous accounts and demo passwords. It does not
create accounts or grant privileges merely because someone registers an email.
For a published instance, a trusted deployer can explicitly configure
`PLATFORM_OWNER_USER_ID` and `PLATFORM_OWNER_TENANT_ID` to the verified existing
account's exact identifiers. These are non-secret deployment settings; do not
guess them, and do not copy development identifiers into a different database.

## Screens

- Software Admin: `/software-admin` — draft plans, card/ACH platform fees,
  business subscription statuses, payout reconciliation, and audit history.
- Business owner: Settings → Payments → Software billing & payouts.

Live platform billing starts **disabled**. Saving configuration or plan drafts
does not create Stripe charges. Activation requires confirmation and a working
Stripe account. Publish a plan to create an actual Stripe recurring Price.
Existing subscribers keep their existing Stripe Price when a draft is edited.
Publishing changes a plan's future-payment platform-fee policy; draft fee edits
do not change collected fees. Blank overrides inherit global platform fees.

Business subscriptions use a separate Stripe Customer from lawn-service
customers, hosted subscription checkout, and Stripe's hosted billing portal for
payment-method changes, plan changes with confirmation/proration, and cancellation.
Only verified Stripe state changes subscription status. A past-due subscription
raises a billing notification; it never deletes business records.

## Business proceeds

Customer invoice totals are unchanged. New eligible card/ACH payments snapshot
the current platform fee and connected business identity. After Stripe confirms
the charge, the payout queue calculates:

`business transfer = received amount - confirmed Stripe transaction fee - platform fee`

The platform fee cannot exceed funds remaining after Stripe's transaction fee.
Transfers use the original charge as `source_transaction`, stable idempotency
keys, durable records, and provider-confirmed fees—not guessed processing rates.
This uses Stripe Connect separate charges and transfers: the platform is
responsible for Stripe fees, refunds, disputes, and negative-balance risk.
Stripe Connect, verification, return, or other separately billed fees may apply
and are not necessarily included in the charge's balance-transaction fee.

Activation blocks new online payments for businesses that have not completed
their Stripe-hosted US payout-account onboarding and accepted the fee terms.
Pausing monetization stops new platform fees/subscription checkouts, but completed
onboarded businesses still receive zero-platform-fee transfers for new payments;
existing snapshotted obligations continue processing.

Full refunds/returns queue reversal of the associated business transfer.
Partial refunds/disputes and uncertain transfers beyond the provider's safe
idempotency window require manual Stripe reconciliation. Do not use a new
reference to blindly send money again. Reversed payouts are not earned revenue.
Stripe costs not recovered through a transfer reversal remain platform risk.

## Before live activation

Verify Stripe and Connect approval, supported funds flow and fees, webhook signing,
business onboarding, and test-mode payment/subscription/return cases.
The existing signed endpoint is `/api/portal/stripe-webhook`. Subscribe it to:

- `payment_intent.succeeded`, `payment_intent.processing`,
  `payment_intent.payment_failed`, `payment_intent.canceled`
- `checkout.session.completed`, `checkout.session.expired`,
  `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`
- `charge.refunded`, `charge.dispute.created`
- `customer.subscription.created`, `customer.subscription.updated`,
  `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`

New tables/columns are declared in the shared Drizzle schema and applied
additively to development. Use the normal managed database Publish schema review;
there is no new startup DDL or automatic production data rewrite.
