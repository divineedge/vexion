import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { db, tenantsTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { isAdminRole } from "../lib/roles";
import { ObjectStorageService } from "../lib/objectStorage";
import { buildGoogleAuthorizeUrl, exchangeGoogleCode } from "../lib/gmailProvider";

const objectStorageService = new ObjectStorageService();

const router: IRouter = Router();

function formatTenant(tenant: typeof tenantsTable.$inferSelect) {
  const cfJson = tenant.customFields as Record<string, unknown> | null;
  const rolePerms = tenant.rolePermissions as Record<string, Record<string, boolean>> | null;
  const defaultZoneLabels = (tenant.measurementZoneLabels as string[] | null) ?? ["Front Lawn", "Back Yard", "Bed Areas", "Side Yard", "Common Area"];
  const DEFAULT_ZONE_COLORS = ['#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6','#06B6D4','#84CC16','#F97316','#EC4899','#6366F1'];
  // If measurementZoneTypes is populated, use it; otherwise derive from legacy labels
  const rawZoneTypes = tenant.measurementZoneTypes as Array<{ id: string; name: string; color: string }> | null;
  const measurementZoneTypes: Array<{ id: string; name: string; color: string }> =
    rawZoneTypes && rawZoneTypes.length > 0
      ? rawZoneTypes
      : defaultZoneLabels.map((name, i) => ({ id: String(i + 1), name, color: DEFAULT_ZONE_COLORS[i % DEFAULT_ZONE_COLORS.length] }));
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
    autoInvoiceFrequency: (tenant.autoInvoiceFrequency ?? "off") as "off" | "daily" | "weekly" | "bi_monthly" | "monthly",
    nonRecurringInvoiceCadence: (tenant.nonRecurringInvoiceCadence ?? "immediate") as "immediate" | "weekly",
    maxClockInHours: tenant.maxClockInHours ?? null,
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
    measurementZoneTypes,
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
      // Gmail OAuth — never expose the refresh token, just whether/who is connected
      gmailConnected: !!emailProviderConfig["gmailRefreshToken"],
      gmailEmail: emailProviderConfig["gmailEmail"] ?? "",
      gmailSenderName: emailProviderConfig["gmailSenderName"] ?? "",
    },
    // Business Profile
    businessPhone: tenant.businessPhone ?? null,
    businessEmail: tenant.businessEmail ?? null,
    businessWebsite: tenant.businessWebsite ?? null,
    businessAddress: tenant.businessAddress ?? null,
    businessLicenseNumber: tenant.businessLicenseNumber ?? null,
    businessTagline: tenant.businessTagline ?? null,
    invoiceFooterText: tenant.invoiceFooterText ?? null,
    // Payment Reminders & Stop-Service
    paymentRemindersEnabled: tenant.paymentRemindersEnabled ?? false,
    // Rules created before per-rule channels don't have a `channels` field yet — surface
    // the tenant's legacy global channel setting as each such rule's effective default so
    // the Settings UI shows/edits the same channels the scheduler will actually use.
    paymentReminderSchedule: (
      (tenant.paymentReminderSchedule as { offsetDays: number; label: string; channels?: string[] }[]) ?? []
    ).map(rule => ({
      ...rule,
      channels: rule.channels && rule.channels.length > 0 ? rule.channels : ((tenant.paymentReminderChannels as string[]) ?? ["email"]),
    })),
    paymentReminderChannels: (tenant.paymentReminderChannels as string[]) ?? ["email"],
    stopServiceRuleEnabled: tenant.stopServiceRuleEnabled ?? false,
    stopServiceThresholdDays: tenant.stopServiceThresholdDays ?? 30,
    // Review Collection
    reviewRequestOnInvoicePaid: tenant.reviewRequestOnInvoicePaid ?? true,
    reviewRequestOnEstimateApproved: tenant.reviewRequestOnEstimateApproved ?? false,
    reviewGoogleUrl: tenant.reviewGoogleUrl ?? null,
    reviewFacebookUrl: tenant.reviewFacebookUrl ?? null,
    reviewCustomLink1Label: tenant.reviewCustomLink1Label ?? null,
    reviewCustomLink1Url: tenant.reviewCustomLink1Url ?? null,
    reviewCustomLink2Label: tenant.reviewCustomLink2Label ?? null,
    reviewCustomLink2Url: tenant.reviewCustomLink2Url ?? null,
    // Routing
    routeExceptionFee: tenant.routeExceptionFee ?? 0,
    // Equipment Cost Ledger
    fuelPricePerGallon: tenant.fuelPricePerGallon ?? 4.0,
    equipmentRuntimeHourlyRate: tenant.equipmentRuntimeHourlyRate ?? 0,
    equipmentDowntimeHourlyRate: tenant.equipmentDowntimeHourlyRate ?? 0,
    // Payroll
    dailyTaskHourlyRate: tenant.dailyTaskHourlyRate ?? 0,
    // Smart Follow-Up Queue automation triggers
    followupTriggerConfig: (tenant.followupTriggerConfig as Record<string, unknown>) ?? {
      sentEstimate: { enabled: true, delayDays: 3, repeatDays: 3 },
      sentInvoice: { enabled: true, delayDays: 5, repeatDays: 5 },
      unansweredEmail: { enabled: true, hours: 48 },
      missedCall: { enabled: true },
    },
    // Quick-Add Shortcut Bar
    quickShortcuts: (tenant.quickShortcuts as string[] | null) ?? ["new-job", "new-customer", "new-invoice"],
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
    durationUnit, autoInvoiceFrequency, nonRecurringInvoiceCadence, maxClockInHours, p4pMasterPercentage,
    rolePermissions, customerFields,
    equipmentRepairThresholdPct, equipmentResaleThresholdPct,
    defaultGeofenceRadius, defaultGeofenceUnit, autoCreateGeofence,
    measurementZoneLabels, measurementZoneTypes, preferredAreaUnit,
    // Communications
    mainPhoneNumber, marketingPhoneNumber,
    phonePlatform, phonePlatformConfig,
    emailProvider, emailProviderConfig,
    // Business Profile
    logoUrl, businessPhone, businessEmail, businessWebsite, businessAddress,
    businessLicenseNumber, businessTagline, invoiceFooterText,
    // Payment Reminders & Stop-Service
    paymentRemindersEnabled, paymentReminderSchedule, paymentReminderChannels,
    stopServiceRuleEnabled, stopServiceThresholdDays,
    // Review Collection
    reviewRequestOnInvoicePaid, reviewRequestOnEstimateApproved,
    reviewGoogleUrl, reviewFacebookUrl,
    reviewCustomLink1Label, reviewCustomLink1Url,
    reviewCustomLink2Label, reviewCustomLink2Url,
    // Routing
    routeExceptionFee,
    // Equipment Cost Ledger
    fuelPricePerGallon, equipmentRuntimeHourlyRate, equipmentDowntimeHourlyRate,
    // Payroll
    dailyTaskHourlyRate,
    // Quick-Add Shortcut Bar
    quickShortcuts,
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
  if (nonRecurringInvoiceCadence !== undefined) updates.nonRecurringInvoiceCadence = nonRecurringInvoiceCadence;
  if (maxClockInHours !== undefined) updates.maxClockInHours = maxClockInHours === null ? null : parseFloat(maxClockInHours);
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
  if (measurementZoneTypes !== undefined) updates.measurementZoneTypes = measurementZoneTypes;
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
  // Business Profile
  if (logoUrl !== undefined) {
    const nextLogoUrl: string | null = logoUrl || null;
    if (nextLogoUrl) {
      // Security: logos are served publicly and unauthenticated (branding on
      // customer-facing pages), so we must not just trust whatever object
      // path a tenant sends here — a guessed/enumerated path could otherwise
      // expose another tenant's private object. Explicitly stamp the object's
      // ACL policy as owner=this tenant + visibility=public at the moment the
      // tenant designates it as their logo; GET /public/tenants/:id/logo only
      // serves objects whose ACL policy is actually public.
      if (!nextLogoUrl.startsWith("/objects/")) {
        res.status(400).json({ error: "Invalid logoUrl: must be an uploaded object path" });
        return;
      }
      try {
        const objectFile = await objectStorageService.getObjectEntityFile(nextLogoUrl);
        // Ownership was stamped at upload-mint time (POST /storage/uploads/request-url),
        // when the requester was the only party who could know this fresh objectPath.
        // Only the tenant that actually uploaded this object may publish it as their logo.
        const owner = await objectStorageService.getObjectEntityAclOwner(objectFile);
        if (owner !== String(tenantId)) {
          res.status(403).json({ error: "Forbidden: object was not uploaded by this tenant" });
          return;
        }
        await objectStorageService.trySetObjectEntityAclPolicy(nextLogoUrl, {
          owner: String(tenantId),
          visibility: "public",
        });
      } catch {
        res.status(400).json({ error: "Invalid logoUrl: object not found" });
        return;
      }
    }
    updates.logoUrl = nextLogoUrl;
  }
  if (businessPhone !== undefined) updates.businessPhone = businessPhone || null;
  if (businessEmail !== undefined) updates.businessEmail = businessEmail || null;
  if (businessWebsite !== undefined) updates.businessWebsite = businessWebsite || null;
  if (businessAddress !== undefined) updates.businessAddress = businessAddress || null;
  if (businessLicenseNumber !== undefined) updates.businessLicenseNumber = businessLicenseNumber || null;
  if (businessTagline !== undefined) updates.businessTagline = businessTagline || null;
  if (invoiceFooterText !== undefined) updates.invoiceFooterText = invoiceFooterText || null;
  // Payment Reminders & Stop-Service
  if (paymentRemindersEnabled !== undefined) updates.paymentRemindersEnabled = paymentRemindersEnabled;
  if (paymentReminderSchedule !== undefined) updates.paymentReminderSchedule = paymentReminderSchedule;
  if (paymentReminderChannels !== undefined) updates.paymentReminderChannels = paymentReminderChannels;
  if (stopServiceRuleEnabled !== undefined) updates.stopServiceRuleEnabled = stopServiceRuleEnabled;
  if (stopServiceThresholdDays !== undefined) updates.stopServiceThresholdDays = parseInt(stopServiceThresholdDays, 10);
  // Review Collection
  if (reviewRequestOnInvoicePaid !== undefined) updates.reviewRequestOnInvoicePaid = reviewRequestOnInvoicePaid;
  if (reviewRequestOnEstimateApproved !== undefined) updates.reviewRequestOnEstimateApproved = reviewRequestOnEstimateApproved;
  if (reviewGoogleUrl !== undefined) updates.reviewGoogleUrl = reviewGoogleUrl || null;
  if (reviewFacebookUrl !== undefined) updates.reviewFacebookUrl = reviewFacebookUrl || null;
  if (reviewCustomLink1Label !== undefined) updates.reviewCustomLink1Label = reviewCustomLink1Label || null;
  if (reviewCustomLink1Url !== undefined) updates.reviewCustomLink1Url = reviewCustomLink1Url || null;
  if (reviewCustomLink2Label !== undefined) updates.reviewCustomLink2Label = reviewCustomLink2Label || null;
  if (reviewCustomLink2Url !== undefined) updates.reviewCustomLink2Url = reviewCustomLink2Url || null;
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
    // Gmail sender display name — save empty string as deletion (no name = bare address)
    if ("gmailSenderName" in incoming) merged["gmailSenderName"] = incoming["gmailSenderName"] ?? "";
    updates.emailProviderConfig = merged;
  }
  if (routeExceptionFee !== undefined) updates.routeExceptionFee = parseFloat(routeExceptionFee);
  if (fuelPricePerGallon !== undefined) updates.fuelPricePerGallon = parseFloat(fuelPricePerGallon);
  if (equipmentRuntimeHourlyRate !== undefined) updates.equipmentRuntimeHourlyRate = parseFloat(equipmentRuntimeHourlyRate);
  if (equipmentDowntimeHourlyRate !== undefined) updates.equipmentDowntimeHourlyRate = parseFloat(equipmentDowntimeHourlyRate);
  if (dailyTaskHourlyRate !== undefined) updates.dailyTaskHourlyRate = parseFloat(dailyTaskHourlyRate);
  if (quickShortcuts !== undefined) {
    const VALID_IDS = new Set([
      'new-job', 'new-customer', 'new-invoice', 'new-estimate',
      'new-task', 'new-expense', 'go-calendar', 'go-reports',
    ]);
    if (!Array.isArray(quickShortcuts)) {
      res.status(400).json({ error: "quickShortcuts must be an array" });
      return;
    }
    const invalid = quickShortcuts.filter((id: unknown) => typeof id !== 'string' || !VALID_IDS.has(id as string));
    if (invalid.length > 0) {
      res.status(400).json({ error: `Invalid shortcut IDs: ${invalid.join(', ')}` });
      return;
    }
    // Dedupe and cap at 6
    const deduped = [...new Set(quickShortcuts as string[])].slice(0, 6);
    updates.quickShortcuts = deduped;
  }

  const [updated] = await db.update(tenantsTable).set(updates).where(eq(tenantsTable.id, tenantId)).returning();
  if (!updated) { res.status(404).json({ error: "Tenant not found" }); return; }
  res.json(formatTenant(updated));
});

