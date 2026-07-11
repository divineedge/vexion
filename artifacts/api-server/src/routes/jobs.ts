import { Router, type IRouter } from "express";
import { db, jobsTable, customersTable, usersTable, propertiesTable, activityLogTable, inventoryItemsTable, crewsTable, customerAlertsTable, invoicesTable, tenantsTable } from "@workspace/db";
import { eq, and, sql, desc, asc, isNotNull, isNull, ne, inArray, min, gt } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { nthOccurrenceAfterRoot, describeRule, type RecurrenceRule } from "../lib/recurrenceEngine";
import { enqueueInvoiceEmail } from "../lib/billingScheduler";
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
  type ImportExportEntityConfig,
} from "../lib/importExport";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Bulk import / export
// ---------------------------------------------------------------------------

const jobsImportExportConfig: ImportExportEntityConfig = {
  entityKey: "jobs",
  fields: [
    { key: "id", header: "ID", hint: "Include to update an existing job instead of creating a new one" },
    { key: "title", header: "Title", required: true },
    { key: "customerEmail", header: "Customer Email", hint: "Looked up against existing customers" },
    { key: "propertyAddress", header: "Property Address", hint: "Looked up within the matched customer's properties" },
    { key: "scheduledAt", header: "Scheduled At", required: true, hint: "Date/time" },
    { key: "status", header: "Status", hint: "e.g. scheduled, in_progress, completed, cancelled" },
    { key: "priority", header: "Priority", hint: "e.g. low, normal, high, urgent" },
    { key: "estimatedDuration", header: "Estimated Duration (min)" },
    { key: "totalAmount", header: "Total Amount" },
    { key: "description", header: "Description" },
  ],
  exportColumns: [
    { key: "id", header: "ID" },
    { key: "title", header: "Title" },
    { key: "customerName", header: "Customer Name" },
    { key: "customerEmail", header: "Customer Email" },
    { key: "propertyAddress", header: "Property Address" },
    { key: "scheduledAt", header: "Scheduled At" },
    { key: "status", header: "Status" },
    { key: "priority", header: "Priority" },
    { key: "estimatedDuration", header: "Estimated Duration (min)" },
    { key: "totalAmount", header: "Total Amount" },
    { key: "description", header: "Description" },
    { key: "createdAt", header: "Created At" },
  ],
  buildExportRows: async (tenantId, query) => {
    let where = eq(jobsTable.tenantId, tenantId) as ReturnType<typeof eq>;
    if (query.status) where = and(where, eq(jobsTable.status, query.status)) as typeof where;
    if (query.customerId) where = and(where, eq(jobsTable.customerId, parseInt(query.customerId, 10))) as typeof where;
    if (query.crewId) where = and(where, eq(jobsTable.crewId, parseInt(query.crewId, 10))) as typeof where;
    if (query.assigneeId) where = and(where, eq(jobsTable.assigneeId, parseInt(query.assigneeId, 10))) as typeof where;
    if (query.startDate) where = and(where, sql`${jobsTable.scheduledAt} >= ${query.startDate}::timestamptz`) as typeof where;
    if (query.endDate) where = and(where, sql`${jobsTable.scheduledAt} <= ${query.endDate}::timestamptz`) as typeof where;

    const rows = await db
      .select({
        job: jobsTable,
        customerName: customersTable.name,
        customerEmail: customersTable.email,
        propertyAddress: propertiesTable.address,
      })
      .from(jobsTable)
      .leftJoin(customersTable, eq(jobsTable.customerId, customersTable.id))
      .leftJoin(propertiesTable, eq(jobsTable.propertyId, propertiesTable.id))
      .where(where)
      .orderBy(jobsTable.scheduledAt);

    return rows.map((r) => ({
      id: r.job.id,
      title: r.job.title,
      customerName: r.customerName ?? "",
      customerEmail: r.customerEmail ?? "",
      propertyAddress: r.propertyAddress ?? "",
      scheduledAt: r.job.scheduledAt.toISOString(),
      status: r.job.status,
      priority: r.job.priority,
      estimatedDuration: r.job.estimatedDuration ?? "",
      totalAmount: r.job.totalAmount,
      description: r.job.description ?? "",
      createdAt: r.job.createdAt.toISOString(),
    }));
  },
  parseRow: async (tenantId, raw) => {
    const errors: string[] = [];
    const title = requireString(raw.title, "Title", errors);
    const scheduledAt = optionalDate(raw.scheduledAt, "Scheduled At", errors);
    if (!raw.scheduledAt?.trim()) errors.push("Scheduled At is required");
    if (errors.length > 0 || !title || !scheduledAt) return { ok: false, errors };

    let customerId: number | null = null;
    if (raw.customerEmail?.trim()) {
      const [customer] = await db
        .select({ id: customersTable.id })
        .from(customersTable)
        .where(and(eq(customersTable.tenantId, tenantId), sql`lower(${customersTable.email}) = lower(${raw.customerEmail.trim()})`))
        .limit(1);
      if (!customer) return { ok: false, errors: [`No customer found with email "${raw.customerEmail}"`] };
      customerId = customer.id;
    }

    let propertyId: number | null = null;
    if (raw.propertyAddress?.trim()) {
      if (!customerId) return { ok: false, errors: ["Property Address was given without a matching Customer Email"] };
      const [property] = await db
        .select({ id: propertiesTable.id })
        .from(propertiesTable)
        .where(and(
          eq(propertiesTable.tenantId, tenantId),
          eq(propertiesTable.customerId, customerId),
          sql`lower(${propertiesTable.address}) = lower(${raw.propertyAddress.trim()})`,
        ))
        .limit(1);
      if (!property) return { ok: false, errors: [`No property found at "${raw.propertyAddress}" for that customer`] };
      propertyId = property.id;
    }

    const idNum = optionalNumber(raw.id, "ID", errors);
    const estimatedDuration = optionalNumber(raw.estimatedDuration, "Estimated Duration", errors);
    const totalAmount = optionalNumber(raw.totalAmount, "Total Amount", errors);
    if (errors.length > 0) return { ok: false, errors };

    return {
      ok: true,
      values: {
        ...(idNum != null ? { id: idNum } : {}),
        title,
        scheduledAt,
        customerId,
        propertyId,
        status: optionalString(raw.status) ?? "scheduled",
        priority: optionalString(raw.priority) ?? "normal",
        estimatedDuration: estimatedDuration ?? null,
        totalAmount: totalAmount ?? 0,
        description: optionalString(raw.description) ?? null,
      },
    };
  },
  findExisting: async (tenantId, values) => {
    const idRaw = values.id;
    if (idRaw == null) return null;
    const id = Number(idRaw);
    if (Number.isNaN(id)) return null;
    const [existing] = await db.select({ id: jobsTable.id }).from(jobsTable)
      .where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId))).limit(1);
    return existing?.id ?? null;
  },
  insert: async (tenantId, values) => {
    const { id: _ignoredId, ...rest } = values;
    const [row] = await db.insert(jobsTable).values({ tenantId, ...rest } as typeof jobsTable.$inferInsert).returning({ id: jobsTable.id });
    return row.id;
  },
  update: async (tenantId, id, values) => {
    const { id: _ignoredId, ...rest } = values;
    await db.update(jobsTable).set(rest as Partial<typeof jobsTable.$inferInsert>)
      .where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)));
  },
  getById: async (tenantId, id) => {
    const [row] = await db.select().from(jobsTable).where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId))).limit(1);
    if (!row) return null;
    const { id: _id, tenantId: _t, createdAt: _c, ...rest } = row;
    return rest;
  },
  deleteById: async (tenantId, id) => {
    await db.delete(jobsTable).where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)));
  },
};
registerImportExportConfig(jobsImportExportConfig);

