import { Router, type IRouter } from "express";
import { db, estimatesTable, visitsTable, jobsTable, customersTable, propertiesTable, usersTable, tenantsTable, blueprintsTable, communicationsLogTable, estimateTemplatesTable, invoicesTable } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { getStripeClient, getStripePublishableKey, ensureStripeCustomer } from "../lib/stripe";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { sendReviewRequest } from "../lib/reviewService";
import { sendEmail, buildEstimateResponseNotificationHtml, type EmailProviderConfig } from "../lib/emailProvider";
import { logger } from "../lib/logger";
import crypto from "crypto";
import {
  importUpload,
  handleExportRequest,
  handleImportPreview,
  handleImportCommit,
  requireString,
  optionalString,
  optionalNumber,
  optionalDate,
  registerImportExportConfig,
  encodeLineItemsCell,
  decodeLineItemsCell,
  sumLineItems,
  type ImportExportEntityConfig,
  type LineItemCsvShape,
} from "../lib/importExport";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Supply item validation
// Only keeps items with a positive-integer inventoryItemId and a positive finite
// quantity. Strips anything that could not have come from a legitimate picker.
function normaliseSupplies(raw: unknown): { inventoryItemId: number; name: string; quantity: number; unit: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { inventoryItemId: number; name: string; quantity: number; unit: string }[] = [];
  for (const s of raw) {
    if (typeof s !== "object" || s === null) continue;
    const { inventoryItemId, name, quantity, unit } = s as Record<string, unknown>;
    // Reject any non-integer value — parseInt("1.5") → 1 and parseInt("1abc") → 1
    // would both pass an isInteger check, so we only accept already-integer numbers.
    if (!Number.isInteger(inventoryItemId) || (inventoryItemId as number) <= 0) continue;
    const id = inventoryItemId as number;
    const qty = typeof quantity === "number" ? quantity : (typeof quantity === "string" && /^\d+(\.\d+)?$/.test(quantity.trim()) ? parseFloat(quantity) : NaN);
    if (!isFinite(qty) || qty <= 0) continue;
    if (typeof name !== "string" || !name.trim()) continue;
    out.push({ inventoryItemId: id, name: String(name).trim(), quantity: qty, unit: typeof unit === "string" ? unit.trim() : "" });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Bulk import / export
// ---------------------------------------------------------------------------

const estimatesImportExportConfig: ImportExportEntityConfig = {
  entityKey: "estimates",
  fields: [
    { key: "id", header: "ID", hint: "Include to update an existing estimate instead of creating a new one" },
    { key: "customerEmail", header: "Customer Email", required: true, hint: "Looked up against existing customers" },
    { key: "propertyAddress", header: "Property Address", hint: "Looked up within the matched customer's properties" },
    { key: "status", header: "Status", hint: "draft, sent, approved, declined, expired" },
    { key: "scheduledAt", header: "Scheduled At" },
    { key: "expiresAt", header: "Expires At" },
    { key: "subtotal", header: "Subtotal" },
    { key: "tax", header: "Tax" },
    { key: "total", header: "Total" },
    { key: "notes", header: "Notes" },
    {
      key: "lineItems",
      header: "Line Items",
      hint: 'Optional. Format: "description=Aerate lawn|qty=1|unitprice=150; description=Overseed|qty=1|unitprice=200|optional=true". Subtotal/Total auto-computed if left blank. See docs for full syntax.',
    },
  ],
  exportColumns: [
    { key: "id", header: "ID" },
    { key: "customerName", header: "Customer Name" },
    { key: "customerEmail", header: "Customer Email" },
    { key: "propertyAddress", header: "Property Address" },
    { key: "status", header: "Status" },
    { key: "scheduledAt", header: "Scheduled At" },
    { key: "expiresAt", header: "Expires At" },
    { key: "subtotal", header: "Subtotal" },
    { key: "tax", header: "Tax" },
    { key: "total", header: "Total" },
    { key: "notes", header: "Notes" },
    { key: "lineItems", header: "Line Items" },
    { key: "createdAt", header: "Created At" },
  ],
  buildExportRows: async (tenantId, query) => {
    let where = eq(estimatesTable.tenantId, tenantId) as ReturnType<typeof eq>;
    if (query.status) where = and(where, eq(estimatesTable.status, query.status)) as typeof where;
    if (query.customerId) where = and(where, eq(estimatesTable.customerId, parseInt(query.customerId, 10))) as typeof where;
    if (query.startDate) where = and(where, sql`${estimatesTable.scheduledAt} >= ${query.startDate}::timestamptz`) as typeof where;
    if (query.endDate) where = and(where, sql`${estimatesTable.scheduledAt} <= ${query.endDate}::timestamptz`) as typeof where;

    const rows = await db
      .select({
        estimate: estimatesTable,
        customerName: customersTable.name,
        customerEmail: customersTable.email,
        propertyAddress: propertiesTable.address,
      })
      .from(estimatesTable)
      .leftJoin(customersTable, eq(estimatesTable.customerId, customersTable.id))
      .leftJoin(propertiesTable, eq(estimatesTable.propertyId, propertiesTable.id))
      .where(where)
      .orderBy(desc(estimatesTable.createdAt));

    return rows.map((r) => ({
      id: r.estimate.id,
      customerName: r.customerName ?? "",
      customerEmail: r.customerEmail ?? "",
      propertyAddress: r.propertyAddress ?? "",
      status: r.estimate.status,
      scheduledAt: r.estimate.scheduledAt?.toISOString() ?? "",
      expiresAt: r.estimate.expiresAt?.toISOString() ?? "",
      subtotal: r.estimate.subtotal,
      tax: r.estimate.tax,
      total: r.estimate.total,
      notes: r.estimate.notes ?? "",
      lineItems: encodeLineItemsCell((r.estimate.lineItems as LineItemCsvShape[]) ?? []),
      createdAt: r.estimate.createdAt.toISOString(),
    }));
  },
  parseRow: async (tenantId, raw) => {
    const errors: string[] = [];
    const customerEmail = requireString(raw.customerEmail, "Customer Email", errors);
    const lineItems = decodeLineItemsCell(raw.lineItems, errors);
    if (errors.length > 0 || !customerEmail) return { ok: false, errors };

    const [customer] = await db
      .select({ id: customersTable.id })
      .from(customersTable)
      .where(and(eq(customersTable.tenantId, tenantId), sql`lower(${customersTable.email}) = lower(${customerEmail})`))
      .limit(1);
    if (!customer) return { ok: false, errors: [`No customer found with email "${customerEmail}"`] };

    let propertyId: number | null = null;
    if (raw.propertyAddress?.trim()) {
      const [property] = await db
        .select({ id: propertiesTable.id })
        .from(propertiesTable)
        .where(and(
          eq(propertiesTable.tenantId, tenantId),
          eq(propertiesTable.customerId, customer.id),
          sql`lower(${propertiesTable.address}) = lower(${raw.propertyAddress.trim()})`,
        ))
        .limit(1);
      if (!property) return { ok: false, errors: [`No property found at "${raw.propertyAddress}" for that customer`] };
      propertyId = property.id;
    }

    const idNum = optionalNumber(raw.id, "ID", errors);
    const computedSubtotal = lineItems.length > 0 ? sumLineItems(lineItems) : 0;
    const subtotal = optionalNumber(raw.subtotal, "Subtotal", errors) ?? computedSubtotal;
    const tax = optionalNumber(raw.tax, "Tax", errors) ?? 0;
    const total = optionalNumber(raw.total, "Total", errors) ?? subtotal + tax;
    const scheduledAt = optionalDate(raw.scheduledAt, "Scheduled At", errors);
    const expiresAt = optionalDate(raw.expiresAt, "Expires At", errors);
    if (errors.length > 0) return { ok: false, errors };

    return {
      ok: true,
      values: {
        ...(idNum != null ? { id: idNum } : {}),
        customerId: customer.id,
        propertyId,
        status: optionalString(raw.status) ?? "draft",
        scheduledAt: scheduledAt ?? null,
        expiresAt: expiresAt ?? null,
        subtotal,
        tax,
        total,
        notes: optionalString(raw.notes) ?? null,
        ...(lineItems.length > 0 ? { lineItems } : {}),
      },
    };
  },
  findExisting: async (tenantId, values) => {
    if (values.id == null) return null;
    const id = Number(values.id);
    if (Number.isNaN(id)) return null;
    const [existing] = await db.select({ id: estimatesTable.id }).from(estimatesTable)
      .where(and(eq(estimatesTable.id, id), eq(estimatesTable.tenantId, tenantId))).limit(1);
    return existing?.id ?? null;
  },
  insert: async (tenantId, values) => {
    const { id: _ignoredId, ...rest } = values;
    const [row] = await db.insert(estimatesTable).values({ tenantId, ...rest } as typeof estimatesTable.$inferInsert).returning({ id: estimatesTable.id });
    return row.id;
  },
  update: async (tenantId, id, values) => {
    const { id: _ignoredId, ...rest } = values;
    await db.update(estimatesTable).set(rest as Partial<typeof estimatesTable.$inferInsert>)
      .where(and(eq(estimatesTable.id, id), eq(estimatesTable.tenantId, tenantId)));
  },
  getById: async (tenantId, id) => {
    const [row] = await db.select().from(estimatesTable).where(and(eq(estimatesTable.id, id), eq(estimatesTable.tenantId, tenantId))).limit(1);
    if (!row) return null;
    const { id: _id, tenantId: _t, createdAt: _c, ...rest } = row;
    return rest;
  },
  deleteById: async (tenantId, id) => {
    await db.delete(estimatesTable).where(and(eq(estimatesTable.id, id), eq(estimatesTable.tenantId, tenantId)));
  },
};
registerImportExportConfig(estimatesImportExportConfig);

router.get("/estimates/export", async (req, res): Promise<void> => {
  await handleExportRequest(req, res, getTenantId(req), estimatesImportExportConfig);
});

router.post("/estimates/import/preview", importUpload.single("file"), async (req, res): Promise<void> => {
  await handleImportPreview(req, res, getTenantId(req), estimatesImportExportConfig);
});

router.post("/estimates/import/commit", importUpload.single("file"), async (req, res): Promise<void> => {
  await handleImportCommit(req, res, getTenantId(req), estimatesImportExportConfig);
});

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * For each mutual-exclusion group, keep only the first accepted item and
 * deselect the rest. Safe to call on items with no groupId (no-op for them).
 */
function normalizeGroupedSelections(items: EstimateLineItem[]): EstimateLineItem[] {
  const acceptedGroups = new Set<string>();
  return items.map(item => {
    if (!item.isOptional || !item.groupId || !item.acceptedByCustomer) return item;
    if (acceptedGroups.has(item.groupId)) {
      return { ...item, acceptedByCustomer: false };
    }
    acceptedGroups.add(item.groupId);
    return item;
  });
}

/**
 * Compute totals from line items.
 * Only required items (isOptional=false) and accepted optional items
 * (isOptional=true AND acceptedByCustomer=true) are counted.
 * Unaccepted optional add-ons are excluded so totals reflect billable value.
 */
function calcTotals(lineItems: EstimateLineItem[]) {
  // For grouped optional items, only the first accepted item per group is counted.
  const countedGroups = new Set<string>();
  let subtotal = 0;
  for (const item of lineItems) {
    // Skip optional items that the customer has not accepted
    if (item.isOptional && !item.acceptedByCustomer) continue;
    // For grouped optional items, only count one per group
    if (item.isOptional && item.groupId) {
      if (countedGroups.has(item.groupId)) continue;
      countedGroups.add(item.groupId);
    }
    const base = item.qty * item.unitPrice;
    const afterMarkup = base * (1 + item.markup / 100);
    const afterDiscount = afterMarkup * (1 - item.discount / 100);
    subtotal += afterDiscount;
  }
  const tax = 0; // tax handled separately if needed
  return { subtotal, tax, total: subtotal + tax };
}

/** Allowed status transitions for the PATCH endpoint (admin use) */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  draft:    ["sent", "expired"],
  sent:     ["draft", "expired"],
  approved: [],   // terminal — use /convert to progress further
  declined: [],   // terminal
  expired:  [],   // terminal
};

interface EstimateLineItem {
  id: string;
  serviceId?: number | null;
  description: string;
  qty: number;
  unitPrice: number;
  markup: number;
  discount: number;
  isOptional: boolean;
  optionalPitchLine?: string | null;
  acceptedByCustomer: boolean;
  /** If set, items sharing this groupId are mutually exclusive (radio set) */
  groupId?: string | null;
}

function formatEstimate(
  e: typeof estimatesTable.$inferSelect,
  extras?: { customerName?: string | null; assigneeName?: string | null; propertyAddress?: string | null; templateName?: string | null }
) {
  return {
    ...e,
    lineItems: (e.lineItems as unknown[]) ?? [],
    scheduledAt: e.scheduledAt?.toISOString() ?? null,
    expiresAt: e.expiresAt?.toISOString() ?? null,
    sentAt: e.sentAt?.toISOString() ?? null,
    approvedAt: e.approvedAt?.toISOString() ?? null,
    declinedAt: e.declinedAt?.toISOString() ?? null,
    depositPaidAt: e.depositPaidAt?.toISOString() ?? null,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    customerName: extras?.customerName ?? null,
    assigneeName: extras?.assigneeName ?? null,
    propertyAddress: extras?.propertyAddress ?? null,
    templateName: extras?.templateName ?? null,
  };
}

/** Compute the deposit amount in dollars given estimate totals and payment requirement. */
function calcDepositAmount(paymentRequirement: string | null, depositValue: number | null, total: number): number {
  if (!paymentRequirement || paymentRequirement === "none") return 0;
  if (paymentRequirement === "full") return total;
  if (paymentRequirement === "deposit_pct") return Math.round((depositValue ?? 0) / 100 * total * 100) / 100;
  if (paymentRequirement === "deposit_fixed") return depositValue ?? 0;
  return 0;
}

const VALID_PAYMENT_REQUIREMENTS = ["none", "full", "deposit_pct", "deposit_fixed"] as const;

/**
 * Validates payment-term fields.
 * Returns a human-readable error string on failure, or null when valid.
 */
function validatePaymentTerms(
  req: string | null | undefined,
  val: number | null | undefined,
): string | null {
  const r = req ?? "none";
  if (!(VALID_PAYMENT_REQUIREMENTS as readonly string[]).includes(r)) {
    return `paymentRequirement must be one of: ${VALID_PAYMENT_REQUIREMENTS.join(", ")}`;
  }
  if (r === "deposit_pct") {
    const n = typeof val === "number" ? val : (val != null ? parseFloat(String(val)) : NaN);
    if (!isFinite(n) || n <= 0 || n > 100) {
      return "depositValue must be a number in (0, 100] for deposit_pct";
    }
  }
  if (r === "deposit_fixed") {
    const n = typeof val === "number" ? val : (val != null ? parseFloat(String(val)) : NaN);
    if (!isFinite(n) || n <= 0) {
      return "depositValue must be a finite positive number for deposit_fixed";
    }
  }
  return null;
}

// ── LIST ──────────────────────────────────────────────────────────────────────
router.get("/estimates", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { status, assigneeId, customerId, startDate, endDate } = req.query as Record<string, string>;

  let where = eq(estimatesTable.tenantId, tenantId) as ReturnType<typeof eq>;
  if (status) where = and(where, eq(estimatesTable.status, status)) as typeof where;
  if (assigneeId) where = and(where, eq(estimatesTable.assigneeId, parseInt(assigneeId, 10))) as typeof where;
  if (customerId) where = and(where, eq(estimatesTable.customerId, parseInt(customerId, 10))) as typeof where;
  if (startDate) where = and(where, sql`${estimatesTable.scheduledAt} >= ${startDate}::timestamptz`) as typeof where;
  if (endDate) where = and(where, sql`${estimatesTable.scheduledAt} <= ${endDate}::timestamptz`) as typeof where;

  const rows = await db
    .select({
      estimate: estimatesTable,
      customerName: customersTable.name,
      assigneeName: usersTable.name,
      propertyAddress: propertiesTable.address,
    })
    .from(estimatesTable)
    .leftJoin(customersTable, eq(estimatesTable.customerId, customersTable.id))
    .leftJoin(usersTable, eq(estimatesTable.assigneeId, usersTable.id))
    .leftJoin(propertiesTable, eq(estimatesTable.propertyId, propertiesTable.id))
    .where(where)
    .orderBy(desc(estimatesTable.createdAt));

  res.json(rows.map(r => formatEstimate(r.estimate, {
    customerName: r.customerName,
    assigneeName: r.assigneeName,
    propertyAddress: r.propertyAddress,
  })));
});

