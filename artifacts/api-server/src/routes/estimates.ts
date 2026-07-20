import { Router, type IRouter } from "express";
import { db, estimatesTable, visitsTable, jobsTable, customersTable, propertiesTable, usersTable, tenantsTable, blueprintsTable, communicationsLogTable } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { sendReviewRequest } from "../lib/reviewService";
import { sendEmail, type EmailProviderConfig } from "../lib/emailProvider";
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
 * Compute totals from line items.
 * Only required items (isOptional=false) and accepted optional items
 * (isOptional=true AND acceptedByCustomer=true) are counted.
 * Unaccepted optional add-ons are excluded so totals reflect billable value.
 */
function calcTotals(lineItems: EstimateLineItem[]) {
  let subtotal = 0;
  for (const item of lineItems) {
    // Skip optional items that the customer has not accepted
    if (item.isOptional && !item.acceptedByCustomer) continue;
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
}

function formatEstimate(
  e: typeof estimatesTable.$inferSelect,
  extras?: { customerName?: string | null; assigneeName?: string | null; propertyAddress?: string | null }
) {
  return {
    ...e,
    lineItems: (e.lineItems as unknown[]) ?? [],
    scheduledAt: e.scheduledAt?.toISOString() ?? null,
    expiresAt: e.expiresAt?.toISOString() ?? null,
    sentAt: e.sentAt?.toISOString() ?? null,
    approvedAt: e.approvedAt?.toISOString() ?? null,
    declinedAt: e.declinedAt?.toISOString() ?? null,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    customerName: extras?.customerName ?? null,
    assigneeName: extras?.assigneeName ?? null,
    propertyAddress: extras?.propertyAddress ?? null,
  };
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
  const { customerId, propertyId, blueprintId, assigneeId, visitMode, scheduledAt, expiresAt, notes, lineItems, templateId } = req.body;

  let items: EstimateLineItem[] = lineItems ?? [];

  // If a templateId was provided, load template line items
  if (templateId) {
    const { estimateTemplatesTable } = await import("@workspace/db");
    const [tmpl] = await db.select().from(estimateTemplatesTable).where(and(eq(estimateTemplatesTable.id, templateId), eq(estimateTemplatesTable.tenantId, tenantId)));
    if (tmpl) items = (tmpl.lineItems as EstimateLineItem[]) ?? [];
  }

  const { subtotal, tax, total } = calcTotals(items);

  // Default expiry 30 days
  const defaultExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const [estimate] = await db.insert(estimatesTable).values({
    tenantId,
    customerId: customerId ? parseInt(customerId, 10) : null,
    propertyId: propertyId ? parseInt(propertyId, 10) : null,
    blueprintId: blueprintId ? parseInt(blueprintId, 10) : null,
    assigneeId: assigneeId ? parseInt(assigneeId, 10) : null,
    visitMode: visitMode ?? "scheduled",
    scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
    expiresAt: expiresAt ? new Date(expiresAt) : defaultExpiry,
    notes: notes ?? null,
    lineItems: items,
    subtotal,
    tax,
    total,
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
    })
    .from(estimatesTable)
    .leftJoin(customersTable, eq(estimatesTable.customerId, customersTable.id))
    .leftJoin(usersTable, eq(estimatesTable.assigneeId, usersTable.id))
    .leftJoin(propertiesTable, eq(estimatesTable.propertyId, propertiesTable.id))
    .where(and(eq(estimatesTable.id, id), eq(estimatesTable.tenantId, tenantId)));

  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatEstimate(row.estimate, { customerName: row.customerName, assigneeName: row.assigneeName, propertyAddress: row.propertyAddress }));
});

