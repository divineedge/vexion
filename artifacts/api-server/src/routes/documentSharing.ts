import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db, estimatesTable, invoicesTable, customersTable } from "@workspace/db";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { isAdminRole } from "../lib/roles";
import { requireVerifiedStaff } from "../lib/verifiedStaff";
import { companyDocumentLink } from "../lib/documentLinks";

const router: IRouter = Router();

// Reading a link never publishes a draft. Explicit generation publishes an
// estimate for portal review, but does not email, text, or charge the customer.
for (const kind of ["estimates", "invoices"] as const) {
  for (const method of ["get", "post"] as const) {
    router[method](`/${kind}/:id/share-link`, requireVerifiedStaff, async (req, res): Promise<void> => {
      const tenantId = getTenantId(req);
      if (!await isAdminRole(tenantId, getUserId(req))) {
        res.status(403).json({ error: "Only office managers can share documents" }); return;
      }
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) { res.status(400).json({ error: "Invalid document id" }); return; }
      const table = kind === "estimates" ? estimatesTable : invoicesTable;
      const [document] = await db.select().from(table).where(and(eq(table.id, id), eq(table.tenantId, tenantId)));
      if (!document) { res.status(404).json({ error: "Document not found" }); return; }
      let token = kind === "estimates" ? (document as typeof estimatesTable.$inferSelect).approvalToken : (document as typeof invoicesTable.$inferSelect).publicToken;
      if (method === "post") {
        if (document.archivedAt) { res.status(409).json({ error: "Restore the document before sharing it" }); return; }
        const candidate = randomBytes(32).toString("hex");
        if (kind === "estimates") {
          if (!document.customerId) { res.status(400).json({ error: "Select a customer before sharing this estimate" }); return; }
          const expiresAt = req.body?.expiresAt ? new Date(req.body.expiresAt) : undefined;
          if (expiresAt && !Number.isFinite(expiresAt.getTime())) { res.status(400).json({ error: "Invalid expiry date" }); return; }
          const [updated] = await db.update(estimatesTable).set({
            approvalToken: sql`coalesce(${estimatesTable.approvalToken}, ${candidate})`,
            status: sql`case when ${estimatesTable.status} = 'draft' then 'sent' else ${estimatesTable.status} end`,
            sentAt: sql`case when ${estimatesTable.status} = 'draft' then coalesce(${estimatesTable.sentAt}, now()) else ${estimatesTable.sentAt} end`,
            ...(expiresAt && document.status === "draft" ? { expiresAt } : {}),
          }).where(and(eq(estimatesTable.id, id), eq(estimatesTable.tenantId, tenantId))).returning();
          token = updated.approvalToken;
        } else {
          const [updated] = await db.update(invoicesTable).set({
            publicToken: sql`coalesce(${invoicesTable.publicToken}, ${candidate})`,
          }).where(and(eq(invoicesTable.id, id), eq(invoicesTable.tenantId, tenantId))).returning();
          token = updated.publicToken;
        }
      }
      const [customer] = document.customerId ? await db.select({ name: customersTable.name, phone: customersTable.phone }).from(customersTable)
        .where(and(eq(customersTable.id, document.customerId), eq(customersTable.tenantId, tenantId))) : [];
      res.json({
        publicLink: token ? await companyDocumentLink(tenantId, kind === "estimates" ? "estimate" : "invoice", token) : null,
        customerName: customer?.name ?? null, customerPhone: customer?.phone ?? null,
      });
    });
  }
}
export default router;