// ── PIPELINE STATS ────────────────────────────────────────────────────────────
router.get("/estimates/pipeline", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);

  const rows = await db
    .select({ status: estimatesTable.status, total: estimatesTable.total, lineItems: estimatesTable.lineItems })
    .from(estimatesTable)
    .where(eq(estimatesTable.tenantId, tenantId));

  let pipelineValue = 0;
  let upsellRevenue = 0;

  for (const r of rows) {
    if (r.status === "sent") pipelineValue += r.total ?? 0;
    if (r.status === "approved") {
      const items = (r.lineItems as EstimateLineItem[]) ?? [];
      for (const item of items) {
        if (item.isOptional && item.acceptedByCustomer) {
          const base = item.qty * item.unitPrice;
          const afterMarkup = base * (1 + item.markup / 100);
          const afterDiscount = afterMarkup * (1 - item.discount / 100);
          upsellRevenue += afterDiscount;
        }
      }
    }
  }

  res.json({ pipelineValue, upsellRevenue });
});

// ── CREATE ────────────────────────────────────────────────────────────────────
router.post("/estimates", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { customerId, propertyId, blueprintId, assigneeId, visitMode, scheduledAt, expiresAt, notes, lineItems, templateId, estimatedDurationMin, suppliesNeeded, paymentRequirement, depositValue } = req.body;

  let items: EstimateLineItem[] = lineItems ?? [];
  let resolvedTemplateId: number | null = null;

  // If a templateId was provided, load template line items and record the reference
  if (templateId) {
    const templateIdNum = parseInt(templateId, 10);
    const [tmpl] = await db.select().from(estimateTemplatesTable).where(and(eq(estimateTemplatesTable.id, templateIdNum), eq(estimateTemplatesTable.tenantId, tenantId)));
    if (tmpl) {
      items = (tmpl.lineItems as EstimateLineItem[]) ?? [];
      resolvedTemplateId = tmpl.id;
    }
  }

  const { subtotal, tax, total } = calcTotals(items);

  // Validate payment terms before persisting
  const payTermErr = validatePaymentTerms(paymentRequirement, depositValue != null ? parseFloat(String(depositValue)) : undefined);
  if (payTermErr) { res.status(400).json({ error: payTermErr }); return; }

  // Default expiry 30 days
  const defaultExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const [estimate] = await db.insert(estimatesTable).values({
    tenantId,
    customerId: customerId ? parseInt(customerId, 10) : null,
    propertyId: propertyId ? parseInt(propertyId, 10) : null,
    blueprintId: blueprintId ? parseInt(blueprintId, 10) : null,
    templateId: resolvedTemplateId,
    assigneeId: assigneeId ? parseInt(assigneeId, 10) : null,
    visitMode: visitMode ?? "scheduled",
    scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
    expiresAt: expiresAt ? new Date(expiresAt) : defaultExpiry,
    notes: notes ?? null,
    lineItems: items,
    subtotal,
    tax,
    total,
    estimatedDurationMin: estimatedDurationMin != null ? parseInt(String(estimatedDurationMin), 10) : null,
    suppliesNeeded: normaliseSupplies(suppliesNeeded),
    paymentRequirement: paymentRequirement ?? "none",
    depositValue: depositValue != null ? parseFloat(String(depositValue)) : null,
    status: "draft",
  }).returning();

  res.status(201).json(formatEstimate(estimate));
});

