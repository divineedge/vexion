import { Router, type IRouter } from "express";
import { db, tenantsTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getTenantId } from "../lib/tenantHelper";

const router: IRouter = Router();

function formatTenant(tenant: typeof tenantsTable.$inferSelect) {
  const cfJson = tenant.customFields as Record<string, unknown> | null;
  const rolePerms = tenant.rolePermissions as Record<string, Record<string, boolean>> | null;
  const defaultZoneLabels = (tenant.measurementZoneLabels as string[] | null) ?? ["Front Lawn", "Back Yard", "Bed Areas", "Side Yard", "Common Area"];
  const phonePlatformConfig = (tenant.phonePlatformConfig as Record<string, string>) ?? {};
  const emailProviderConfig = (tenant.emailProviderConfig as Record<string, string>) ?? {};
  return {
    id: tenant.id,
    tenantId: tenant.id,
    companyName: tenant.name,
    logoUrl: tenant.logoUrl ?? null,
    timezone: tenant.timezone,
    workdayCutoffTime: tenant.workdayCutoffTime,
    overageMaterialBuffer: tenant.overageMaterialBuffer,
    stripeEnabled: tenant.stripeEnabled,
    quickbooksEnabled: tenant.quickbooksEnabled,
    taxRate: tenant.taxRate,
    defaultMarkupPct: tenant.defaultMarkupPct,
    showCostPriceToTech: tenant.showCostPriceToTech,
    durationUnit: (tenant.durationUnit ?? "minutes") as "minutes" | "hours",
    autoInvoiceFrequency: (tenant.autoInvoiceFrequency ?? "off") as "off" | "daily" | "weekly" | "monthly",
    p4pMasterPercentage: tenant.p4pMasterPercentage ?? 0,
    rolePermissions: rolePerms ?? {},
    planTier: tenant.planTier as "starter" | "professional" | "enterprise",
    customerFields: (cfJson?.customerFields as unknown[]) ?? [],
    equipmentRepairThresholdPct: tenant.equipmentRepairThresholdPct ?? 50,
    equipmentResaleThresholdPct: tenant.equipmentResaleThresholdPct ?? 20,
    // Geofence & measurement defaults
    defaultGeofenceRadius: tenant.defaultGeofenceRadius ?? 100,
    defaultGeofenceUnit: (tenant.defaultGeofenceUnit ?? "m") as "m" | "ft",
    autoCreateGeofence: tenant.autoCreateGeofence ?? false,
    measurementZoneLabels: defaultZoneLabels,
    preferredAreaUnit: (tenant.preferredAreaUnit ?? "sqft") as "sqft" | "acres",
    // Communications
    mainPhoneNumber: tenant.mainPhoneNumber ?? null,
    marketingPhoneNumber: tenant.marketingPhoneNumber ?? null,
    phonePlatform: tenant.phonePlatform ?? null,
    phonePlatformConfig: {
      apiKey: phonePlatformConfig["apiKey"] ? "••••••••" : "",
      accountSid: phonePlatformConfig["accountSid"] ?? "",
      // Never expose auth token or webhook secret; just indicate if set
      authTokenSet: !!(phonePlatformConfig["authToken"]),
      webhookSecret: phonePlatformConfig["webhookSecret"] ? "••••••••" : "",
    },
    emailProvider: tenant.emailProvider ?? null,
    emailProviderConfig: {
      apiKey: emailProviderConfig["apiKey"] ? "••••••••" : "",
      fromAddress: emailProviderConfig["fromAddress"] ?? "",
      domain: emailProviderConfig["domain"] ?? "",
      // SMTP fields — mask password, expose others
      smtpHost: emailProviderConfig["smtpHost"] ?? "",
      smtpPort: emailProviderConfig["smtpPort"] ?? "587",
      smtpUser: emailProviderConfig["smtpUser"] ?? "",
      smtpPass: emailProviderConfig["smtpPass"] ? "••••••••" : "",
    },
  };
}

