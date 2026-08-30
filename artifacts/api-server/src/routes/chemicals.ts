import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, chemicalProductsTable, chemicalMixturesTable, chemicalMixtureItemsTable, chemicalApplicationsTable, jobsTable, propertiesTable, tenantsTable, usersTable } from "@workspace/db";
import { eq, and, gte, lte, desc, inArray } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { normalizeChemicalRecordRequirements, parseStrictChemicalAppliedAt, validateChemicalRecordRequirements, validateSuppliedChemicalApplicationFields } from "../lib/chemicalRequirements";

const router: IRouter = Router();

// ─── Auth helpers ──────────────────────────────────────────────────────────────

async function getUserRole(tenantId: number, userId: number): Promise<string | null> {
  const [user] = await db
    .select({ role: usersTable.role })
    .from(usersTable)
    .where(and(eq(usersTable.id, userId), eq(usersTable.tenantId, tenantId)));
  return user?.role ?? null;
}

/** Only admin/office may mutate products and mixtures; technicians can only add applications */
async function requireOfficeRole(req: Request, res: Response, next: NextFunction): Promise<void> {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const role = await getUserRole(tenantId, userId);
  if (!role || role === "technician") {
    res.status(403).json({ error: "Admin or office role required" });
    return;
  }
  next();
}

// ─── Rate calculation helpers ─────────────────────────────────────────────────

/**
 * Compute application rate per acre and per 1000 sqft from volume applied and property size.
 * propertySizeSqft = null means rates cannot be calculated.
 */
function computeRates(volumeApplied: number, propertySizeSqft: number | null) {
  if (!propertySizeSqft || propertySizeSqft <= 0) return { ratePerAcre: null, ratePer1000Sqft: null };
  const ratePer1000Sqft = (volumeApplied / propertySizeSqft) * 1000;
  const ratePerAcre = ratePer1000Sqft * 43.56;
  return { ratePerAcre: Math.round(ratePerAcre * 1000) / 1000, ratePer1000Sqft: Math.round(ratePer1000Sqft * 1000) / 1000 };
}

// ─── Chemical Products CRUD ────────────────────────────────────────────────────

router.get("/chemical-products", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rows = await db
    .select()
    .from(chemicalProductsTable)
    .where(eq(chemicalProductsTable.tenantId, tenantId))
    .orderBy(chemicalProductsTable.name);
  res.json(rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() })));
});

router.post("/chemical-products", requireOfficeRole, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { name, epaRegNumber, activeIngredients, signalWord, rei, phi, labelSdsUrl, unit, rainfastHours } = req.body;
  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  const [row] = await db.insert(chemicalProductsTable).values({
    tenantId,
    name,
    epaRegNumber: epaRegNumber ?? null,
    activeIngredients: activeIngredients ?? null,
    signalWord: signalWord ?? null,
    rei: rei ? parseInt(rei, 10) : null,
    phi: phi ? parseInt(phi, 10) : null,
    labelSdsUrl: labelSdsUrl ?? null,
    unit: unit ?? "oz",
    rainfastHours: rainfastHours != null ? parseFloat(rainfastHours) : null,
  }).returning();
  res.status(201).json({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });
});

router.patch("/chemical-products/:id", requireOfficeRole, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { name, epaRegNumber, activeIngredients, signalWord, rei, phi, labelSdsUrl, unit, isActive, rainfastHours } = req.body;
  const [row] = await db.update(chemicalProductsTable).set({
    ...(name && { name }),
    ...(epaRegNumber !== undefined && { epaRegNumber }),
    ...(activeIngredients !== undefined && { activeIngredients }),
    ...(signalWord !== undefined && { signalWord }),
    ...(rei !== undefined && { rei: rei ? parseInt(rei, 10) : null }),
    ...(phi !== undefined && { phi: phi ? parseInt(phi, 10) : null }),
    ...(labelSdsUrl !== undefined && { labelSdsUrl }),
    ...(unit && { unit }),
    ...(isActive !== undefined && { isActive }),
    ...(rainfastHours !== undefined && { rainfastHours: rainfastHours != null ? parseFloat(rainfastHours) : null }),
  }).where(and(eq(chemicalProductsTable.id, id), eq(chemicalProductsTable.tenantId, tenantId))).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });
});