// ── UPDATE ────────────────────────────────────────────────────────────────────
router.patch("/estimates/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  const { customerId, propertyId, assigneeId, visitMode, scheduledAt, expiresAt, notes, lineItems, status } = req.body;

  const updateData: Partial<typeof estimatesTable.$inferInsert> = {};
  if (customerId !== undefined) updateData.customerId = customerId ? parseInt(customerId, 10) : null;
  if (propertyId !== undefined) updateData.propertyId = propertyId ? parseInt(propertyId, 10) : null;
  if (assigneeId !== undefined) updateData.assigneeId = assigneeId ? parseInt(assigneeId, 10) : null;
  if (visitMode) updateData.visitMode = visitMode;
  if (scheduledAt !== undefined) updateData.scheduledAt = scheduledAt ? new Date(scheduledAt) : null;
  if (expiresAt !== undefined) updateData.expiresAt = expiresAt ? new Date(expiresAt) : null;
  if (notes !== undefined) updateData.notes = notes;
  if (status) {
    // Fetch current status to validate transition
    const [current] = await db.select({ status: estimatesTable.status })
      .from(estimatesTable)
      .where(and(eq(estimatesTable.id, id), eq(estimatesTable.tenantId, tenantId)));
    if (!current) { res.status(404).json({ error: "Not found" }); return; }
    const allowed = ALLOWED_TRANSITIONS[current.status] ?? [];
    if (!allowed.includes(status)) {
      res.status(409).json({ error: `Cannot transition estimate from '${current.status}' to '${status}'` });
      return;
    }
    updateData.status = status;
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
        logger.warn({ estimateId: id, tenantId }, "Cannot email estimate: no public domain configured");
      }
    }
  } catch (err) {
    emailError = String(err);
    logger.error({ err, estimateId: id, tenantId }, "Failed to send estimate email");
  }

  res.json({ ...formatEstimate(updated), approvalToken: token, emailSent, emailError: emailError ?? null });
});

// ── CONVERT TO JOB ────────────────────────────────────────────────────────────
router.post("/estimates/:id/convert", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const id = parseInt(req.params.id, 10);

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
  const allItems = (estimate.lineItems as EstimateLineItem[]) ?? [];
  const jobItems = allItems.filter(item => !item.isOptional || item.acceptedByCustomer);
  const { subtotal, tax, total } = calcTotals(jobItems);

  const [job] = await db.insert(jobsTable).values({
    tenantId,
    title: `Job from Estimate #${estimate.id}`,
    description: estimate.notes ?? null,
    status: "scheduled",
    priority: "normal",
    customerId: estimate.customerId,
    propertyId: estimate.propertyId,
    assigneeId: estimate.assigneeId,
    blueprintId: estimate.blueprintId,
    scheduledAt: estimate.scheduledAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
    lineItems: jobItems,
    totalAmount: total,
  }).returning();

  await db.update(estimatesTable)
    .set({ convertedToJobId: job.id })
    .where(eq(estimatesTable.id, id));

  res.status(201).json({ jobId: job.id, total });
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

  res.json({
    ...formatEstimate(row.estimate, { customerName: row.customerName, propertyAddress: row.propertyAddress }),
    approvalToken: undefined, // don't expose token in response
    required,
    optional,
    expired: !!expired,
    businessProfile: {
      companyName: tenant?.name ?? null,
      logoUrl: tenant?.logoUrl ?? null,
      tagline: tenant?.businessTagline ?? null,
      phone: tenant?.businessPhone ?? null,
      email: tenant?.businessEmail ?? null,
      website: tenant?.businessWebsite ?? null,
      address: tenant?.businessAddress ?? null,
    },
  });
});

// ── PUBLIC: RESPOND (APPROVE / DECLINE) ───────────────────────────────────────
router.post("/public/estimates/:token/respond", async (req, res): Promise<void> => {
  const { token } = req.params;
  const { action, acceptedOptionalItemIds, declineReason } = req.body;

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

  const items = (estimate.lineItems as EstimateLineItem[]) ?? [];
  const acceptedIds: string[] = acceptedOptionalItemIds ?? [];

  // Mark accepted optional items
  const updatedItems = items.map(item => ({
    ...item,
    acceptedByCustomer: item.isOptional ? acceptedIds.includes(item.id) : true,
  }));

  // Recompute totals from the post-approval line items (required + accepted optional only)
  const { subtotal, tax, total } = calcTotals(updatedItems);

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

  if (isApproved && updated.customerId) {
    const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, updated.tenantId));
    if (tenant?.reviewRequestOnEstimateApproved) {
      const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, updated.customerId));
      if (customer) {
        sendReviewRequest({ tenant, customer, estimateId: updated.id })
          .catch(err => logger.error({ err, estimateId: updated.id }, "Failed to send review request on estimate approved"));
      }
    }
  }

  res.json(formatEstimate(updated));
});

export default router;