// ── Gmail OAuth (send-only) ─────────────────────────────────────────────────
// Lets an admin connect their own Google account instead of hand-entering SMTP/API-key
// credentials. Mirrors the QuickBooks OAuth pattern in routes/integrations.ts, including
// the single-use CSRF nonce bound to tenant+user for the callback.

router.get("/settings/email/gmail/oauth/authorize-url", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) { res.status(403).json({ error: "Restricted to owner/admin roles" }); return; }

  const nonce = crypto.randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  const [existing] = await db.select({ emailProviderConfig: tenantsTable.emailProviderConfig }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  const prev = (existing?.emailProviderConfig as Record<string, string>) ?? {};
  await db.update(tenantsTable).set({
    emailProviderConfig: { ...prev, gmailOAuthNonce: nonce, gmailOAuthNonceExpiresAt: expiresAt, gmailOAuthUserId: String(userId) },
  }).where(eq(tenantsTable.id, tenantId));

  const redirectUri = `${req.protocol}://${req.get("host")}/api/settings/email/gmail/oauth/callback`;
  const { url, error } = buildGoogleAuthorizeUrl(redirectUri, `${tenantId}.${nonce}`);
  if (error) { res.status(400).json({ error }); return; }
  res.json({ url });
});

router.get("/settings/email/gmail/oauth/callback", async (req, res): Promise<void> => {
  const { code, state } = req.query as Record<string, string>;
  const separatorIndex = state ? state.indexOf(".") : -1;
  const tenantId = separatorIndex > 0 ? parseInt(state.slice(0, separatorIndex), 10) : NaN;
  const nonce = separatorIndex > 0 ? state.slice(separatorIndex + 1) : "";
  if (!tenantId || !nonce || !code) { res.status(400).send("Missing or malformed code/state"); return; }

  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  if (!tenant) { res.status(400).send("Unknown tenant"); return; }
  const prev = (tenant.emailProviderConfig as Record<string, string>) ?? {};

  // Validate the nonce against the one this tenant's admin was issued, constant-time, and
  // reject if missing, mismatched, or expired. Invalidate it immediately (single-use) so a
  // captured callback URL cannot be replayed to bind another attacker-controlled account.
  const nonceBuffer = Buffer.from(nonce);
  const pendingBuffer = Buffer.from(prev["gmailOAuthNonce"] ?? "");
  const nonceValid = !!prev["gmailOAuthNonce"]
    && nonceBuffer.length === pendingBuffer.length
    && crypto.timingSafeEqual(nonceBuffer, pendingBuffer)
    && !!prev["gmailOAuthNonceExpiresAt"]
    && new Date(prev["gmailOAuthNonceExpiresAt"]).getTime() > Date.now();

  const cleared = { ...prev };
  delete cleared["gmailOAuthNonce"];
  delete cleared["gmailOAuthNonceExpiresAt"];
  delete cleared["gmailOAuthUserId"];

  if (!nonceValid) {
    await db.update(tenantsTable).set({ emailProviderConfig: cleared }).where(eq(tenantsTable.id, tenantId));
    res.status(400).send("Gmail connection failed: invalid or expired authorization request. Please retry from Settings.");
    return;
  }

  const redirectUri = `${req.protocol}://${req.get("host")}/api/settings/email/gmail/oauth/callback`;
  const result = await exchangeGoogleCode(code, redirectUri);

  if (!result.success) {
    await db.update(tenantsTable).set({ emailProviderConfig: cleared }).where(eq(tenantsTable.id, tenantId));
    res.status(400).send(`Gmail connection failed: ${result.error}`);
    return;
  }

  await db.update(tenantsTable).set({
    emailProvider: "gmail",
    emailProviderConfig: { ...cleared, gmailRefreshToken: result.refreshToken, gmailEmail: result.email },
  }).where(eq(tenantsTable.id, tenantId));

  res.send("<html><body>Gmail connected successfully. You can close this window and return to Settings.</body></html>");
});