router.delete("/chemical-products/:id", requireOfficeRole, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  await db.delete(chemicalProductsTable).where(and(eq(chemicalProductsTable.id, id), eq(chemicalProductsTable.tenantId, tenantId)));
  res.sendStatus(204);
});

// ─── Chemical Mixtures CRUD ────────────────────────────────────────────────────

router.get("/chemical-mixtures", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const mixtures = await db
    .select()
    .from(chemicalMixturesTable)
    .where(eq(chemicalMixturesTable.tenantId, tenantId))
    .orderBy(chemicalMixturesTable.name);

  // Fetch all items for this tenant's mixtures in one query, scoped by mixture ownership
  const mixtureIds = mixtures.map(m => m.id);
  const items = mixtureIds.length
    ? await db
        .select({ item: chemicalMixtureItemsTable, productName: chemicalProductsTable.name, productUnit: chemicalProductsTable.unit, activeIngredients: chemicalProductsTable.activeIngredients })
        .from(chemicalMixtureItemsTable)
        .leftJoin(chemicalProductsTable, and(
          eq(chemicalMixtureItemsTable.productId, chemicalProductsTable.id),
          eq(chemicalProductsTable.tenantId, tenantId),
        ))
        .where(inArray(chemicalMixtureItemsTable.mixtureId, mixtureIds))
    : [];

  const itemsByMixture = items.reduce<Record<number, typeof items>>((acc, r) => {
    const mid = r.item.mixtureId;
    if (!acc[mid]) acc[mid] = [];
    acc[mid].push(r);
    return acc;
  }, {});

  res.json(mixtures.map(m => ({
    ...m,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
    items: (itemsByMixture[m.id] ?? []).map(r => ({
      id: r.item.id,
      mixtureId: r.item.mixtureId,
      productId: r.item.productId,
      productName: r.productName ?? null,
      productUnit: r.productUnit ?? null,
      activeIngredients: r.activeIngredients ?? null,
      ratioAmount: r.item.ratioAmount,
      ratioUnit: r.item.ratioUnit,
    })),
  })));
});

router.post("/chemical-mixtures", requireOfficeRole, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { name, description, items } = req.body;
  if (!name) { res.status(400).json({ error: "name is required" }); return; }

  // Validate every productId belongs to this tenant before creating the mixture
  if (Array.isArray(items) && items.length > 0) {
    const requestedProductIds = items.map((i: { productId: number }) => i.productId);
    const ownedProducts = await db
      .select({ id: chemicalProductsTable.id })
      .from(chemicalProductsTable)
      .where(and(inArray(chemicalProductsTable.id, requestedProductIds), eq(chemicalProductsTable.tenantId, tenantId)));
    if (ownedProducts.length !== requestedProductIds.length) {
      res.status(403).json({ error: "One or more products do not belong to your account" });
      return;
    }
  }

  const [mixture] = await db.insert(chemicalMixturesTable).values({ tenantId, name, description: description ?? null }).returning();

  if (Array.isArray(items) && items.length > 0) {
    await db.insert(chemicalMixtureItemsTable).values(
      items.map((item: { productId: number; ratioAmount: number; ratioUnit?: string }) => ({
        mixtureId: mixture.id,
        productId: item.productId,
        ratioAmount: item.ratioAmount,
        ratioUnit: item.ratioUnit ?? "oz",
      }))
    );
  }

  // Return with items (join scoped to tenant's products)
  const savedItems = await db
    .select({ item: chemicalMixtureItemsTable, productName: chemicalProductsTable.name, activeIngredients: chemicalProductsTable.activeIngredients })
    .from(chemicalMixtureItemsTable)
    .leftJoin(chemicalProductsTable, and(
      eq(chemicalMixtureItemsTable.productId, chemicalProductsTable.id),
      eq(chemicalProductsTable.tenantId, tenantId),
    ))
    .where(eq(chemicalMixtureItemsTable.mixtureId, mixture.id));

  res.status(201).json({
    ...mixture,
    createdAt: mixture.createdAt.toISOString(),
    updatedAt: mixture.updatedAt.toISOString(),
    items: savedItems.map(r => ({
      id: r.item.id,
      mixtureId: r.item.mixtureId,
      productId: r.item.productId,
      productName: r.productName ?? null,
      activeIngredients: r.activeIngredients ?? null,
      ratioAmount: r.item.ratioAmount,
      ratioUnit: r.item.ratioUnit,
    })),
  });
});