router.get("/jobs/export", async (req, res): Promise<void> => {
  await handleExportRequest(req, res, getTenantId(req), jobsImportExportConfig);
});

router.post("/jobs/import/preview", importUpload.single("file"), async (req, res): Promise<void> => {
  await handleImportPreview(req, res, getTenantId(req), jobsImportExportConfig);
});

router.post("/jobs/import/commit", importUpload.single("file"), async (req, res): Promise<void> => {
  await handleImportCommit(req, res, getTenantId(req), jobsImportExportConfig);
});

function formatJob(
  j: typeof jobsTable.$inferSelect,
  extras?: { customerName?: string | null; assigneeName?: string | null; propertyAddress?: string | null; crewName?: string | null }
) {
  const rule = j.recurrenceRule as unknown as RecurrenceRule | null;
  return {
    ...j,
    lineItems: (j.lineItems as unknown[]) ?? [],
    jobParts: (j.jobParts as unknown[]) ?? [],
    scheduledAt: j.scheduledAt.toISOString(),
    completedAt: j.completedAt?.toISOString() ?? null,
    createdAt: j.createdAt.toISOString(),
    customerName: extras?.customerName ?? null,
    assigneeName: extras?.assigneeName ?? null,
    crewName: extras?.crewName ?? null,
    propertyAddress: extras?.propertyAddress ?? null,
    invoiceId: j.invoiceId ?? null,
    blueprintId: j.blueprintId ?? null,
    crewId: j.crewId ?? null,
    serviceId: j.serviceId ?? null,
    planId: j.planId ?? null,
    cancelReason: j.cancelReason ?? null,
    recurrenceRule: j.recurrenceRule ?? null,
    recurrenceParentId: j.recurrenceParentId ?? null,
    recurrenceIndex: j.recurrenceIndex ?? null,
    isRecurrencePaused: j.isRecurrencePaused ?? false,
    recurrenceCount: j.recurrenceCount ?? 0,
    recurrenceDescription: rule ? describeRule(rule) : null,
    routeTemplateId: j.routeTemplateId ?? null,
    sequenceOrder: j.sequenceOrder ?? null,
    isOneTimeReschedule: !!j.isOneTimeReschedule,
    originalScheduledDate: j.originalScheduledDate?.toISOString() ?? null,
  };
}