router.get("/settings", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  if (!tenant) { res.status(404).json({ error: "Tenant not found" }); return; }
  res.json(formatTenant(tenant));
});

router.patch("/settings", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const {
    companyName, timezone, workdayCutoffTime, overageMaterialBuffer,
    stripeEnabled, quickbooksEnabled, taxRate,
    defaultMarkupPct, showCostPriceToTech,
    durationUnit, autoInvoiceFrequency, p4pMasterPercentage,
    rolePermissions, customerFields,
    equipmentRepairThresholdPct, equipmentResaleThresholdPct,
    defaultGeofenceRadius, defaultGeofenceUnit, autoCreateGeofence,
    measurementZoneLabels, preferredAreaUnit,
    // Communications
    mainPhoneNumber, marketingPhoneNumber,
    phonePlatform, phonePlatformConfig,
    emailProvider, emailProviderConfig,
  } = req.body;

  const updates: Partial<typeof tenantsTable.$inferInsert> = {};
  if (companyName) updates.name = companyName;
  if (timezone) updates.timezone = timezone;
  if (workdayCutoffTime) updates.workdayCutoffTime = workdayCutoffTime;
  if (overageMaterialBuffer !== undefined) updates.overageMaterialBuffer = overageMaterialBuffer;
  if (stripeEnabled !== undefined) updates.stripeEnabled = stripeEnabled;
  if (quickbooksEnabled !== undefined) updates.quickbooksEnabled = quickbooksEnabled;
  if (taxRate !== undefined) updates.taxRate = taxRate;
  if (defaultMarkupPct !== undefined) updates.defaultMarkupPct = parseFloat(defaultMarkupPct);
  if (showCostPriceToTech !== undefined) updates.showCostPriceToTech = showCostPriceToTech;
  if (durationUnit !== undefined) updates.durationUnit = durationUnit;
  if (autoInvoiceFrequency !== undefined) updates.autoInvoiceFrequency = autoInvoiceFrequency;
  if (p4pMasterPercentage !== undefined) updates.p4pMasterPercentage = parseFloat(p4pMasterPercentage);
  if (rolePermissions !== undefined) {
    updates.rolePermissions = rolePermissions;
  }
  if (equipmentRepairThresholdPct !== undefined) updates.equipmentRepairThresholdPct = parseFloat(equipmentRepairThresholdPct);
  if (equipmentResaleThresholdPct !== undefined) updates.equipmentResaleThresholdPct = parseFloat(equipmentResaleThresholdPct);
  if (customerFields !== undefined) {
    const [existing] = await db.select({ customFields: tenantsTable.customFields }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
    const prev = (existing?.customFields as Record<string, unknown>) ?? {};
    updates.customFields = { ...prev, customerFields };
  }
  if (defaultGeofenceRadius !== undefined) updates.defaultGeofenceRadius = parseInt(defaultGeofenceRadius, 10);
  if (defaultGeofenceUnit !== undefined) updates.defaultGeofenceUnit = defaultGeofenceUnit;
  if (autoCreateGeofence !== undefined) updates.autoCreateGeofence = autoCreateGeofence;
  if (measurementZoneLabels !== undefined) updates.measurementZoneLabels = measurementZoneLabels;
  if (preferredAreaUnit !== undefined) updates.preferredAreaUnit = preferredAreaUnit;
  // Communications
  if (mainPhoneNumber !== undefined) updates.mainPhoneNumber = mainPhoneNumber || null;
  if (marketingPhoneNumber !== undefined) updates.marketingPhoneNumber = marketingPhoneNumber || null;
  if (phonePlatform !== undefined) updates.phonePlatform = phonePlatform || null;
  if (phonePlatformConfig !== undefined) {
    // Merge with existing so we don't overwrite secrets with masked values
    const [existing] = await db.select({ phonePlatformConfig: tenantsTable.phonePlatformConfig }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
    const prev = (existing?.phonePlatformConfig as Record<string, string>) ?? {};
    const incoming = phonePlatformConfig as Record<string, string>;
    const merged: Record<string, string> = { ...prev };
    if (incoming["apiKey"] && !incoming["apiKey"].startsWith("••")) merged["apiKey"] = incoming["apiKey"];
    if (incoming["accountSid"]) merged["accountSid"] = incoming["accountSid"];
    if (incoming["authToken"] && !incoming["authToken"].startsWith("••")) merged["authToken"] = incoming["authToken"];
    if (incoming["webhookSecret"] && !incoming["webhookSecret"].startsWith("••")) merged["webhookSecret"] = incoming["webhookSecret"];
    updates.phonePlatformConfig = merged;
  }
  if (emailProvider !== undefined) updates.emailProvider = emailProvider || null;
  if (emailProviderConfig !== undefined) {
    const [existing] = await db.select({ emailProviderConfig: tenantsTable.emailProviderConfig }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
    const prev = (existing?.emailProviderConfig as Record<string, string>) ?? {};
    const incoming = emailProviderConfig as Record<string, string>;
    const merged: Record<string, string> = { ...prev };
    if (incoming["apiKey"] && !incoming["apiKey"].startsWith("••")) merged["apiKey"] = incoming["apiKey"];
    if (incoming["fromAddress"]) merged["fromAddress"] = incoming["fromAddress"];
    if (incoming["domain"]) merged["domain"] = incoming["domain"];
    if (incoming["smtpHost"]) merged["smtpHost"] = incoming["smtpHost"];
    if (incoming["smtpPort"]) merged["smtpPort"] = incoming["smtpPort"];
    if (incoming["smtpUser"]) merged["smtpUser"] = incoming["smtpUser"];
    if (incoming["smtpPass"] && !incoming["smtpPass"].startsWith("••")) merged["smtpPass"] = incoming["smtpPass"];
    updates.emailProviderConfig = merged;
  }

  const [updated] = await db.update(tenantsTable).set(updates).where(eq(tenantsTable.id, tenantId)).returning();
  if (!updated) { res.status(404).json({ error: "Tenant not found" }); return; }
  res.json(formatTenant(updated));
});

router.get("/settings/users", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));

  const users = await db.select().from(usersTable).where(eq(usersTable.tenantId, tenantId)).orderBy(usersTable.name);
  res.json(users.map(u => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    tenantId: u.tenantId,
    planTier: tenant?.planTier ?? "starter",
    avatarUrl: u.avatarUrl ?? null,
    isActive: u.isActive,
    createdAt: u.createdAt.toISOString(),
  })));
});