router.patch("/chemical-mixtures/:id", requireOfficeRole, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { name, description, isActive, items } = req.body;

  const [mixture] = await db.update(chemicalMixturesTable).set({
    ...(name && { name }),
    ...(description !== undefined && { description }),
    ...(isActive !== undefined && { isActive }),
  }).where(and(eq(chemicalMixturesTable.id, id), eq(chemicalMixturesTable.tenantId, tenantId))).returning();
  if (!mixture) { res.status(404).json({ error: "Not found" }); return; }

  if (Array.isArray(items)) {
    // Validate every productId belongs to this tenant before replacing items
    if (items.length > 0) {
      const requestedProductIds = items.map((i: { productId: number }) => i.productId);
      const ownedProducts = await db
        .select({ id: chemicalProductsTable.id })
        .from(chemicalProductsTable)
        .where(and(inArray(chemicalProductsTable.id, requestedProductIds), eq(chemicalProductsTable.tenantId, tenantId)));
      if (ownedProducts.length !== requestedProductIds.length) {
        res.status(403).json({ error: "One or more products do not belong to your account" });
        return;
      }
    }
    // Replace all items
    await db.delete(chemicalMixtureItemsTable).where(eq(chemicalMixtureItemsTable.mixtureId, id));
    if (items.length > 0) {
      await db.insert(chemicalMixtureItemsTable).values(
        items.map((item: { productId: number; ratioAmount: number; ratioUnit?: string }) => ({
          mixtureId: id,
          productId: item.productId,
          ratioAmount: item.ratioAmount,
          ratioUnit: item.ratioUnit ?? "oz",
        }))
      );
    }
  }

  // Return with items (join scoped to tenant's products)
  const savedItems = await db
    .select({ item: chemicalMixtureItemsTable, productName: chemicalProductsTable.name, activeIngredients: chemicalProductsTable.activeIngredients })
    .from(chemicalMixtureItemsTable)
    .leftJoin(chemicalProductsTable, and(
      eq(chemicalMixtureItemsTable.productId, chemicalProductsTable.id),
      eq(chemicalProductsTable.tenantId, tenantId),
    ))
    .where(eq(chemicalMixtureItemsTable.mixtureId, id));

  res.json({
    ...mixture,
    createdAt: mixture.createdAt.toISOString(),
    updatedAt: mixture.updatedAt.toISOString(),
    items: savedItems.map(r => ({
      id: r.item.id,
      mixtureId: r.item.mixtureId,
      productId: r.item.productId,
      productName: r.productName ?? null,
      activeIngredients: r.activeIngredients ?? null,
      ratioAmount: r.item.ratioAmount,
      ratioUnit: r.item.ratioUnit,
    })),
  });
});