router.get("/jobs", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { status, assigneeId, startDate, endDate, customerId, crewId } = req.query as Record<string, string>;

  let where = eq(jobsTable.tenantId, tenantId) as ReturnType<typeof eq>;
  if (status) where = and(where, eq(jobsTable.status, status)) as typeof where;
  if (assigneeId) where = and(where, eq(jobsTable.assigneeId, parseInt(assigneeId, 10))) as typeof where;
  if (crewId) where = and(where, eq(jobsTable.crewId, parseInt(crewId, 10))) as typeof where;
  if (customerId) where = and(where, eq(jobsTable.customerId, parseInt(customerId, 10))) as typeof where;
  if (startDate) where = and(where, sql`${jobsTable.scheduledAt} >= ${startDate}::timestamptz`) as typeof where;
  if (endDate) where = and(where, sql`${jobsTable.scheduledAt} <= ${endDate}::timestamptz`) as typeof where;

  const rows = await db
    .select({
      job: jobsTable,
      customerName: customersTable.name,
      assigneeName: usersTable.name,
      propertyAddress: propertiesTable.address,
      crewName: crewsTable.name,
    })
    .from(jobsTable)
    .leftJoin(customersTable, eq(jobsTable.customerId, customersTable.id))
    .leftJoin(usersTable, eq(jobsTable.assigneeId, usersTable.id))
    .leftJoin(propertiesTable, eq(jobsTable.propertyId, propertiesTable.id))
    .leftJoin(crewsTable, eq(jobsTable.crewId, crewsTable.id))
    .where(where)
    .orderBy(jobsTable.scheduledAt);

  res.json(rows.map(r => formatJob(r.job, { customerName: r.customerName, assigneeName: r.assigneeName, propertyAddress: r.propertyAddress, crewName: r.crewName })));
});

