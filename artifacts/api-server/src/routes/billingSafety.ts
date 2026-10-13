import { Router } from "express";
import { db, customersTable, customerCreditsTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { isAdminRole } from "../lib/roles";
import { creditBalance } from "../lib/customerCredit";
import { billingCoverage } from "../lib/billingCoverage";
import { recoverJobInvoice } from "../lib/recoverJobInvoice";
import { RecoverJobInvoiceBody } from "@workspace/api-zod";
const router = Router();
router.use(["/billing/coverage", "/customers/:id/credits"], async (req, res, next) => {
  if (!await isAdminRole(getTenantId(req), getUserId(req))) { res.status(403).json({ error: "Admin access required" }); return; }
  next();
});
router.get("/billing/coverage", async (req, res) => { res.json(await billingCoverage(getTenantId(req))); });
router.post("/billing/coverage/check", async (req, res) => { res.json(await billingCoverage(getTenantId(req), true)); });
router.post("/billing/coverage/jobs/:id/invoice", async (req,res) => {
  const jobId=Number(req.params.id), parsed=RecoverJobInvoiceBody.safeParse(req.body ?? {});
  if (!Number.isSafeInteger(jobId) || jobId<=0 || !parsed.success) {res.status(400).json({error:"Invalid job or billing reason"});return;}
  try {res.json(await recoverJobInvoice(getTenantId(req),jobId,getUserId(req),parsed.data.reason));}
  catch(error) {const failure=error as Error & {status?:number};if(failure.status){res.status(failure.status).json({error:failure.message});return;}throw error;}
});
router.get("/customers/:id/credits", async (req, res) => {
  const tenantId = getTenantId(req), customerId = Number(req.params.id);
  res.json({ balance: await creditBalance(db, tenantId, customerId), entries: await db.select().from(customerCreditsTable).where(and(eq(customerCreditsTable.tenantId, tenantId), eq(customerCreditsTable.customerId, customerId))).orderBy(desc(customerCreditsTable.id)) });
});
router.post("/customers/:id/credits", async (req, res) => {
  const tenantId = getTenantId(req), customerId = Number(req.params.id);
  const { amount, reference, requestId } = req.body;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 || amount > 1000000 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001 || typeof reference !== "string" || !reference.trim() || reference.length > 500 || typeof requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(requestId)) {
    res.status(400).json({ error: "Enter a positive two-decimal amount, payment reference, and valid request ID" }); return;
  }
  const result = await db.transaction(async tx => {
    const [customer] = await tx.select().from(customersTable).where(and(eq(customersTable.tenantId, tenantId), eq(customersTable.id, customerId))).for("update");
    if (!customer) return null;
    const [existing] = await tx.select().from(customerCreditsTable).where(and(eq(customerCreditsTable.tenantId, tenantId), eq(customerCreditsTable.requestId, requestId)));
    if (existing && (existing.customerId !== customerId || existing.amount !== amount || existing.reference !== reference.trim())) return "conflict";
    if (!existing) await tx.insert(customerCreditsTable).values({ tenantId, customerId, amount, reference: reference.trim(), requestId, kind: "prepayment", createdBy: getUserId(req) });
    return { balance: await creditBalance(tx, tenantId, customerId) };
  });
  if (!result) { res.status(404).json({ error: "Customer not found" }); return; }
  if (result === "conflict") { res.status(409).json({ error: "This request ID already recorded a different payment" }); return; }
  res.json(result);
});
export default router;