router.delete("/chemical-mixtures/:id", requireOfficeRole, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);

  // Verify ownership before touching any rows
  const [mixture] = await db.select({ id: chemicalMixturesTable.id })
    .from(chemicalMixturesTable)
    .where(and(eq(chemicalMixturesTable.id, id), eq(chemicalMixturesTable.tenantId, tenantId)));
  if (!mixture) { res.status(404).json({ error: "Not found" }); return; }

  // Safe to delete — ownership confirmed
  await db.delete(chemicalMixtureItemsTable).where(eq(chemicalMixtureItemsTable.mixtureId, id));
  await db.delete(chemicalMixturesTable).where(and(eq(chemicalMixturesTable.id, id), eq(chemicalMixturesTable.tenantId, tenantId)));
  res.sendStatus(204);
});

// ─── Chemical Applications ─────────────────────────────────────────────────────

router.get("/chemical-applications", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { startDate, endDate, propertyId, applicatorId, jobId } = req.query as Record<string, string>;

  const rows = await db
    .select({
      app: chemicalApplicationsTable,
      jobTitle: jobsTable.title,
      propertyAddress: propertiesTable.address,
    })
    .from(chemicalApplicationsTable)
    .leftJoin(jobsTable, eq(chemicalApplicationsTable.jobId, jobsTable.id))
    .leftJoin(propertiesTable, eq(jobsTable.propertyId, propertiesTable.id))
    .where(and(
      eq(chemicalApplicationsTable.tenantId, tenantId),
      startDate ? gte(chemicalApplicationsTable.appliedAt, new Date(startDate)) : undefined,
      endDate ? lte(chemicalApplicationsTable.appliedAt, new Date(endDate)) : undefined,
      propertyId ? eq(jobsTable.propertyId, parseInt(propertyId, 10)) : undefined,
      applicatorId ? eq(chemicalApplicationsTable.applicatorId, parseInt(applicatorId, 10)) : undefined,
      jobId ? eq(chemicalApplicationsTable.jobId, parseInt(jobId, 10)) : undefined,
    ) as ReturnType<typeof and>)
    .orderBy(desc(chemicalApplicationsTable.appliedAt));

  res.json(rows.map(r => ({
    ...r.app,
    appliedAt: r.app.appliedAt.toISOString(),
    createdAt: r.app.createdAt.toISOString(),
    updatedAt: r.app.updatedAt.toISOString(),
    breakdown: (r.app.breakdown as unknown[]) ?? [],
    jobTitle: r.jobTitle ?? null,
    propertyAddress: r.propertyAddress ?? null,
  })));
});

router.get("/jobs/:id/chemical-applications", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const jobId = parseInt(req.params.id, 10);

  // Verify job belongs to tenant
  const [job] = await db.select().from(jobsTable).where(and(eq(jobsTable.id, jobId), eq(jobsTable.tenantId, tenantId)));
  if (!job) { res.status(404).json({ error: "Not found" }); return; }

  const rows = await db
    .select()
    .from(chemicalApplicationsTable)
    .where(and(eq(chemicalApplicationsTable.jobId, jobId), eq(chemicalApplicationsTable.tenantId, tenantId)))
    .orderBy(desc(chemicalApplicationsTable.appliedAt));

  res.json(rows.map(r => ({
    ...r,
    appliedAt: r.appliedAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    breakdown: (r.breakdown as unknown[]) ?? [],
  })));
});