// ── Recurring series list ────────────────────────────────────────────────────
router.get("/jobs/series", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);

  const roots = await db
    .select({
      job: jobsTable,
      customerName: customersTable.name,
      assigneeName: usersTable.name,
      crewName: crewsTable.name,
    })
    .from(jobsTable)
    .leftJoin(customersTable, eq(jobsTable.customerId, customersTable.id))
    .leftJoin(usersTable, eq(jobsTable.assigneeId, usersTable.id))
    .leftJoin(crewsTable, eq(jobsTable.crewId, crewsTable.id))
    .where(
      and(
        eq(jobsTable.tenantId, tenantId),
        isNotNull(jobsTable.recurrenceRule),
        isNull(jobsTable.recurrenceParentId),
      )
    )
    .orderBy(desc(jobsTable.createdAt));

  const rootIds = roots.map(r => r.job.id);

  // Fetch the earliest upcoming scheduled child per root in a single query.
  // This is what users actually see on the calendar — it takes priority over
  // the computed "next ungenerated" date so skip/pre-generation stay consistent.
  const now = new Date();
  const upcomingByRoot = new Map<number, Date>();
  if (rootIds.length > 0) {
    const rows = await db
      .select({
        parentId: jobsTable.recurrenceParentId,
        earliest: min(jobsTable.scheduledAt),
      })
      .from(jobsTable)
      .where(
        and(
          eq(jobsTable.tenantId, tenantId),
          inArray(jobsTable.recurrenceParentId, rootIds),
          eq(jobsTable.status, "scheduled"),
          gt(jobsTable.scheduledAt, now),
        )
      )
      .groupBy(jobsTable.recurrenceParentId);
    for (const row of rows) {
      if (row.parentId != null && row.earliest != null) {
        upcomingByRoot.set(row.parentId, new Date(row.earliest));
      }
    }
  }

  // For each root: use persisted upcoming child first, fall back to computed
  const series = roots.map(r => {
    const rule = r.job.recurrenceRule as unknown as RecurrenceRule | null;
    let nextScheduledAt: string | null = null;

    const persisted = upcomingByRoot.get(r.job.id);
    if (persisted) {
      nextScheduledAt = persisted.toISOString();
    } else if (rule && !r.job.isRecurrencePaused && r.job.status !== "cancelled") {
      // Fall back to computed next ungenerated date
      const next = nthOccurrenceAfterRoot(rule, r.job.scheduledAt, r.job.recurrenceCount ?? 0);
      nextScheduledAt = next ? next.toISOString() : null;
    }

    return {
      id: r.job.id,
      title: r.job.title,
      status: r.job.status,
      recurrenceRule: rule,
      recurrenceDescription: rule ? describeRule(rule) : "",
      isRecurrencePaused: r.job.isRecurrencePaused,
      nextScheduledAt,
      completedCount: r.job.recurrenceCount ?? 0,
      customerName: r.customerName ?? null,
      assigneeName: r.assigneeName ?? null,
      crewName: r.crewName ?? null,
    };
  });

  res.json(series);
});

router.post("/jobs", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const { title, description, status, priority, customerId, propertyId, assigneeId, crewId, scheduledAt, estimatedDuration, blueprintId, recurrenceRule } = req.body;

  if (!title || !scheduledAt) {
    res.status(400).json({ error: "title and scheduledAt are required" });
    return;
  }

  const [job] = await db.insert(jobsTable).values({
    tenantId,
    title,
    description: description ?? null,
    status: status ?? "scheduled",
    priority: priority ?? "normal",
    customerId: customerId ? parseInt(customerId, 10) : null,
    propertyId: propertyId ? parseInt(propertyId, 10) : null,
    assigneeId: assigneeId ? parseInt(assigneeId, 10) : null,
    crewId: crewId ? parseInt(crewId, 10) : null,
    blueprintId: blueprintId ? parseInt(blueprintId, 10) : null,
    scheduledAt: new Date(scheduledAt),
    estimatedDuration: estimatedDuration ?? null,
    recurrenceRule: recurrenceRule ?? null,
  }).returning();

  await db.insert(activityLogTable).values({ tenantId, userId, type: "job_created", message: `Job "${title}" created`, entityId: job.id });

  res.status(201).json(formatJob(job));
});

router.get("/jobs/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const [row] = await db
    .select({ job: jobsTable, customerName: customersTable.name, assigneeName: usersTable.name, propertyAddress: propertiesTable.address, crewName: crewsTable.name })
    .from(jobsTable)
    .leftJoin(customersTable, eq(jobsTable.customerId, customersTable.id))
    .leftJoin(usersTable, eq(jobsTable.assigneeId, usersTable.id))
    .leftJoin(propertiesTable, eq(jobsTable.propertyId, propertiesTable.id))
    .leftJoin(crewsTable, eq(jobsTable.crewId, crewsTable.id))
    .where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)));

  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatJob(row.job, { customerName: row.customerName, assigneeName: row.assigneeName, propertyAddress: row.propertyAddress, crewName: row.crewName }));
});

