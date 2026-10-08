import { randomBytes, createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, broadcastsTable, campaignResponsesTable, customersTable, marketingCampaignsTable } from "@workspace/db";

// Verified published URL. Relative paths are used by the confirmation form itself.
const PUBLIC_ORIGIN = "https://divine-edge--divineedgepm.replit.app";
export const hashPreferenceToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const escapeEmailHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export async function validateCampaignDestination(tenantId: number, destination: unknown, source?: number) {
  if (!Number.isInteger(destination) || Number(destination) <= 0 || destination === source) throw new Error("Choose a different follow-up campaign for Not interested right now");
  const [campaign] = await db.select().from(marketingCampaignsTable).where(and(eq(marketingCampaignsTable.tenantId, tenantId), eq(marketingCampaignsTable.id, Number(destination))));
  if (!campaign) throw new Error("Follow-up campaign not found");
}

export async function campaignEmail(tenantId: number, broadcastId: number, customerId: number, body: string) {
  const [broadcast] = await db.select().from(broadcastsTable).where(and(eq(broadcastsTable.id, broadcastId), eq(broadcastsTable.tenantId, tenantId)));
  if (!broadcast) throw new Error("Campaign email not found");
  const source = (broadcast.recipientFilter as { campaignId?: number })?.campaignId ?? null;
  // Old scheduled messages without a destination fail explicitly rather than
  // mailing nonfunctional buttons or silently creating a campaign.
  await validateCampaignDestination(tenantId, broadcast.notInterestedCampaignId, source ?? undefined);
  const token = randomBytes(32).toString("hex");
  await db.insert(campaignResponsesTable).values({
    tenantId, broadcastId, customerId, tokenHash: hashPreferenceToken(token),
    sourceCampaignId: source, destinationCampaignId: broadcast.notInterestedCampaignId,
  });
  const base = `${PUBLIC_ORIGIN}/api/public/campaign-preferences/${token}`;
  const later = `${base}?action=not_interested`, unsubscribe = `${base}?action=unsubscribe`;
  return {
    text: `${body}\n\nNot interested right now: ${later}\nUnsubscribe from marketing emails: ${unsubscribe}`,
    html: `<div style="font:16px/1.6 Arial,sans-serif;white-space:pre-wrap">${escapeEmailHtml(body)}</div><p><a style="display:inline-block;padding:12px;background:#174b38;color:white;border-radius:6px" href="${later}">Not interested right now</a></p><p>Keep in touch about other offers, without follow-ups for this campaign.</p><p><a href="${unsubscribe}">Unsubscribe</a> from all marketing emails.</p>`,
  };
}

export async function marketingEmailAllowed(tenantId: number, customerId: number, sourceCampaignId?: number) {
  const [customer] = await db.select().from(customersTable).where(and(eq(customersTable.id, customerId), eq(customersTable.tenantId, tenantId)));
  if (!customer || customer.emailOptOut || customer.archivedAt) return false;
  if (!sourceCampaignId) return true;
  const [suppression] = await db.select({ id: campaignResponsesTable.id }).from(campaignResponsesTable).where(and(
    eq(campaignResponsesTable.tenantId, tenantId), eq(campaignResponsesTable.customerId, customerId),
    eq(campaignResponsesTable.sourceCampaignId, sourceCampaignId), eq(campaignResponsesTable.action, "not_interested"),
  )).limit(1);
  return !suppression;
}

export async function applyCampaignPreference(token: string, action: string) {
  if (!["unsubscribe", "not_interested"].includes(action)) throw new Error("Invalid action");
  return db.transaction(async tx => {
    const [link] = await tx.select().from(campaignResponsesTable).where(eq(campaignResponsesTable.tokenHash, hashPreferenceToken(token))).for("update");
    if (!link) throw new Error("This link is not valid");
    const [customer] = await tx.select().from(customersTable).where(and(eq(customersTable.id, link.customerId), eq(customersTable.tenantId, link.tenantId))).for("update");
    if (!customer) throw new Error("Customer no longer available");
    if (action === "unsubscribe") {
      await tx.update(customersTable).set({ emailOptOut: true }).where(eq(customersTable.id, customer.id));
      // Keep not-interested history for source suppression. Global opt-out always wins.
    } else if (!customer.emailOptOut && link.action !== "not_interested") {
      const [destination] = await tx.select().from(marketingCampaignsTable).where(and(eq(marketingCampaignsTable.id, link.destinationCampaignId!), eq(marketingCampaignsTable.tenantId, link.tenantId))).for("share");
      if (!destination) throw new Error("This follow-up campaign is no longer available. You can still unsubscribe.");
      // This response itself is the follow-up enrollment. Do not insert an
      // acquisition membership: doing so would inflate campaign ROAS reports.
    }
    if (link.action !== "not_interested") await tx.update(campaignResponsesTable).set({ action, respondedAt: new Date() }).where(eq(campaignResponsesTable.id, link.id));
    return action === "unsubscribe" || customer.emailOptOut
      ? "You are unsubscribed from marketing emails. Important service and billing emails are unaffected."
      : "Thank you. We will stop follow-ups for this offer and keep in touch through the selected follow-up campaign.";
  });
}