router.post("/jobs/:id/chemical-applications", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const jobId = parseInt(req.params.id, 10);

  // Verify job belongs to tenant and fetch property size
  const [jobRow] = await db
    .select({ job: jobsTable, size: propertiesTable.size, sizeUnit: propertiesTable.sizeUnit })
    .from(jobsTable)
    .leftJoin(propertiesTable, eq(jobsTable.propertyId, propertiesTable.id))
    .where(and(eq(jobsTable.id, jobId), eq(jobsTable.tenantId, tenantId)));
  if (!jobRow) { res.status(404).json({ error: "Job not found" }); return; }

  const {
    mixtureId, productId, volumeApplied, volumeUnit,
    treatedArea, areaUnit, treatedZoneName,
    targetPest, applicationMethod, windSpeed, windDirection, temperature,
    appliedAt, applicatorName, applicatorLicenseNumber, notes,
  } = req.body;

  const parsedVolume = Number(volumeApplied);
  const hasMixture = mixtureId !== undefined && mixtureId !== null && mixtureId !== "";
  const hasProduct = productId !== undefined && productId !== null && productId !== "";
  const parsedMixtureId = hasMixture && /^\d+$/.test(String(mixtureId)) ? Number(mixtureId) : NaN;
  const parsedProductId = hasProduct && /^\d+$/.test(String(productId)) ? Number(productId) : NaN;
  const parsedAppliedAt = parseStrictChemicalAppliedAt(appliedAt);

  if (!Number.isFinite(parsedVolume) || parsedVolume <= 0) {
    res.status(400).json({ error: "Volume applied must be a positive number", fields: { volumeApplied: "Enter a positive amount" } });
    return;
  }
  if (hasMixture && (!Number.isInteger(parsedMixtureId) || parsedMixtureId <= 0)) {
    res.status(400).json({ error: "Mixture must be a positive integer", fields: { productOrMixture: "Select a valid mixture" } });
    return;
  }
  if (hasProduct && (!Number.isInteger(parsedProductId) || parsedProductId <= 0)) {
    res.status(400).json({ error: "Product must be a positive integer", fields: { productOrMixture: "Select a valid product" } });
    return;
  }
  if (!hasMixture && !hasProduct || hasMixture && hasProduct) {
    res.status(400).json({ error: "Select exactly one mixture or product", fields: { productOrMixture: "Select exactly one mixture or product" } });
    return;
  }
  if (typeof volumeUnit !== "string" || !volumeUnit.trim()) {
    res.status(400).json({ error: "Volume unit is required", fields: { volumeUnit: "Select a volume unit" } });
    return;
  }
  if (!parsedAppliedAt || Number.isNaN(parsedAppliedAt.getTime())) {
    res.status(400).json({ error: "Applied date and time are required", fields: { appliedAt: "Enter a valid application date and time" } });
    return;
  }
  const suppliedFieldErrors = validateSuppliedChemicalApplicationFields(req.body);
  if (Object.keys(suppliedFieldErrors).length > 0) {
    res.status(400).json({ error: "Correct the invalid chemical record fields", fields: suppliedFieldErrors });
    return;
  }

  // Determine applicator name
  let resolvedApplicatorName = applicatorName ?? null;
  if (!resolvedApplicatorName) {
    const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(and(eq(usersTable.id, userId), eq(usersTable.tenantId, tenantId)));
    resolvedApplicatorName = u?.name ?? null;
  }

  const [tenant] = await db
    .select({ chemicalRecordRequirements: tenantsTable.chemicalRecordRequirements })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId));
  const requirements = normalizeChemicalRecordRequirements(tenant?.chemicalRecordRequirements);
  const requirementErrors = validateChemicalRecordRequirements(
    { ...req.body, applicatorName: resolvedApplicatorName },
    requirements,
  );
  if (Object.keys(requirementErrors).length > 0) {
    res.status(400).json({ error: "Complete all required chemical record fields", fields: requirementErrors });
    return;
  }

  // Compute area in sqft for rate calculation.
  // Prefer the technician-entered treatedArea over the property's stored size.
  let propertySizeSqft: number | null = null;
  if (treatedArea && parseFloat(treatedArea) > 0) {
    const unit = areaUnit ?? "sqft";
    propertySizeSqft = unit === "acres" ? parseFloat(treatedArea) * 43560 : parseFloat(treatedArea);
  } else if (jobRow.size) {
    propertySizeSqft = jobRow.sizeUnit === "acres" ? jobRow.size * 43560 : jobRow.size;
  }

  // Build breakdown
  let breakdown: object[] = [];
  let mixtureName: string | null = null;
  let productName: string | null = null;

  if (mixtureId) {
    const [mixture] = await db.select().from(chemicalMixturesTable)
      .where(and(eq(chemicalMixturesTable.id, parsedMixtureId), eq(chemicalMixturesTable.tenantId, tenantId)));
    if (!mixture) { res.status(404).json({ error: "Mixture not found" }); return; }
    mixtureName = mixture.name;

    const items = await db
      .select({ item: chemicalMixtureItemsTable, product: chemicalProductsTable })
      .from(chemicalMixtureItemsTable)
      .leftJoin(chemicalProductsTable, and(
        eq(chemicalMixtureItemsTable.productId, chemicalProductsTable.id),
        eq(chemicalProductsTable.tenantId, tenantId),
      ))
      .where(eq(chemicalMixtureItemsTable.mixtureId, parsedMixtureId));

    breakdown = items.map(({ item, product }) => {
      const amountApplied = item.ratioAmount * parsedVolume; // ratio per unit × total units
      const rates = computeRates(amountApplied, propertySizeSqft);
      return {
        productId: item.productId,
        productName: product?.name ?? null,
        activeIngredients: product?.activeIngredients ?? null,
        epaRegNumber: product?.epaRegNumber ?? null,
        amountApplied,
        unit: item.ratioUnit,
        ratePerAcre: rates.ratePerAcre,
        ratePer1000Sqft: rates.ratePer1000Sqft,
      };
    });
  } else if (productId) {
    const [product] = await db.select().from(chemicalProductsTable)
      .where(and(eq(chemicalProductsTable.id, parsedProductId), eq(chemicalProductsTable.tenantId, tenantId)));
    if (!product) { res.status(404).json({ error: "Product not found" }); return; }
    productName = product.name;

    const rates = computeRates(parsedVolume, propertySizeSqft);
    breakdown = [{
      productId: product.id,
      productName: product.name,
      activeIngredients: product.activeIngredients ?? null,
      epaRegNumber: product.epaRegNumber ?? null,
      amountApplied: parsedVolume,
      unit: volumeUnit ?? "gal",
      ratePerAcre: rates.ratePerAcre,
      ratePer1000Sqft: rates.ratePer1000Sqft,
    }];
  }

  const [app] = await db.insert(chemicalApplicationsTable).values({
    tenantId,
    jobId,
    applicatorId: userId,
    applicatorName: typeof resolvedApplicatorName === "string" ? resolvedApplicatorName.trim() : null,
    applicatorLicenseNumber: typeof applicatorLicenseNumber === "string" ? applicatorLicenseNumber.trim() : null,
    mixtureId: hasMixture ? parsedMixtureId : null,
    productId: hasProduct ? parsedProductId : null,
    mixtureName,
    productName,
    volumeApplied: parsedVolume,
    volumeUnit: volumeUnit.trim(),
    treatedArea: treatedArea ? parseFloat(treatedArea) : null,
    areaUnit: treatedArea ? (typeof areaUnit === "string" ? areaUnit.trim() : "sqft") : null,
    treatedZoneName: typeof treatedZoneName === "string" ? treatedZoneName.trim() : null,
    targetPest: typeof targetPest === "string" ? targetPest.trim() : null,
    applicationMethod: typeof applicationMethod === "string" ? applicationMethod.trim() : null,
    windSpeed: windSpeed ? parseFloat(windSpeed) : null,
    windDirection: typeof windDirection === "string" ? windDirection.trim() : null,
    temperature: temperature ? parseFloat(temperature) : null,
    appliedAt: parsedAppliedAt,
    breakdown,
    notes: typeof notes === "string" ? notes.trim() : null,
  }).returning();

  res.status(201).json({
    ...app,
    appliedAt: app.appliedAt.toISOString(),
    createdAt: app.createdAt.toISOString(),
    updatedAt: app.updatedAt.toISOString(),
    breakdown: (app.breakdown as unknown[]) ?? [],
  });
});