router.patch("/jobs/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const { title, description, status, priority, assigneeId, crewId, scheduledAt, estimatedDuration, recurrenceRule, editScope } = req.body;

  // Fetch current job to check if it's a recurring instance
  const [currentJob] = await db.select().from(jobsTable).where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)));
  if (!currentJob) { res.status(404).json({ error: "Not found" }); return; }

  const baseUpdate: Partial<typeof jobsTable.$inferInsert> = {
    ...(title !== undefined && { title }),
    ...(description !== undefined && { description }),
    ...(status !== undefined && { status }),
    ...(priority !== undefined && { priority }),
    ...(assigneeId !== undefined && { assigneeId: assigneeId ? parseInt(assigneeId, 10) : null }),
    ...(crewId !== undefined && { crewId: crewId ? parseInt(crewId, 10) : null }),
    ...(scheduledAt !== undefined && { scheduledAt: new Date(scheduledAt) }),
    ...(estimatedDuration !== undefined && { estimatedDuration }),
  };

  // Handle "forward" or "all" scope: update the root series template
  if (editScope === "all" || editScope === "forward") {
    const rootId = currentJob.recurrenceParentId ?? id;

    if (recurrenceRule !== undefined) {
      baseUpdate.recurrenceRule = recurrenceRule;
    }

    // Update root
    await db.update(jobsTable)
      .set(baseUpdate)
      .where(and(eq(jobsTable.id, rootId), eq(jobsTable.tenantId, tenantId)));

    if (editScope === "forward") {
      // Update all future instances (status = scheduled, same series)
      const currentIndex = currentJob.recurrenceIndex ?? 0;
      await db.update(jobsTable)
        .set(baseUpdate)
        .where(
          and(
            eq(jobsTable.recurrenceParentId, rootId),
            eq(jobsTable.tenantId, tenantId),
            eq(jobsTable.status, "scheduled"),
            sql`${jobsTable.recurrenceIndex} >= ${currentIndex}`,
          )
        );
    } else {
      // All: update every instance
      await db.update(jobsTable)
        .set(baseUpdate)
        .where(
          and(
            eq(jobsTable.recurrenceParentId, rootId),
            eq(jobsTable.tenantId, tenantId),
          )
        );
    }

    const [updated] = await db.select().from(jobsTable).where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)));
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }
    res.json(formatJob(updated));
    return;
  }

  // Default: update only this occurrence
  if (recurrenceRule !== undefined && !currentJob.recurrenceParentId) {
    baseUpdate.recurrenceRule = recurrenceRule;
  }

  const [updated] = await db.update(jobsTable)
    .set(baseUpdate)
    .where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatJob(updated));
});

router.delete("/jobs/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  await db.delete(jobsTable).where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)));
  res.sendStatus(204);
});

router.post("/jobs/:id/complete", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const [updated] = await db.update(jobsTable)
    .set({ status: "completed", completedAt: new Date() })
    .where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  await db.insert(activityLogTable).values({ tenantId, userId, type: "job_completed", message: `Job "${updated.title}" completed`, entityId: id });

  // Auto-invoice on completion if enabled for this customer
  if (updated.customerId) {
    const [customer] = await db
      .select({ autoInvoiceOnCompletion: customersTable.autoInvoiceOnCompletion, email: customersTable.email })
      .from(customersTable)
      .where(eq(customersTable.id, updated.customerId));

    if (customer?.autoInvoiceOnCompletion && !updated.invoiceId) {
      try {
        const [tenant] = await db.select({ taxRate: tenantsTable.taxRate }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
        const taxRate = tenant?.taxRate ?? 0;
        const lineItems = (updated.lineItems as unknown[]) ?? [];
        const subtotal = updated.totalAmount ?? 0;
        const tax = subtotal * (taxRate / 100);
        const total = subtotal + tax;
        const invoiceNum = `INV-${Date.now().toString().slice(-8)}`;

        let invoiceId!: number;
        await db.transaction(async tx => {
          const [invoice] = await tx.insert(invoicesTable).values({
            tenantId,
            invoiceNumber: invoiceNum,
            customerId: updated.customerId!,
            jobId: updated.id,
            status: customer.email ? "sent" : "draft",
            subtotal,
            tax,
            total,
            lineItems,
          }).returning();
          invoiceId = invoice.id;
          await tx.update(jobsTable).set({ invoiceId: invoice.id }).where(eq(jobsTable.id, id));
        });

        await db.insert(activityLogTable).values({ tenantId, userId, type: "invoice_sent", message: `Auto-invoice ${invoiceNum} created on job completion`, entityId: invoiceId });

        if (customer.email) {
          await enqueueInvoiceEmail(tenantId, invoiceId);
        }
      } catch (err) {
        // Non-fatal: log but don't fail the job completion response
        console.error("Auto-invoice creation failed:", err);
      }
    }
  }

  res.json(formatJob(updated));
});