// ── GET ONE ───────────────────────────────────────────────────────────────────
router.get("/estimates/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);

  const [row] = await db
    .select({
      estimate: estimatesTable,
      customerName: customersTable.name,
      assigneeName: usersTable.name,
      propertyAddress: propertiesTable.address,
      templateName: estimateTemplatesTable.name,
    })
    .from(estimatesTable)
    .leftJoin(customersTable, eq(estimatesTable.customerId, customersTable.id))
    .leftJoin(usersTable, eq(estimatesTable.assigneeId, usersTable.id))
    .leftJoin(propertiesTable, eq(estimatesTable.propertyId, propertiesTable.id))
    .leftJoin(estimateTemplatesTable, eq(estimatesTable.templateId, estimateTemplatesTable.id))
    .where(and(eq(estimatesTable.id, id), eq(estimatesTable.tenantId, tenantId)));

  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatEstimate(row.estimate, { customerName: row.customerName, assigneeName: row.assigneeName, propertyAddress: row.propertyAddress, templateName: row.templateName }));
});

// ── UPDATE ────────────────────────────────────────────────────────────────────
router.patch("/estimates/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  const { customerId, propertyId, assigneeId, visitMode, scheduledAt, expiresAt, notes, lineItems, status, estimatedDurationMin, suppliesNeeded, paymentRequirement, depositValue } = req.body;

  // Always fetch the current record upfront — needed for status-transition
  // validation, deposit-paid guard, and payment-term validation on partial updates.
  const [current] = await db
    .select({ status: estimatesTable.status, depositPaidAt: estimatesTable.depositPaidAt, paymentRequirement: estimatesTable.paymentRequirement, depositValue: estimatesTable.depositValue })
    .from(estimatesTable)
    .where(and(eq(estimatesTable.id, id), eq(estimatesTable.tenantId, tenantId)));
  if (!current) { res.status(404).json({ error: "Not found" }); return; }

  // Once a deposit or full payment has been collected, lock the fields that
  // determine the charged amount. Allowing staff to change line items or payment
  // terms after the customer has paid would either break the 409 integrity check
  // at approval time (full/pct) or silently change the approved scope (fixed).
  if (current.depositPaidAt) {
    const lockedFields = ["lineItems", "paymentRequirement", "depositValue", "status"] as const;
    const attempted = lockedFields.filter(f => req.body[f] !== undefined);
    if (attempted.length > 0) {
      res.status(409).json({
        error: `Cannot change ${attempted.join(", ")} after a deposit has been collected for this estimate. Issue a refund first if the scope needs to change.`,
      });
      return;
    }
  }

  const updateData: Partial<typeof estimatesTable.$inferInsert> = {};
  if (customerId !== undefined) updateData.customerId = customerId ? parseInt(customerId, 10) : null;
  if (propertyId !== undefined) updateData.propertyId = propertyId ? parseInt(propertyId, 10) : null;
  if (assigneeId !== undefined) updateData.assigneeId = assigneeId ? parseInt(assigneeId, 10) : null;
  if (visitMode) updateData.visitMode = visitMode;
  if (scheduledAt !== undefined) updateData.scheduledAt = scheduledAt ? new Date(scheduledAt) : null;
  if (expiresAt !== undefined) updateData.expiresAt = expiresAt ? new Date(expiresAt) : null;
  if (notes !== undefined) updateData.notes = notes;
  if (status) {
    const allowed = ALLOWED_TRANSITIONS[current.status] ?? [];
    if (!allowed.includes(status)) {
      res.status(409).json({ error: `Cannot transition estimate from '${current.status}' to '${status}'` });
      return;
    }
    updateData.status = status;
  }
  if (estimatedDurationMin !== undefined) updateData.estimatedDurationMin = estimatedDurationMin != null ? parseInt(String(estimatedDurationMin), 10) : null;
  if (suppliesNeeded !== undefined) (updateData as any).suppliesNeeded = normaliseSupplies(suppliesNeeded);
  if (paymentRequirement !== undefined || depositValue !== undefined) {
    // Resolve the effective term set: use the incoming value if provided, otherwise
    // fall back to the value already persisted.  This prevents partial updates from
    // silently bypassing validation (e.g. sending only depositValue=0 with an existing
    // deposit_pct requirement).
    const effectiveReq = paymentRequirement !== undefined ? (paymentRequirement ?? "none") : (current.paymentRequirement ?? "none");
    const rawVal = depositValue !== undefined ? depositValue : current.depositValue;
    const effectiveVal = rawVal != null ? parseFloat(String(rawVal)) : undefined;
    const payTermErr = validatePaymentTerms(effectiveReq, effectiveVal);
    if (payTermErr) { res.status(400).json({ error: payTermErr }); return; }
    if (paymentRequirement !== undefined) updateData.paymentRequirement = effectiveReq;
    if (depositValue !== undefined) updateData.depositValue = effectiveVal != null ? effectiveVal : null;
  }
  if (lineItems !== undefined) {
    const items: EstimateLineItem[] = lineItems;
    const { subtotal, tax, total } = calcTotals(items);
    updateData.lineItems = items;
    updateData.subtotal = subtotal;
    updateData.tax = tax;
    updateData.total = total;
  }

  const [updated] = await db.update(estimatesTable)
    .set(updateData)
    .where(and(eq(estimatesTable.id, id), eq(estimatesTable.tenantId, tenantId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  // Same archive-on-decline side effect as the public respond endpoint — status can also transition
  // to declined from here (staff manually marking an estimate declined), so the blueprint must be
  // archived from this path too, not just the customer-facing token respond flow.
  if (updateData.status === "declined" && updated.blueprintId) {
    await db.update(blueprintsTable)
      .set({ isArchived: true, archivedAt: new Date() })
      .where(and(eq(blueprintsTable.id, updated.blueprintId), eq(blueprintsTable.tenantId, updated.tenantId)));
  }

  res.json(formatEstimate(updated));
});

// ── DELETE ────────────────────────────────────────────────────────────────────
router.delete("/estimates/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  await db.delete(estimatesTable).where(and(eq(estimatesTable.id, id), eq(estimatesTable.tenantId, tenantId)));
  res.sendStatus(204);
});

// ── SEND ──────────────────────────────────────────────────────────────────────
router.post("/estimates/:id/send", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);

  const [current] = await db.select().from(estimatesTable).where(and(eq(estimatesTable.id, id), eq(estimatesTable.tenantId, tenantId)));
  if (!current) { res.status(404).json({ error: "Not found" }); return; }
  if (!["draft"].includes(current.status)) {
    res.status(409).json({ error: `Cannot send estimate in status: ${current.status}` });
    return;
  }

  const token = generateToken();
  const [updated] = await db.update(estimatesTable)
    .set({ status: "sent", sentAt: new Date(), approvalToken: token })
    .where(and(eq(estimatesTable.id, id), eq(estimatesTable.tenantId, tenantId)))
    .returning();

  // ── Email the customer ─────────────────────────────────────────────────────
  let emailSent = false;
  let emailError: string | undefined;

  try {
    const [tenant, customer, property] = await Promise.all([
      db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId)).then(r => r[0]),
      updated.customerId
        ? db.select().from(customersTable).where(eq(customersTable.id, updated.customerId)).then(r => r[0])
        : Promise.resolve(undefined),
      updated.propertyId
        ? db.select({ address: propertiesTable.address }).from(propertiesTable).where(eq(propertiesTable.id, updated.propertyId)).then(r => r[0])
        : Promise.resolve(undefined),
    ]);

    if (tenant && customer?.email && !customer.emailOptOut) {
      const domainsEnv = process.env.REPLIT_DOMAINS;
      const firstDomain = domainsEnv?.split(",")[0]?.trim();
      const domain = firstDomain || process.env.REPLIT_DEV_DOMAIN;

      if (domain) {
        const approvalUrl = `https://${domain}/estimate/${token}`;
        const companyName = tenant.name ?? "Your service provider";
        const firstName = customer.name.split(" ")[0] ?? customer.name;

        const items = (updated.lineItems as EstimateLineItem[]) ?? [];
        const requiredItems = items.filter(i => !i.isOptional);
        const optionalItems = items.filter(i => i.isOptional);

        const formatMoney = (n: number) => `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        const expiryLine = updated.expiresAt
          ? `This estimate expires on ${updated.expiresAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.`
          : null;

        const serviceLines = requiredItems.map(item => {
          const lineTotal = item.qty * item.unitPrice * (1 + item.markup / 100) * (1 - item.discount / 100);
          return `  • ${item.description}${item.qty !== 1 ? ` (qty ${item.qty})` : ""} — ${formatMoney(lineTotal)}`;
        });
        const optionalLines = optionalItems.map(item => {
          const lineTotal = item.qty * item.unitPrice * (1 + item.markup / 100) * (1 - item.discount / 100);
          return `  • ${item.description} — ${formatMoney(lineTotal)} (optional add-on)${item.optionalPitchLine ? `\n    ${item.optionalPitchLine}` : ""}`;
        });

        const subject = `Your estimate from ${companyName} — ${formatMoney(updated.total ?? 0)}`;
        const body = [
          `Hi ${firstName},`,
          "",
          `${companyName} has prepared an estimate for you.`,
          "",
          property?.address ? `Property: ${property.address}` : null,
          "",
          "── Services ──",
          ...serviceLines,
          ...(optionalLines.length > 0 ? ["", "── Optional Add-Ons ──", ...optionalLines] : []),
          "",
          `Total: ${formatMoney(updated.total ?? 0)}`,
          "",
          expiryLine,
          "",
          "To review and approve your estimate, visit:",
          approvalUrl,
          "",
          "If you have any questions, feel free to reply to this email.",
          "",
          `Thank you,`,
          companyName,
        ].filter(l => l !== null).join("\n");

        // ── HTML email ─────────────────────────────────────────────────────────
        const accentColor = "#2d6a4f";
        const logoHtml = tenant.logoUrl
          ? `<img src="${tenant.logoUrl}" alt="${companyName}" style="max-height:60px;max-width:200px;display:block;margin:0 auto 12px;">`
          : "";

        const buildItemRow = (item: EstimateLineItem, badge?: string) => {
          const lineTotal = item.qty * item.unitPrice * (1 + item.markup / 100) * (1 - item.discount / 100);
          const badgeHtml = badge
            ? ` <span style="font-size:11px;color:#6b7280;background:#f3f4f6;border-radius:4px;padding:1px 6px;">${badge}</span>`
            : "";
          return `
            <tr>
              <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#374151;">
                ${item.description}${badgeHtml}
                ${item.optionalPitchLine ? `<div style="font-size:12px;color:#6b7280;margin-top:3px;">${item.optionalPitchLine}</div>` : ""}
              </td>
              <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#374151;text-align:center;white-space:nowrap;">${item.qty !== 1 ? `×${item.qty}` : "—"}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#374151;text-align:right;white-space:nowrap;">${formatMoney(lineTotal)}</td>
            </tr>`;
        };

        const requiredRows = requiredItems.map(i => buildItemRow(i)).join("");
        const optionalRows = optionalItems.map(i => buildItemRow(i, "optional add-on")).join("");
        const optionalSection = optionalItems.length > 0 ? `
          <tr>
            <td colspan="3" style="padding:14px 12px 6px;font-weight:600;color:#4b5563;font-size:13px;text-transform:uppercase;letter-spacing:0.05em;">Optional Add-Ons</td>
          </tr>
          ${optionalRows}` : "";

        const propertyRow = property?.address
          ? `<p style="margin:0 0 16px;color:#6b7280;font-size:14px;">📍 ${property.address}</p>`
          : "";

        const expiryHtml = updated.expiresAt
          ? `<p style="margin:16px 0 0;font-size:13px;color:#9ca3af;">This estimate expires on ${updated.expiresAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.</p>`
          : "";

        const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:${accentColor};padding:32px 24px;text-align:center;">
            ${logoHtml}
            <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;">${companyName}</p>
            <p style="margin:6px 0 0;font-size:14px;color:rgba(255,255,255,0.8);">Estimate for Services</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:28px 28px 0;">
            <p style="margin:0 0 8px;font-size:16px;color:#111827;">Hi ${firstName},</p>
            <p style="margin:0 0 20px;color:#4b5563;font-size:15px;">${companyName} has prepared an estimate for you. Please review the details below and click the button to approve.</p>
            ${propertyRow}
          </td>
        </tr>

        <!-- Line items -->
        <tr>
          <td style="padding:0 28px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;font-size:14px;">
              <thead>
                <tr style="background:#f3f4f6;">
                  <th style="padding:10px 12px;text-align:left;font-weight:600;color:#374151;">Service</th>
                  <th style="padding:10px 12px;text-align:center;font-weight:600;color:#374151;">Qty</th>
                  <th style="padding:10px 12px;text-align:right;font-weight:600;color:#374151;">Amount</th>
                </tr>
              </thead>
              <tbody>
                ${requiredRows}
                ${optionalSection}
                <tr style="background:#f9fafb;">
                  <td colspan="2" style="padding:12px;font-weight:700;color:#111827;font-size:15px;">Total</td>
                  <td style="padding:12px;font-weight:700;color:${accentColor};font-size:16px;text-align:right;">${formatMoney(updated.total ?? 0)}</td>
                </tr>
              </tbody>
            </table>
          </td>
        </tr>

        <!-- CTA -->
        <tr>
          <td style="padding:28px;text-align:center;">
            <a href="${approvalUrl}" style="display:inline-block;background:${accentColor};color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;padding:14px 36px;border-radius:8px;">Approve Estimate</a>
            ${expiryHtml}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:20px 28px;border-top:1px solid #e5e7eb;text-align:center;font-size:13px;color:#9ca3af;">
            If you have any questions, simply reply to this email.<br>
            &mdash; ${companyName}
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

        const emailProviderConfig: EmailProviderConfig = {
          provider: (tenant.emailProvider as "smtp" | "sendgrid" | "mailgun" | "resend" | "gmail" | null) ?? null,
          config: (tenant.emailProviderConfig as Record<string, string>) ?? {},
          fromAddress: tenant.businessEmail ?? (tenant.emailProviderConfig as Record<string, string>)?.["fromAddress"] ?? null,
        };

        const result = await sendEmail(emailProviderConfig, customer.email, subject, body, html);
        emailSent = result.success;
        emailError = result.error;

        await db.insert(communicationsLogTable).values({
          tenantId,
          customerId: customer.id,
          direction: "outbound",
          channel: "email",
          toAddress: customer.email,
          subject,
          body,
          status: result.success ? "sent" : "failed",
          externalId: result.externalId ?? null,
          errorNote: result.error ?? null,
          messageType: "manual",
        });
      } else {
        emailError = "No public domain configured (REPLIT_DOMAINS/REPLIT_DEV_DOMAIN unset)";
        logger.warn({ estimateId: id, tenantId }, "Cannot email estimate: no public domain configured");
      }
    }
  } catch (err) {
    emailError = String(err);
    logger.error({ err, estimateId: id, tenantId }, "Failed to send estimate email");
  }

  res.json({ ...formatEstimate(updated), approvalToken: token, emailSent, emailError: emailError ?? null });
});

// ── RESEND ────────────────────────────────────────────────────────────────────
router.post("/estimates/:id/resend", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);

  const [current] = await db
    .select()
    .from(estimatesTable)
    .where(and(eq(estimatesTable.id, id), eq(estimatesTable.tenantId, tenantId)));
  if (!current) { res.status(404).json({ error: "Not found" }); return; }
  if (current.status !== "sent") {
    res.status(409).json({ error: `Can only resend estimates in 'sent' status; current status: ${current.status}` });
    return;
  }

  // Reuse the existing token — no rotation so the customer's original link still works
  const token = current.approvalToken ?? generateToken();
  if (!current.approvalToken) {
    await db.update(estimatesTable)
      .set({ approvalToken: token })
      .where(and(eq(estimatesTable.id, id), eq(estimatesTable.tenantId, tenantId)));
  }

  let emailSent = false;
  let emailError: string | undefined;

  try {
    const [tenant, customer, property] = await Promise.all([
      db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId)).then(r => r[0]),
      current.customerId
        ? db.select().from(customersTable).where(eq(customersTable.id, current.customerId)).then(r => r[0])
        : Promise.resolve(undefined),
      current.propertyId
        ? db.select({ address: propertiesTable.address }).from(propertiesTable).where(eq(propertiesTable.id, current.propertyId)).then(r => r[0])
        : Promise.resolve(undefined),
    ]);

    if (tenant && customer?.email && !customer.emailOptOut) {
      const domainsEnv = process.env.REPLIT_DOMAINS;
      const firstDomain = domainsEnv?.split(",")[0]?.trim();
      const domain = firstDomain || process.env.REPLIT_DEV_DOMAIN;

      if (domain) {
        const approvalUrl = `https://${domain}/estimate/${token}`;
        const companyName = tenant.name ?? "Your service provider";
        const firstName = customer.name.split(" ")[0] ?? customer.name;

        const items = (current.lineItems as EstimateLineItem[]) ?? [];
        const requiredItems = items.filter(i => !i.isOptional);
        const optionalItems = items.filter(i => i.isOptional);

        const formatMoney = (n: number) => `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        const expiryLine = current.expiresAt
          ? `This estimate expires on ${current.expiresAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.`
          : null;

        const serviceLines = requiredItems.map(item => {
          const lineTotal = item.qty * item.unitPrice * (1 + item.markup / 100) * (1 - item.discount / 100);
          return `  • ${item.description}${item.qty !== 1 ? ` (qty ${item.qty})` : ""} — ${formatMoney(lineTotal)}`;
        });
        const optionalLines = optionalItems.map(item => {
          const lineTotal = item.qty * item.unitPrice * (1 + item.markup / 100) * (1 - item.discount / 100);
          return `  • ${item.description} — ${formatMoney(lineTotal)} (optional add-on)${item.optionalPitchLine ? `\n    ${item.optionalPitchLine}` : ""}`;
        });

        const subject = `Your estimate from ${companyName} — ${formatMoney(current.total ?? 0)}`;
        const body = [
          `Hi ${firstName},`,
          "",
          `${companyName} has prepared an estimate for you.`,
          "",
          property?.address ? `Property: ${property.address}` : null,
          "",
          "── Services ──",
          ...serviceLines,
          ...(optionalLines.length > 0 ? ["", "── Optional Add-Ons ──", ...optionalLines] : []),
          "",
          `Total: ${formatMoney(current.total ?? 0)}`,
          "",
          expiryLine,
          "",
          "To review and approve your estimate, visit:",
          approvalUrl,
          "",
          "If you have any questions, feel free to reply to this email.",
          "",
          `Thank you,`,
          companyName,
        ].filter(l => l !== null).join("\n");

        const emailProviderConfig: EmailProviderConfig = {
          provider: (tenant.emailProvider as "smtp" | "sendgrid" | "mailgun" | "resend" | "gmail" | null) ?? null,
          config: (tenant.emailProviderConfig as Record<string, string>) ?? {},
          fromAddress: tenant.businessEmail ?? (tenant.emailProviderConfig as Record<string, string>)?.["fromAddress"] ?? null,
        };

        const result = await sendEmail(emailProviderConfig, customer.email, subject, body);
        emailSent = result.success;
        emailError = result.error;

        await db.insert(communicationsLogTable).values({
          tenantId,
          customerId: customer.id,
          direction: "outbound",
          channel: "email",
          toAddress: customer.email,
          subject,
          body,
          status: result.success ? "sent" : "failed",
          externalId: result.externalId ?? null,
          errorNote: result.error ?? null,
          messageType: "manual",
        });
      } else {
        emailError = "No public domain configured (REPLIT_DOMAINS/REPLIT_DEV_DOMAIN unset)";
        logger.warn({ estimateId: id, tenantId }, "Cannot resend estimate: no public domain configured");
      }
    } else if (!customer?.email) {
      emailError = "Customer has no email address on file";
    } else if (customer?.emailOptOut) {
      emailError = "Customer has opted out of email";
    }
  } catch (err) {
    emailError = String(err);
    logger.error({ err, estimateId: id, tenantId }, "Failed to resend estimate email");
  }

  res.json({ emailSent, emailError: emailError ?? null });
});

// ── CONVERT TO JOB ────────────────────────────────────────────────────────────
router.post("/estimates/:id/convert", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);

  const {
    scheduledAt,
    assigneeId,
    crewId,
    invoiceNow = true,
    title,
  } = req.body as {
    scheduledAt?: string;
    assigneeId?: number | string;
    crewId?: number | string;
    invoiceNow?: boolean;
    title?: string;
  };

  const [estimate] = await db.select().from(estimatesTable).where(and(eq(estimatesTable.id, id), eq(estimatesTable.tenantId, tenantId)));
  if (!estimate) { res.status(404).json({ error: "Not found" }); return; }

  if (estimate.status !== "approved") {
    res.status(409).json({ error: "Only approved estimates can be converted to jobs" });
    return;
  }
  if (estimate.convertedToJobId) {
    res.status(409).json({ error: "Estimate already converted to job", jobId: estimate.convertedToJobId });
    return;
  }

  // Only include required + accepted optional items
  const allItems = normalizeGroupedSelections((estimate.lineItems as EstimateLineItem[]) ?? []);
  const jobItems = allItems.filter(item => !item.isOptional || item.acceptedByCustomer);
  const { subtotal: _s, tax: _t, total } = calcTotals(jobItems);

  const resolvedScheduledAt = scheduledAt
    ? new Date(scheduledAt)
    : (estimate.scheduledAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000));

  const [job] = await db.insert(jobsTable).values({
    tenantId,
    title: title?.trim() || `Job from Estimate #${estimate.id}`,
    description: estimate.notes ?? null,
    status: "scheduled",
    priority: "normal",
    customerId: estimate.customerId,
    propertyId: estimate.propertyId,
    assigneeId: assigneeId != null ? parseInt(String(assigneeId), 10) : estimate.assigneeId,
    crewId: crewId != null ? parseInt(String(crewId), 10) : undefined,
    blueprintId: estimate.blueprintId,
    scheduledAt: resolvedScheduledAt,
    lineItems: jobItems,
    totalAmount: total,
    estimateId: estimate.id,
    estimatedDuration: estimate.estimatedDurationMin ?? undefined,
    suppliesNeeded: (estimate as any).suppliesNeeded ?? [],
    invoiceAfterJob: !invoiceNow,
  }).returning();

  let invoiceId: number | null = null;

  // If "Invoice now" was chosen, create a draft invoice immediately so staff can review and send it
  if (invoiceNow && estimate.customerId) {
    try {
      const [tenant] = await db.select({ taxRate: tenantsTable.taxRate }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
      const taxRate = tenant?.taxRate ?? 0;
      const invSubtotal = total;
      const invTax = Math.round(invSubtotal * (taxRate / 100) * 100) / 100;
      const invTotal = invSubtotal + invTax;
      const invoiceNum = `INV-${Date.now().toString().slice(-8)}`;

      // Apply any deposit already collected at acceptance time so the customer is
      // not double-charged.  Original subtotal, tax, and total are always preserved
      // so billing/reporting retains correct revenue figures.  For full-payment
      // estimates mark the invoice as paid; for deposits add a note documenting the
      // credit and remaining balance (staff can see what has already been collected).
      const depositCharged: number = (estimate as any).depositChargedAmount ?? 0;
      const payReq = estimate.paymentRequirement ?? "none";
      const isFullyPaid = payReq === "full" && depositCharged > 0;
      const remainingBalance = Math.max(0, Math.round((invTotal - depositCharged) * 100) / 100);
      const depositNote = depositCharged > 0
        ? (isFullyPaid
            ? `Paid in full via deposit at estimate acceptance (Stripe PI: ${(estimate as any).depositPaymentIntentId ?? "unknown"}).`
            : `Deposit of $${depositCharged.toFixed(2)} collected at estimate acceptance — balance due: $${remainingBalance.toFixed(2)} (Stripe PI: ${(estimate as any).depositPaymentIntentId ?? "unknown"}).`)
        : null;

      const [invoice] = await db.insert(invoicesTable).values({
        tenantId,
        invoiceNumber: invoiceNum,
        customerId: estimate.customerId,
        jobId: job.id,
        // Preserve original subtotal + tax + total so revenue reporting is correct.
        // A full-payment invoice is marked paid; a deposit invoice remains draft
        // with the collected amount documented in notes.
        status: isFullyPaid ? "paid" : "draft",
        subtotal: invSubtotal,
        tax: invTax,
        total: invTotal,
        lineItems: jobItems,
        paidAt: isFullyPaid ? new Date() : null,
        notes: depositNote,
      }).returning();
      invoiceId = invoice.id;

      // Link the invoice back to the job
      await db.update(jobsTable).set({ invoiceId: invoice.id }).where(eq(jobsTable.id, job.id));
    } catch (err) {
      console.error({ err, jobId: job.id }, "Failed to create immediate invoice on estimate conversion — flipping to deferred billing");
      // Guarantee billing: flip invoiceAfterJob=true so the job auto-invoices on completion
      // instead of leaving it permanently unbilled.
      try {
        await db.update(jobsTable).set({ invoiceAfterJob: true }).where(eq(jobsTable.id, job.id));
      } catch (fallbackErr) {
        console.error({ fallbackErr, jobId: job.id }, "Failed to set invoiceAfterJob fallback — manual billing review required");
      }
    }
  }

  await db.update(estimatesTable)
    .set({ convertedToJobId: job.id })
    .where(eq(estimatesTable.id, id));

  res.status(201).json({ jobId: job.id, invoiceId, total });
});

// ── PUBLIC: GET ESTIMATE BY TOKEN ─────────────────────────────────────────────
router.get("/public/estimates/:token", async (req, res): Promise<void> => {
  const { token } = req.params;

  const [row] = await db
    .select({
      estimate: estimatesTable,
      customerName: customersTable.name,
      propertyAddress: propertiesTable.address,
    })
    .from(estimatesTable)
    .leftJoin(customersTable, eq(estimatesTable.customerId, customersTable.id))
    .leftJoin(propertiesTable, eq(estimatesTable.propertyId, propertiesTable.id))
    .where(eq(estimatesTable.approvalToken, token));

  if (!row) { res.status(404).json({ error: "Estimate not found" }); return; }

  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, row.estimate.tenantId));

  const now = new Date();
  const expired = row.estimate.expiresAt && row.estimate.expiresAt < now;

  const items = (row.estimate.lineItems as EstimateLineItem[]) ?? [];
  const required = items.filter(i => !i.isOptional);
  const optional = items.filter(i => i.isOptional);

  const stripeEnabled = !!(tenant?.stripeEnabled && getStripeClient());
  const depositAmount = calcDepositAmount(row.estimate.paymentRequirement, row.estimate.depositValue, row.estimate.total ?? 0);
  const physicalAddress = [tenant?.businessAddress, tenant?.businessCity, tenant?.businessState, tenant?.businessZip]
    .filter(Boolean).join(", ") || null;
  const contactAddress = tenant?.businessMailingSameAsPhysical
    ? physicalAddress
    : [tenant?.businessMailingAddress, tenant?.businessMailingCity, tenant?.businessMailingState, tenant?.businessMailingZip]
        .filter(Boolean).join(", ") || physicalAddress;

  res.json({
    ...formatEstimate(row.estimate, { customerName: row.customerName, propertyAddress: row.propertyAddress }),
    approvalToken: undefined, // don't expose token in response
    required,
    optional,
    expired: !!expired,
    stripeEnabled,
    stripePublishableKey: stripeEnabled ? (getStripePublishableKey() ?? null) : null,
    depositAmount,
    businessProfile: {
      companyName: tenant?.name ?? null,
      logoUrl: tenant?.logoUrl ?? null,
      tagline: tenant?.businessTagline ?? null,
      phone: tenant?.businessPhone ?? null,
      email: tenant?.businessEmail ?? null,
      website: tenant?.businessWebsite ?? null,
      address: contactAddress,
    },
  });
});

