import { db, customersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { getStripeClient } from "./stripe";
import { PAYMENT_AUTHORIZATION_TERMS, PAYMENT_AUTHORIZATION_VERSION } from "./achPolicy";

export const CARD_AUTHORIZATION_VERSION = "future-invoices-v1";
export const CARD_AUTHORIZATION_TERMS = "By continuing with this option selected, I authorize the business named on this document to securely save my card with its payment provider and charge it for future invoices for services I authorize, either when an invoice is sent, on its due date, or when staff initiates payment under the business's billing policy. I can withdraw this authorization or remove my saved card in my customer profile or by contacting the business. Card numbers and security codes are handled by the payment provider, not stored in this software. Uncheck this option to make a one-time payment without saving this card or authorizing future charges.";

export function validCardChoice(body: {saveCard?: unknown; authorizationAccepted?: unknown}|null|undefined) {
  return !!body && typeof body.saveCard === "boolean" &&
    (body.saveCard === false || body.authorizationAccepted === true);
}

/** Only invoked after provider-confirmed setup/payment, never from a browser success redirect. */
export async function authorizeSavedCard(tenantId: number, customerId: number, paymentMethodId: string, source: string) {
  const stripe = getStripeClient();
  if (!stripe) throw new Error("Payments unavailable");
  const [customer] = await db.select().from(customersTable).where(and(eq(customersTable.id,customerId),eq(customersTable.tenantId,tenantId)));
  if (!customer?.stripeCustomerId) throw new Error("Payment customer not found");
  const method = await stripe.paymentMethods.retrieve(paymentMethodId);
  const owner = typeof method.customer === "string" ? method.customer : method.customer?.id;
  if (owner !== customer.stripeCustomerId || (!method.card && !method.us_bank_account)) throw new Error("Payment method does not belong to this customer");
  const version = method.us_bank_account ? PAYMENT_AUTHORIZATION_VERSION : CARD_AUTHORIZATION_VERSION;
  const terms = method.us_bank_account ? PAYMENT_AUTHORIZATION_TERMS : CARD_AUTHORIZATION_TERMS;
  const now = new Date();
  await stripe.customers.update(customer.stripeCustomerId, {
    invoice_settings:{default_payment_method:paymentMethodId},
    metadata:{
      automatic_payment_authorization: version,
      automatic_payment_authorized_at: now.toISOString(),
      automatic_payment_method: paymentMethodId,
      automatic_payment_source: source,
      automatic_payment_terms_1: terms.slice(0,450),
      automatic_payment_terms_2: terms.slice(450,900),
    },
  });
  await db.update(customersTable).set({
    stripeDefaultPaymentMethodId:paymentMethodId, automaticPaymentAuthorizedAt:now,
    stripeDefaultPaymentMethodType:method.us_bank_account?"us_bank_account":"card",
    paymentAuthorizationMethodId:paymentMethodId,
    cardExpiresAt:method.card ? new Date(Date.UTC(method.card.exp_year,method.card.exp_month,0)).toISOString().slice(0,10) : null,
    cardExpiryReminderSentAt:null,
  }).where(and(eq(customersTable.id,customerId),eq(customersTable.tenantId,tenantId)));
}
