import { Router, type IRouter } from "express";
import { db, invoiceTemplatesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getTenantId } from "../lib/tenantHelper";

const router: IRouter = Router();

const VALID_LAYOUTS = new Set(["clean", "detailed", "compact"]);
const VALID_FEE_TYPES = new Set(["percent", "flat"]);

function fmt(t: typeof invoiceTemplatesTable.$inferSelect) {
  return {
    ...t,
    lineItems: (t.lineItems as unknown[]) ?? [],
    termsText: t.termsText ?? null,
    lateFeeType: t.lateFeeType ?? null,
    lateFeeAmount: t.lateFeeAmount ?? null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

router.get("/invoice-templates", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rows = await db
    .select()
    .from(invoiceTemplatesTable)
    .where(eq(invoiceTemplatesTable.tenantId, tenantId));
  res.json(rows.map(fmt));
});

router.post("/invoice-templates", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const {
    name, layout = "clean", lineItems = [],
    termsText, lateFeeEnabled = false, lateFeeType, lateFeeAmount, lateFeeDaysGrace = 0,
  } = req.body;

  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  if (!VALID_LAYOUTS.has(layout)) {
    res.status(400).json({ error: `layout must be one of: ${[...VALID_LAYOUTS].join(", ")}` }); return;
  }
  if (lateFeeEnabled && lateFeeType && !VALID_FEE_TYPES.has(lateFeeType)) {
    res.status(400).json({ error: `lateFeeType must be 'percent' or 'flat'` }); return;
  }

  const [t] = await db
    .insert(invoiceTemplatesTable)
    .values({
      tenantId, name, layout, lineItems,
      termsText: termsText ?? null,
      lateFeeEnabled,
      lateFeeType: lateFeeEnabled ? (lateFeeType ?? null) : null,
      lateFeeAmount: lateFeeEnabled ? (lateFeeAmount ?? null) : null,
      lateFeeDaysGrace,
    })
    .returning();

  res.status(201).json(fmt(t));
});

router.get("/invoice-templates/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  const [t] = await db
    .select()
    .from(invoiceTemplatesTable)
    .where(and(eq(invoiceTemplatesTable.id, id), eq(invoiceTemplatesTable.tenantId, tenantId)));
  if (!t) { res.status(404).json({ error: "Not found" }); return; }
  res.json(fmt(t));
});

router.patch("/invoice-templates/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  const {
    name, layout, lineItems,
    termsText, lateFeeEnabled, lateFeeType, lateFeeAmount, lateFeeDaysGrace,
  } = req.body;

  if (layout !== undefined && !VALID_LAYOUTS.has(layout)) {
    res.status(400).json({ error: `layout must be one of: ${[...VALID_LAYOUTS].join(", ")}` }); return;
  }

  const update: Partial<typeof invoiceTemplatesTable.$inferInsert> = {};
  if (name) update.name = name;
  if (layout !== undefined) update.layout = layout;
  if (lineItems !== undefined) update.lineItems = lineItems;
  if (termsText !== undefined) update.termsText = termsText || null;
  if (lateFeeEnabled !== undefined) update.lateFeeEnabled = lateFeeEnabled;
  if (lateFeeType !== undefined) update.lateFeeType = lateFeeType || null;
  if (lateFeeAmount !== undefined) update.lateFeeAmount = lateFeeAmount;
  if (lateFeeDaysGrace !== undefined) update.lateFeeDaysGrace = lateFeeDaysGrace;

  const [updated] = await db
    .update(invoiceTemplatesTable)
    .set(update)
    .where(and(eq(invoiceTemplatesTable.id, id), eq(invoiceTemplatesTable.tenantId, tenantId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(fmt(updated));
});

router.delete("/invoice-templates/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  await db
    .delete(invoiceTemplatesTable)
    .where(and(eq(invoiceTemplatesTable.id, id), eq(invoiceTemplatesTable.tenantId, tenantId)));
  res.sendStatus(204);
});

router.post("/invoice-templates/:id/duplicate", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  const [source] = await db
    .select()
    .from(invoiceTemplatesTable)
    .where(and(eq(invoiceTemplatesTable.id, id), eq(invoiceTemplatesTable.tenantId, tenantId)));
  if (!source) { res.status(404).json({ error: "Not found" }); return; }

  const [copy] = await db
    .insert(invoiceTemplatesTable)
    .values({
      tenantId,
      name: `${source.name} (Copy)`,
      layout: source.layout,
      lineItems: source.lineItems,
      termsText: source.termsText ?? null,
      lateFeeEnabled: source.lateFeeEnabled,
      lateFeeType: source.lateFeeType ?? null,
      lateFeeAmount: source.lateFeeAmount ?? null,
      lateFeeDaysGrace: source.lateFeeDaysGrace,
    })
    .returning();

  res.status(201).json(fmt(copy));
});

export default router;