// ── PUBLIC: CREATE SETUP INTENT ────────────────────────────────────────────────
router.post("/public/estimates/:token/setup-intent", async (req, res): Promise<void> => {
  const { token } = req.params;

  const [estimate] = await db.select().from(estimatesTable).where(eq(estimatesTable.approvalToken, token));
  if (!estimate) { res.status(404).json({ error: "Estimate not found" }); return; }
  if (!["sent"].includes(estimate.status)) {
    res.status(409).json({ error: `Estimate already ${estimate.status}` });
    return;
  }
  if (estimate.expiresAt && estimate.expiresAt < new Date()) {
    res.status(410).json({ error: "Estimate has expired" });
    return;
  }

  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, estimate.tenantId));
  if (!tenant?.stripeEnabled) {
    res.status(400).json({ error: "Stripe is not enabled for this tenant" });
    return;
  }

  const stripe = getStripeClient();
  if (!stripe) {
    res.status(503).json({ error: "Stripe is not configured on this server" });
    return;
  }

  const publishableKey = getStripePublishableKey();
  if (!publishableKey) {
    res.status(503).json({ error: "Stripe publishable key is not configured" });
    return;
  }

  if (!estimate.customerId) {
    res.status(400).json({ error: "Estimate has no linked customer" });
    return;
  }

  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, estimate.customerId));
  if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }

  const stripeCustomerId = await ensureStripeCustomer(
    customer.id,
    customer.name,
    customer.email,
    customer.stripeCustomerId,
  );

  const setupIntent = await stripe.setupIntents.create({
    customer: stripeCustomerId,
    usage: "off_session",
    automatic_payment_methods: { enabled: true, allow_redirects: "never" },
  });

  res.json({ clientSecret: setupIntent.client_secret, publishableKey });
});

