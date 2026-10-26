import { db, invoicesTable, tenantsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { allowedInvoiceMethods, readAchPolicy } from "./achPolicy";
import { invoiceBalance } from "./customerCredit";

export async function invoicePaymentOptions(invoice: typeof invoicesTable.$inferSelect) {
  const [company] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, invoice.tenantId));
  const methods = allowedInvoiceMethods(readAchPolicy(company?.paymentPolicy), Math.max(0, Math.round(invoiceBalance(invoice) * 100)));
  const attempts = await db.execute(sql`SELECT status FROM invoice_card_attempts WHERE invoice_id=${invoice.id} AND tenant_id=${invoice.tenantId}`);
  const status = String(attempts.rows[0]?.status ?? "");
  const paid = invoice.status === "paid" || invoiceBalance(invoice) <= 0;
  const processing = ["pending", "processing", "succeeded"].includes(status);
  const review = ["reserved", "unknown", "checkout_creating", "returned", "disputed"].includes(status);
  return {
    methods: company?.stripeEnabled && ["sent", "overdue"].includes(invoice.status) ? methods : [],
    achRequired: methods.length === 1 && methods[0] === "us_bank_account",
    paymentStatus: review ? "review" as const : paid ? "paid" as const : processing ? "processing" as const : "available" as const,
    message: review ? "An earlier payment needs verification. Please contact the office before paying again."
      : paid ? "This invoice has been paid." : processing ? "Your payment is processing. Complete any bank verification requested in Stripe's email. Bank confirmation can take up to four business days after verification. Do not pay again."
      : review ? "An earlier payment needs verification. Please contact the office before paying again."
      : status === "failed" ? "The previous payment failed. Your invoice remains unpaid; please try again or contact the office."
      : methods.length === 1 && methods[0] === "us_bank_account" ? "Bank payment (ACH) is required for this amount."
      : methods.includes("us_bank_account") ? "Pay securely by card or US bank account." : "Pay securely by card.",
  };
}
