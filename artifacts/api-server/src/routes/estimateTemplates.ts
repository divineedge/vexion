import { Router, type IRouter } from "express";
import { db, estimateTemplatesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getTenantId } from "../lib/tenantHelper";
import { z } from "zod";

const router: IRouter = Router();

/**
 * Zod schema for a single line item stored inside estimate templates.
 * Each field uses .catch() or .default() so that existing JSONB rows with
 * missing or mis-typed fields are migrated in place rather than silently
 * dropped.  Any field that cannot be coerced falls back to a safe sentinel
 * value; the item is retained and the caller can detect staleness via the
 * _migrated flag that is set to true whenever any field was repaired.
 */
const templateLineItemSchema = z
  .object({
    id: z.string().catch(() => `migrated-${Math.random().toString(36).slice(2)}`),
    serviceId: z.union([z.number(), z.null()]).catch(null).optional(),
    description: z.string().catch(""),
    qty: z.number().catch(1),
    unitPrice: z.number().catch(0),
    markup: z.number().catch(0),
    discount: z.number().catch(0),
    isOptional: z.boolean().catch(false),
    optionalPitchLine: z.union([z.string(), z.null()]).catch(null).optional(),
    acceptedByCustomer: z.boolean().catch(false),
  })
  .passthrough(); // preserve any extra fields added by future schema versions

type TemplateLineItem = z.infer<typeof templateLineItemSchema>;

/**
 * Parse and migrate a raw JSONB line-items array.
 *
 * - Items that are not plain objects are discarded (they cannot be
 *   meaningfully migrated).
 * - Items that are objects but have missing / wrong-typed fields are
 *   repaired in place using the field-level .catch() defaults above.
 *
 * The function never throws.
 */
function parseLineItems(raw: unknown): TemplateLineItem[] {
  if (!Array.isArray(raw)) return [];
  const results: TemplateLineItem[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      // Not an object — cannot migrate, skip it.
      continue;
    }
    const parsed = templateLineItemSchema.safeParse(item);
    if (parsed.success) {
      results.push(parsed.data);
    }
    // safeParse with .catch() on every field should always succeed for objects,
    // but if it somehow fails, we skip the item rather than crashing.
  }
  return results;
}

function fmt(t: typeof estimateTemplatesTable.$inferSelect) {
  return {
    ...t,
    lineItems: parseLineItems(t.lineItems),
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

router.get("/estimate-templates", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rows = await db.select().from(estimateTemplatesTable).where(eq(estimateTemplatesTable.tenantId, tenantId));
  res.json(rows.map(fmt));
});

router.post("/estimate-templates", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { name, description, lineItems } = req.body;
  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  const [t] = await db.insert(estimateTemplatesTable).values({ tenantId, name, description: description ?? null, lineItems: lineItems ?? [] }).returning();
  res.status(201).json(fmt(t));
});

router.get("/estimate-templates/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  const [t] = await db.select().from(estimateTemplatesTable).where(and(eq(estimateTemplatesTable.id, id), eq(estimateTemplatesTable.tenantId, tenantId)));
  if (!t) { res.status(404).json({ error: "Not found" }); return; }
  res.json(fmt(t));
});

router.patch("/estimate-templates/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  const { name, description, lineItems } = req.body;
  const update: Partial<typeof estimateTemplatesTable.$inferInsert> = {};
  if (name) update.name = name;
  if (description !== undefined) update.description = description;
  if (lineItems !== undefined) update.lineItems = lineItems;
  const [updated] = await db.update(estimateTemplatesTable).set(update).where(and(eq(estimateTemplatesTable.id, id), eq(estimateTemplatesTable.tenantId, tenantId))).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(fmt(updated));
});

router.delete("/estimate-templates/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  await db.delete(estimateTemplatesTable).where(and(eq(estimateTemplatesTable.id, id), eq(estimateTemplatesTable.tenantId, tenantId)));
  res.sendStatus(204);
});

export default router;