// ── PUBLIC: RESPOND (APPROVE / DECLINE) ───────────────────────────────────────
router.post("/public/estimates/:token/respond", async (req, res): Promise<void> => {
  const { token } = req.params;
  const { action, acceptedOptionalItemIds, declineReason, paymentMethodId } = req.body;

  if (!["approve", "decline"].includes(action)) {
    res.status(400).json({ error: "action must be 'approve' or 'decline'" });
    return;
  }

  const [estimate] = await db.select().from(estimatesTable).where(eq(estimatesTable.approvalToken, token));
  if (!estimate) { res.status(404).json({ error: "Estimate not found" }); return; }
  if (!["sent"].includes(estimate.status)) {
    res.status(409).json({ error: `Estimate already ${estimate.status}` });
    return;
  }
  if (estimate.expiresAt && estimate.expiresAt < new Date()) {
    res.status(410).json({ error: "Estimate has expired" });
    return;
  }

  // When approving: enforce payment requirements and optionally save a payment method.
  // Payment enforcement is checked independently of Stripe enablement so that a
  // required-payment estimate cannot be approved even if Stripe is misconfigured.
  if (action === "approve") {
    const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, estimate.tenantId));

    // ── Payment-requirement gate (fail closed, outside Stripe branch) ──────────
    // If a deposit or full payment was configured but depositPaidAt is still null,
    // reject regardless of whether Stripe is enabled. The portal's authenticated
    // pay-deposit endpoint is the only path that legitimately sets depositPaidAt;
    // direct calls to this public endpoint that skip that step are blocked here.
    if (estimate.paymentRequirement && estimate.paymentRequirement !== "none" && !estimate.depositPaidAt) {
      if (!tenant?.stripeEnabled) {
        res.status(503).json({ error: "This estimate requires payment before acceptance, but payment processing is not configured. Contact your service provider." });
      } else {
        res.status(402).json({ error: "Payment is required before approving this estimate. Please complete payment in the customer portal." });
      }
      return;
    }

    if (tenant?.stripeEnabled) {
      const stripe = getStripeClient();
      if (!stripe) {
        res.status(503).json({ error: "Payment method required but Stripe is not configured on this server. Contact support." });
        return;
      }

      if (paymentMethodId) {
        // Standard flow (no deposit requirement) or customer providing a card: attach
        // and set as default for future invoices.
        if (!estimate.customerId) {
          res.status(400).json({ error: "Estimate has no linked customer" });
          return;
        }
        const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, estimate.customerId));
        if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }

        const stripeCustomerId = await ensureStripeCustomer(
          customer.id,
          customer.name,
          customer.email,
          customer.stripeCustomerId,
        );

        // Retrieve the PaymentMethod to check its current attachment status.
        // confirmCardSetup already attaches it to our customer, so re-calling attach
        // on an already-attached PM raises a Stripe error. Only attach if needed.
        const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
        if (pm.customer === null || pm.customer === undefined) {
          // Not yet attached — attach it now
          await stripe.paymentMethods.attach(paymentMethodId, { customer: stripeCustomerId });
        } else if (pm.customer !== stripeCustomerId) {
          // Attached to a different customer — reject to prevent cross-customer data leak
          res.status(422).json({ error: "Payment method belongs to a different customer" });
          return;
        }
        // Already attached to the correct customer — skip attach

        await stripe.customers.update(stripeCustomerId, {
          invoice_settings: { default_payment_method: paymentMethodId },
        });

        // Persist the Stripe payment method ID to our DB
        await db.update(customersTable)
          .set({ stripeDefaultPaymentMethodId: paymentMethodId })
          .where(eq(customersTable.id, estimate.customerId));
      } else if (!estimate.depositPaidAt) {
        // No deposit paid and no card provided on a Stripe-enabled tenant.
        // This covers estimates with paymentRequirement='none' where we still want a card on file.
        res.status(422).json({ error: "paymentMethodId is required when Stripe is enabled" });
        return;
      }
      // else: deposit was paid via the authenticated pay-deposit endpoint, which
      // already attached the card and set it as the customer's default. Nothing more needed.
    }
  }

  const items = (estimate.lineItems as EstimateLineItem[]) ?? [];

  // When a deposit has already been paid, the optional-item selection was locked
  // at payment time (the optional-items PATCH blocks changes after payment, and the
  // pay-deposit write uses an atomic line-items snapshot).  Use the authoritative
  // stored selections rather than the caller-supplied list to prevent any post-payment
  // scope change — including via a direct API call with a different acceptedOptionalItemIds.
  let markedItems: EstimateLineItem[];
  if (action === "approve" && estimate.depositPaidAt) {
    // Trust the DB snapshot: required items stay true, optional items keep their
    // stored acceptedByCustomer flag as locked at payment time.
    markedItems = items.map(item => ({
      ...item,
      acceptedByCustomer: item.isOptional ? (item.acceptedByCustomer ?? false) : true,
    }));
  } else {
    const acceptedIds: string[] = acceptedOptionalItemIds ?? [];
    markedItems = items.map(item => ({
      ...item,
      acceptedByCustomer: item.isOptional ? acceptedIds.includes(item.id) : true,
    }));
  }
  const updatedItems = normalizeGroupedSelections(markedItems);

  // Recompute totals from the post-approval line items (required + accepted optional only)
  const { subtotal, tax, total } = calcTotals(updatedItems);

  // ── Deposit-amount integrity check ──────────────────────────────────────────
  // If a deposit was collected we validate that the final approved total matches
  // the amount charged within a cent tolerance. A mismatch means the customer
  // changed their optional-item selection after payment (the optional-items endpoint
  // blocks this, but we check again here as a belt-and-suspenders defence).
  if (action === "approve" && estimate.depositPaidAt && (estimate as any).depositChargedAmount != null) {
    const charged: number = (estimate as any).depositChargedAmount;
    const req = estimate.paymentRequirement ?? "none";
    let expectedCharge = 0;
    if (req === "full") expectedCharge = total;
    else if (req === "deposit_pct") expectedCharge = Math.round((estimate.depositValue ?? 0) / 100 * total * 100) / 100;
    else if (req === "deposit_fixed") expectedCharge = estimate.depositValue ?? 0;
    // Allow 1 cent rounding tolerance
    if (Math.abs(charged - expectedCharge) > 0.01) {
      res.status(409).json({
        error: "The payment collected does not match the current estimate total. The estimate may have been modified after payment. Please contact your service provider.",
      });
      return;
    }
  }

  const isApproved = action === "approve";
  const now = new Date();

  const [updated] = await db.update(estimatesTable)
    .set({
      status: isApproved ? "approved" : "declined",
      lineItems: updatedItems,
      subtotal,
      tax,
      total,
      approvedAt: isApproved ? now : null,
      declinedAt: isApproved ? null : now,
      declineReason: isApproved ? null : (declineReason ?? null),
    })
    .where(eq(estimatesTable.approvalToken, token))
    .returning();

  // A declined estimate means the design it was built around isn't going forward — archive the
  // linked blueprint so it drops out of the main Blueprints list but stays reachable from the property.
  if (!isApproved && updated.blueprintId) {
    await db.update(blueprintsTable)
      .set({ isArchived: true, archivedAt: now })
      .where(and(eq(blueprintsTable.id, updated.blueprintId), eq(blueprintsTable.tenantId, updated.tenantId)));
  }

  // ── Fetch shared context (tenant + customer) for notifications ───────────────
  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, updated.tenantId));
  const customer = updated.customerId
    ? await db.select().from(customersTable).where(eq(customersTable.id, updated.customerId)).then(r => r[0])
    : undefined;

  if (isApproved && customer) {
    if (tenant?.reviewRequestOnEstimateApproved) {
      sendReviewRequest({ tenant, customer, estimateId: updated.id })
        .catch(err => logger.error({ err, estimateId: updated.id }, "Failed to send review request on estimate approved"));
    }
  }

  // ── Notify the assignee by email ──────────────────────────────────────────
  if (updated.assigneeId && tenant) {
    const assigneeRow = await db.select({ name: usersTable.name, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, updated.assigneeId))
      .then(r => r[0]);

    if (assigneeRow?.email) {
      try {
        const domainsEnv = process.env.REPLIT_DOMAINS;
        const firstDomain = domainsEnv?.split(",")[0]?.trim();
        const domain = firstDomain || process.env.REPLIT_DEV_DOMAIN;
        const estimatesUrl = domain
          ? `https://${domain}/estimates`
          : `/estimates`;

        const { subject, body, html } = buildEstimateResponseNotificationHtml({
          assigneeName: assigneeRow.name ?? null,
          customerName: customer?.name ?? "A customer",
          action: isApproved ? "approved" : "declined",
          total: updated.total ?? 0,
          estimatesUrl,
          companyName: tenant.name ?? "Your company",
          declineReason: isApproved ? null : (updated.declineReason ?? null),
        });

        const emailProviderConfig: EmailProviderConfig = {
          provider: (tenant.emailProvider as "smtp" | "sendgrid" | "mailgun" | "resend" | "gmail" | null) ?? null,
          config: (tenant.emailProviderConfig as Record<string, string>) ?? {},
          fromAddress: tenant.businessEmail ?? (tenant.emailProviderConfig as Record<string, string>)?.["fromAddress"] ?? null,
        };

        sendEmail(emailProviderConfig, assigneeRow.email, subject, body, html)
          .then(result => {
            if (!result.success) {
              logger.warn({ estimateId: updated.id, assigneeEmail: assigneeRow.email, error: result.error }, "Failed to send estimate response notification to assignee");
            }
          })
          .catch(err => logger.error({ err, estimateId: updated.id }, "Error sending estimate response notification to assignee"));
      } catch (err) {
        logger.error({ err, estimateId: updated.id }, "Error building estimate response notification email");
      }
    }
  }

  res.json(formatEstimate(updated));
});

export default router;