// ── Skip next occurrence ─────────────────────────────────────────────────────
router.post("/jobs/:id/skip-next", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);

  // Resolve root
  const [job] = await db.select().from(jobsTable).where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)));
  if (!job) { res.status(404).json({ error: "Not found" }); return; }
  const rootId = job.recurrenceParentId ?? job.id;

  // Skip semantics (exactly one occurrence, regardless of pre-generation state):
  //
  //   Case A — scheduler has already materialized the next child:
  //     recurrenceCount was already incremented when the child was created.
  //     Cancel that child only. Do NOT increment count again (would double-skip).
  //
  //   Case B — no child materialized yet:
  //     Increment recurrenceCount so the scheduler skips the next computed slot.
  await db.transaction(async tx => {
    // Find the earliest upcoming scheduled child (already materialized by the scheduler)
    const [nextChild] = await tx
      .select({ id: jobsTable.id })
      .from(jobsTable)
      .where(
        and(
          eq(jobsTable.recurrenceParentId, rootId),
          eq(jobsTable.tenantId, tenantId),
          eq(jobsTable.status, "scheduled"),
          gt(jobsTable.scheduledAt, new Date()),
        )
      )
      .orderBy(asc(jobsTable.scheduledAt))
      .limit(1);

    if (nextChild) {
      // Case A: cancel the materialized next occurrence; count already reflects this slot
      await tx.update(jobsTable)
        .set({ status: "cancelled" })
        .where(and(eq(jobsTable.id, nextChild.id), eq(jobsTable.tenantId, tenantId)));
    } else {
      // Case B: no child yet — advance count so the scheduler bypasses the next computed date
      await tx.update(jobsTable)
        .set({ recurrenceCount: sql`${jobsTable.recurrenceCount} + 1` })
        .where(and(eq(jobsTable.id, rootId), eq(jobsTable.tenantId, tenantId)));
    }
  });

  const [updated] = await db.select().from(jobsTable).where(and(eq(jobsTable.id, rootId), eq(jobsTable.tenantId, tenantId)));
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatJob(updated));
});

// ── Pause / resume series ────────────────────────────────────────────────────
router.patch("/jobs/:id/pause-series", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  const { paused } = req.body as { paused?: boolean };

  if (typeof paused !== "boolean") {
    res.status(400).json({ error: "paused (boolean) is required" });
    return;
  }

  const [job] = await db.select().from(jobsTable).where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)));
  if (!job) { res.status(404).json({ error: "Not found" }); return; }
  const rootId = job.recurrenceParentId ?? job.id;

  const [updated] = await db.update(jobsTable)
    .set({ isRecurrencePaused: paused })
    .where(and(eq(jobsTable.id, rootId), eq(jobsTable.tenantId, tenantId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatJob(updated));
});

// ── Cancel series ────────────────────────────────────────────────────────────
router.delete("/jobs/:id/cancel-series", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  const scope = (req.query.scope as string) ?? "forward";

  const [job] = await db.select().from(jobsTable).where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)));
  if (!job) { res.status(404).json({ error: "Not found" }); return; }
  const rootId = job.recurrenceParentId ?? job.id;

  if (scope === "all") {
    // Cancel root + all children
    await db.update(jobsTable)
      .set({ status: "cancelled" })
      .where(and(eq(jobsTable.id, rootId), eq(jobsTable.tenantId, tenantId)));
    await db.update(jobsTable)
      .set({ status: "cancelled" })
      .where(and(eq(jobsTable.recurrenceParentId, rootId), eq(jobsTable.tenantId, tenantId)));
  } else {
    // Cancel only future (scheduled) instances and pause the root
    await db.update(jobsTable)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(jobsTable.recurrenceParentId, rootId),
          eq(jobsTable.tenantId, tenantId),
          eq(jobsTable.status, "scheduled"),
        )
      );
    await db.update(jobsTable)
      .set({ isRecurrencePaused: true })
      .where(and(eq(jobsTable.id, rootId), eq(jobsTable.tenantId, tenantId)));
  }

  res.sendStatus(204);
});

// ── Parts management on jobs ─────────────────────────────────────────────────

interface JobPart {
  inventoryItemId: number;
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

router.get("/jobs/:id/parts", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);