router.delete("/settings/email/gmail", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) { res.status(403).json({ error: "Restricted to owner/admin roles" }); return; }

  const [existing] = await db.select({ emailProviderConfig: tenantsTable.emailProviderConfig, emailProvider: tenantsTable.emailProvider }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  const prev = (existing?.emailProviderConfig as Record<string, string>) ?? {};
  const cleared = { ...prev };
  delete cleared["gmailRefreshToken"];
  delete cleared["gmailEmail"];

  await db.update(tenantsTable).set({
    emailProviderConfig: cleared,
    // Fall back to dev/no-provider mode if Gmail was the active provider, matching how
    // disconnecting an integration elsewhere in Settings leaves no dangling active state.
    emailProvider: existing?.emailProvider === "gmail" ? null : existing?.emailProvider,
  }).where(eq(tenantsTable.id, tenantId));

  res.sendStatus(204);
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
    hourlyRate: u.hourlyRate ?? null,
    hireDate: u.hireDate?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  })));
});

router.post("/settings/users", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { email, name, role, password, hourlyRate, hireDate } = req.body;
  if (!email || !name || !role) { res.status(400).json({ error: "email, name, role required" }); return; }

  const passwordHash = password ? await bcrypt.hash(password, 10) : "mock";
  const [user] = await db.insert(usersTable).values({
    tenantId,
    email,
    name,
    role,
    passwordHash,
    hourlyRate: hourlyRate !== undefined && hourlyRate !== null ? parseFloat(hourlyRate) : null,
    hireDate: hireDate ? new Date(hireDate) : null,
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
    hourlyRate: user.hourlyRate ?? null,
    hireDate: user.hireDate?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  });
});