router.post("/settings/users", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { email, name, role, password } = req.body;
  if (!email || !name || !role) { res.status(400).json({ error: "email, name, role required" }); return; }

  const [user] = await db.insert(usersTable).values({
    tenantId,
    email,
    name,
    role,
    passwordHash: password ?? "mock",
  }).returning();

  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));

  res.status(201).json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    tenantId: user.tenantId,
    planTier: tenant?.planTier ?? "starter",
    avatarUrl: null,
    isActive: user.isActive,
    createdAt: user.createdAt.toISOString(),
  });
});

router.patch("/settings/users/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const { name, role, isActive } = req.body;
  const updates: Partial<typeof usersTable.$inferInsert> = {};
  if (name) updates.name = name;
  if (role) updates.role = role;
  if (isActive !== undefined) updates.isActive = isActive;

  const [updated] = await db.update(usersTable).set(updates).where(and(eq(usersTable.id, id), eq(usersTable.tenantId, tenantId))).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  res.json({ id: updated.id, email: updated.email, name: updated.name, role: updated.role, tenantId: updated.tenantId, planTier: tenant?.planTier ?? "starter", avatarUrl: updated.avatarUrl ?? null, isActive: updated.isActive, createdAt: updated.createdAt.toISOString() });
});

router.delete("/settings/users/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  await db.delete(usersTable).where(and(eq(usersTable.id, id), eq(usersTable.tenantId, tenantId)));
  res.sendStatus(204);
});

export default router;
