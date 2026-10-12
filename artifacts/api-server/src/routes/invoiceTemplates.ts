import { Router, type IRouter } from "express";
import { db, invoiceTemplatesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
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
    lateFeeSchedule: (t.lateFeeSchedule as unknown[]) ?? [],
    showJobCompletionDate: t.showJobCompletionDate ?? false,
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
    lateFeeSchedule = [], showJobCompletionDate = false,
  } = req.body;

  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  if (!VALID_LAYOUTS.has(layout)) {
    res.status(400).json({ error: `layout must be one of: ${[...VALID_LAYOUTS].join(", ")}` }); return;
  }
  if (lateFeeEnabled && lateFeeType && !VALID_FEE_TYPES.has(lateFeeType)) {
    res.status(400).json({ error: `lateFeeType must be 'percent' or 'flat'` }); return;
  }

  // Insert using Drizzle for typed fields, then update lateFeeSchedule via raw SQL
  const [t] = await db
    .insert(invoiceTemplatesTable)
    .values({
      tenantId, name, layout, lineItems,
      termsText: termsText ?? null,
      notes: req.body.notes ?? null,
      lateFeeEnabled,
      lateFeeType: lateFeeEnabled ? (lateFeeType ?? null) : null,
      lateFeeAmount: lateFeeEnabled ? (lateFeeAmount ?? null) : null,
      lateFeeDaysGrace,
      showJobCompletionDate: showJobCompletionDate ?? false,
    })
    .returning();

  // Write lateFeeSchedule via raw SQL (Drizzle silently drops new JSONB columns in set())
  if (Array.isArray(lateFeeSchedule) && lateFeeSchedule.length > 0) {
    await db.execute(sql`
      UPDATE invoice_templates
      SET late_fee_schedule = ${JSON.stringify(lateFeeSchedule)}::jsonb
      WHERE id = ${t.id}
    `);
    t.lateFeeSchedule = lateFeeSchedule;
  }

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
    lateFeeSchedule, showJobCompletionDate,
  } = req.body;

  if (layout !== undefined && !VALID_LAYOUTS.has(layout)) {
    res.status(400).json({ error: `layout must be one of: ${[...VALID_LAYOUTS].join(", ")}` }); return;
  }

  const update: Partial<typeof invoiceTemplatesTable.$inferInsert> = {};
  if (req.body.notes !== undefined) update.notes = req.body.notes;
  if (name) update.name = name;
  if (layout !== undefined) update.layout = layout;
  if (lineItems !== undefined) update.lineItems = lineItems;
  if (termsText !== undefined) update.termsText = termsText || null;
  if (lateFeeEnabled !== undefined) update.lateFeeEnabled = lateFeeEnabled;
  if (lateFeeType !== undefined) update.lateFeeType = lateFeeType || null;
  if (lateFeeAmount !== undefined) update.lateFeeAmount = lateFeeAmount;
  if (lateFeeDaysGrace !== undefined) update.lateFeeDaysGrace = lateFeeDaysGrace;
  if (showJobCompletionDate !== undefined) update.showJobCompletionDate = showJobCompletionDate;

  let updated: typeof invoiceTemplatesTable.$inferSelect | undefined;

  if (Object.keys(update).length > 0) {
    const [u] = await db
      .update(invoiceTemplatesTable)
      .set(update)
      .where(and(eq(invoiceTemplatesTable.id, id), eq(invoiceTemplatesTable.tenantId, tenantId)))
      .returning();
    if (!u) { res.status(404).json({ error: "Not found" }); return; }
    updated = u;
  }

  // Update lateFeeSchedule via raw SQL (Drizzle silently drops new JSONB columns in set())
  if (lateFeeSchedule !== undefined) {
    await db.execute(sql`
      UPDATE invoice_templates
      SET late_fee_schedule = ${JSON.stringify(Array.isArray(lateFeeSchedule) ? lateFeeSchedule : [])}::jsonb,
          updated_at = NOW()
      WHERE id = ${id} AND tenant_id = ${tenantId}
    `);
    // Refresh the row if we didn't already update above
    if (!updated) {
      const [fresh] = await db
        .select()
        .from(invoiceTemplatesTable)
        .where(and(eq(invoiceTemplatesTable.id, id), eq(invoiceTemplatesTable.tenantId, tenantId)));
      if (!fresh) { res.status(404).json({ error: "Not found" }); return; }
      updated = fresh;
    } else {
      updated.lateFeeSchedule = lateFeeSchedule;
    }
  }

  if (!updated) { res.status(400).json({ error: "No update fields provided" }); return; }
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
      notes: source.notes ?? null,
      lateFeeEnabled: source.lateFeeEnabled,
      lateFeeType: source.lateFeeType ?? null,
      lateFeeAmount: source.lateFeeAmount ?? null,
      lateFeeDaysGrace: source.lateFeeDaysGrace,
      showJobCompletionDate: source.showJobCompletionDate,
    })
    .returning();

  // Copy lateFeeSchedule via raw SQL
  const srcSchedule = (source.lateFeeSchedule as unknown[]) ?? [];
  if (srcSchedule.length > 0) {
    await db.execute(sql`
      UPDATE invoice_templates
      SET late_fee_schedule = ${JSON.stringify(srcSchedule)}::jsonb
      WHERE id = ${copy.id}
    `);
    copy.lateFeeSchedule = srcSchedule;
  }

  res.status(201).json(fmt(copy));
});

export default router;