  const [job] = await db.select({ jobParts: jobsTable.jobParts }).from(jobsTable)
    .where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)));
  if (!job) { res.status(404).json({ error: "Not found" }); return; }

  res.json((job.jobParts as JobPart[]) ?? []);
});

// Add or update a part on a job (upserts by inventoryItemId)
router.post("/jobs/:id/parts", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  const { inventoryItemId, quantity } = req.body;

  if (!inventoryItemId || !quantity || quantity <= 0) {
    res.status(400).json({ error: "inventoryItemId and positive quantity are required" });
    return;
  }

  // Fetch the job and the inventory item
  const [[job], [item]] = await Promise.all([
    db.select().from(jobsTable).where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId))),
    db.select().from(inventoryItemsTable).where(and(eq(inventoryItemsTable.id, inventoryItemId), eq(inventoryItemsTable.tenantId, tenantId))),
  ]);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  if (!item) { res.status(404).json({ error: "Inventory item not found" }); return; }

  const existingParts = (job.jobParts as JobPart[]) ?? [];
  const sellPrice = item.markedUpPrice;
  const newPart: JobPart = {
    inventoryItemId: item.id,
    name: item.name,
    quantity,
    unitPrice: sellPrice,
    total: sellPrice * quantity,
  };

  // Upsert: replace if same item exists
  const updatedParts = [
    ...existingParts.filter(p => p.inventoryItemId !== inventoryItemId),
    newPart,
  ];

  const [updated] = await db.update(jobsTable)
    .set({ jobParts: updatedParts })
    .where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)))
    .returning();

  res.json(formatJob(updated));
});

// Remove a part from a job
router.delete("/jobs/:id/parts/:inventoryItemId", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  const inventoryItemId = parseInt(req.params.inventoryItemId, 10);

  const [job] = await db.select().from(jobsTable).where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)));
  if (!job) { res.status(404).json({ error: "Not found" }); return; }

  const existingParts = (job.jobParts as JobPart[]) ?? [];
  const updatedParts = existingParts.filter(p => p.inventoryItemId !== inventoryItemId);

  const [updated] = await db.update(jobsTable)
    .set({ jobParts: updatedParts })
    .where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)))
    .returning();

  res.json(formatJob(updated));
});

// ---------------------------------------------------------------------------
// GET /jobs/:id/alerts — list customer alerts on a job
// ---------------------------------------------------------------------------
router.get("/jobs/:id/alerts", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);

  const rows = await db
    .select()
    .from(customerAlertsTable)
    .where(and(eq(customerAlertsTable.jobId, id), eq(customerAlertsTable.tenantId, tenantId)))
    .orderBy(desc(customerAlertsTable.createdAt));

  res.json(rows.map(a => ({
    id: a.id,
    jobId: a.jobId,
    tenantId: a.tenantId,
    customerId: a.customerId ?? null,
    type: a.type,
    message: a.message,
    status: a.status,
    customerResponse: a.customerResponse ?? null,
    photoUrl: a.photoUrl ?? null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  })));
});

// ---------------------------------------------------------------------------
// POST /jobs/:id/alerts — log a customer alert on a job
// ---------------------------------------------------------------------------
router.post("/jobs/:id/alerts", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  const { type, message, photoUrl } = req.body as { type?: string; message?: string; photoUrl?: string };

  if (!type || !message) {
    res.status(400).json({ error: "type and message required" });
    return;
  }
  if (!["issue", "upsell"].includes(type)) {
    res.status(400).json({ error: "type must be issue or upsell" });
    return;
  }

  const [job] = await db.select().from(jobsTable).where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId))).limit(1);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const [alert] = await db.insert(customerAlertsTable).values({
    tenantId,
    jobId: id,
    customerId: job.customerId ?? null,
    type,
    message,
    status: "pending",
    photoUrl: photoUrl ?? null,
  }).returning();

  res.status(201).json({
    id: alert.id,
    jobId: alert.jobId,
    tenantId: alert.tenantId,
    customerId: alert.customerId ?? null,
    type: alert.type,
    message: alert.message,
    status: alert.status,
    customerResponse: alert.customerResponse ?? null,
    photoUrl: alert.photoUrl ?? null,
    createdAt: alert.createdAt.toISOString(),
    updatedAt: alert.updatedAt.toISOString(),
  });
});

export default router;
