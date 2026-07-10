import { Router, type IRouter } from "express";
import { db, tenantsTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getTenantId } from "../lib/tenantHelper";

const router: IRouter = Router();

router.get("/settings", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);

  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  if (!tenant) { res.status(404).json({ error: "Tenant not found" }); return; }

  res.json({
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
    planTier: tenant.planTier as "starter" | "professional" | "enterprise",
    customFields: (tenant.customFields as unknown[]) ?? [],
  });
});

router.patch("/settings", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { companyName, timezone, workdayCutoffTime, overageMaterialBuffer, stripeEnabled, quickbooksEnabled, taxRate, customFields } = req.body;

  const updates: Partial<typeof tenantsTable.$inferInsert> = {};
  if (companyName) updates.name = companyName;
  if (timezone) updates.timezone = timezone;
  if (workdayCutoffTime) updates.workdayCutoffTime = workdayCutoffTime;
  if (overageMaterialBuffer !== undefined) updates.overageMaterialBuffer = overageMaterialBuffer;
  if (stripeEnabled !== undefined) updates.stripeEnabled = stripeEnabled;
  if (quickbooksEnabled !== undefined) updates.quickbooksEnabled = quickbooksEnabled;
  if (taxRate !== undefined) updates.taxRate = taxRate;
  if (customFields !== undefined) updates.customFields = customFields;

  const [updated] = await db.update(tenantsTable).set(updates).where(eq(tenantsTable.id, tenantId)).returning();
  if (!updated) { res.status(404).json({ error: "Tenant not found" }); return; }

  res.json({
    id: updated.id,
    tenantId: updated.id,
    companyName: updated.name,
    logoUrl: updated.logoUrl ?? null,
    timezone: updated.timezone,
    workdayCutoffTime: updated.workdayCutoffTime,
    overageMaterialBuffer: updated.overageMaterialBuffer,
    stripeEnabled: updated.stripeEnabled,
    quickbooksEnabled: updated.quickbooksEnabled,
    taxRate: updated.taxRate,
    planTier: updated.planTier as "starter" | "professional" | "enterprise",
    customFields: (updated.customFields as unknown[]) ?? [],
  });
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