// ─── Chemical Applications CSV Export ─────────────────────────────────────────

router.get("/chemical-applications/export", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { startDate, endDate, applicatorId } = req.query as Record<string, string>;

  const rows = await db
    .select({
      app: chemicalApplicationsTable,
      jobTitle: jobsTable.title,
      propertyAddress: propertiesTable.address,
    })
    .from(chemicalApplicationsTable)
    .leftJoin(jobsTable, eq(chemicalApplicationsTable.jobId, jobsTable.id))
    .leftJoin(propertiesTable, eq(jobsTable.propertyId, propertiesTable.id))
    .where(and(
      eq(chemicalApplicationsTable.tenantId, tenantId),
      startDate ? gte(chemicalApplicationsTable.appliedAt, new Date(startDate)) : undefined,
      endDate ? lte(chemicalApplicationsTable.appliedAt, new Date(endDate)) : undefined,
      applicatorId ? eq(chemicalApplicationsTable.applicatorId, parseInt(applicatorId, 10)) : undefined,
    ) as ReturnType<typeof and>)
    .orderBy(desc(chemicalApplicationsTable.appliedAt));

  // CSV helpers
  const esc = (v: unknown): string => {
    if (v == null) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  type BreakdownItem = {
    productName?: string | null;
    epaRegNumber?: string | null;
    activeIngredients?: string | null;
    amountApplied?: number | null;
    unit?: string | null;
    ratePerAcre?: number | null;
    ratePer1000Sqft?: number | null;
  };

  const headers = [
    'Application ID', 'Applied At', 'Job', 'Property Address',
    'Mixture / Product', 'Volume Applied', 'Volume Unit',
    'Treated Area', 'Area Unit', 'Treated Zone',
    'Target Pest', 'Application Method',
    'Wind Speed (mph)', 'Wind Direction', 'Temperature (°F)',
    'Applicator Name', 'Applicator License #', 'Notes',
    'Breakdown (Product | EPA Reg # | Active Ingredients | Amount Applied | Rate/Acre | Rate/1000sqft)',
  ];

  const dataRows = rows.map(r => {
    const app = r.app;
    const jobLabel = app.jobId == null
      ? 'job deleted'
      : (r.jobTitle ?? `Job #${app.jobId}`);

    const breakdown = (app.breakdown as BreakdownItem[] | null) ?? [];
    const breakdownStr = breakdown.map(b =>
      [b.productName, b.epaRegNumber, b.activeIngredients,
       b.amountApplied != null ? `${b.amountApplied} ${b.unit ?? ''}`.trim() : '',
       b.ratePerAcre != null ? `${b.ratePerAcre}/ac` : '',
       b.ratePer1000Sqft != null ? `${b.ratePer1000Sqft}/1ksqft` : '',
      ].map(v => v ?? '').join(' | ')
    ).join('; ');

    return [
      app.id,
      app.appliedAt.toISOString(),
      jobLabel,
      r.propertyAddress ?? '',
      app.mixtureName ?? app.productName ?? '',
      app.volumeApplied,
      app.volumeUnit,
      app.treatedArea ?? '',
      app.areaUnit ?? '',
      app.treatedZoneName ?? '',
      app.targetPest ?? '',
      app.applicationMethod ?? '',
      app.windSpeed ?? '',
      app.windDirection ?? '',
      app.temperature ?? '',
      app.applicatorName ?? '',
      app.applicatorLicenseNumber ?? '',
      app.notes ?? '',
      breakdownStr,
    ].map(esc).join(',');
  });

  const csv = [headers.map(esc).join(','), ...dataRows].join('\r\n');

  const filename = `chemical-applications-${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('\uFEFF' + csv); // BOM for Excel compatibility
});

router.delete("/chemical-applications/:id", requireOfficeRole, async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  await db.delete(chemicalApplicationsTable).where(and(eq(chemicalApplicationsTable.id, id), eq(chemicalApplicationsTable.tenantId, tenantId)));
  res.sendStatus(204);
});

export default router;
