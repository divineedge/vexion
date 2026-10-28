import { hasSoftwareFeature } from "./softwareFeatures";
/**
 * Fire-and-forget helper that pushes a customer to Mailchimp when the integration
 * is connected. Called from customer create/update and campaign-membership events.
 * Never throws — a Mailchimp outage must not block the primary write.
 */
import { db, tenantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { decryptSecretConfig } from "./secretsCrypto";
import { upsertMailchimpMember, type MailchimpConfig } from "./mailchimpProvider";
import { logger } from "./logger";

interface IntegrationState {
  connected: boolean;
  encryptedConfig?: string;
}

export async function syncCustomerToMailchimp(tenantId: number, customer: { email: string; name: string; tags?: string[] | null }): Promise<void> {
  try {
    if (!await hasSoftwareFeature(tenantId, "mailchimp_integration")) return;
    const [tenant] = await db.select({ integrationsConfig: tenantsTable.integrationsConfig }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
    const states = (tenant?.integrationsConfig as Record<string, IntegrationState>) ?? {};
    const mailchimpState = states.mailchimp;
    if (!mailchimpState?.connected) return;

    const config = decryptSecretConfig(mailchimpState.encryptedConfig) as MailchimpConfig;
    const [firstName, ...rest] = customer.name.split(" ");
    const result = await upsertMailchimpMember(config, {
      email: customer.email,
      tags: customer.tags ?? [],
      mergeFields: { FNAME: firstName ?? "", LNAME: rest.join(" ") },
    });
    if (!result.success) logger.warn({ tenantId, error: result.error }, "Mailchimp sync failed");
  } catch (err) {
    logger.warn({ err, tenantId }, "Mailchimp sync threw unexpectedly");
  }
}
