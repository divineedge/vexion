import { db, tenantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { publicAppUrl } from "./publicSite";

export function documentLink(kind: "invoice" | "estimate", token: string, destination: string | null | undefined) {
  return `${publicAppUrl}${destination === "portal" ? "/portal/share" : ""}/${kind}/${encodeURIComponent(token)}`;
}
export async function companyDocumentLink(tenantId: number, kind: "invoice" | "estimate", token: string) {
  const [company] = await db.select({ destination: tenantsTable.documentLinkDestination }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  if (!company) throw new Error("Document company not found");
  return documentLink(kind, token, company.destination);
}