router.patch("/settings/users/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const { name, role, isActive, assignedLocationId, hourlyRate, hireDate, password } = req.body;
  const updates: Partial<typeof usersTable.$inferInsert> = {};
  if (name) updates.name = name;
  if (role) updates.role = role;
  if (password) updates.passwordHash = await bcrypt.hash(password, 10);
  if (isActive !== undefined) updates.isActive = isActive;
  if (assignedLocationId !== undefined) updates.assignedLocationId = assignedLocationId ? parseInt(String(assignedLocationId), 10) : null;
  if (hourlyRate !== undefined) updates.hourlyRate = hourlyRate === null ? null : parseFloat(hourlyRate);
  if (hireDate !== undefined) updates.hireDate = hireDate ? new Date(hireDate) : null;

  const [updated] = await db.update(usersTable).set(updates).where(and(eq(usersTable.id, id), eq(usersTable.tenantId, tenantId))).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  res.json({ id: updated.id, email: updated.email, name: updated.name, role: updated.role, tenantId: updated.tenantId, planTier: tenant?.planTier ?? "starter", avatarUrl: updated.avatarUrl ?? null, isActive: updated.isActive, assignedLocationId: updated.assignedLocationId ?? null, hourlyRate: updated.hourlyRate ?? null, hireDate: updated.hireDate?.toISOString() ?? null, createdAt: updated.createdAt.toISOString() });
});

router.delete("/settings/users/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  await db.delete(usersTable).where(and(eq(usersTable.id, id), eq(usersTable.tenantId, tenantId)));
  res.sendStatus(204);
});

export default router;
