import { Router, type IRouter } from "express";
import { db, usersTable, tenantsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";

const router: IRouter = Router();

// Business registration — creates a new tenant + company_owner user
router.post("/auth/register", async (req, res): Promise<void> => {
  const { companyName, ownerName, email, password } = req.body;
  if (!companyName || !ownerName || !email || !password) {
    res.status(400).json({ error: "companyName, ownerName, email, and password are required" });
    return;
  }
  if ((password as string).length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

  const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email));
  if (existing) {
    res.status(409).json({ error: "An account with that email already exists" });
    return;
  }

  // Generate a unique URL-safe slug from the company name
  const baseSlug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const existingSlugs = await db.select({ slug: tenantsTable.slug }).from(tenantsTable).where(sql`slug LIKE ${baseSlug + "%"}`);
  const takenSlugs = new Set(existingSlugs.map(r => r.slug));
  let slug = baseSlug;
  let counter = 1;
  while (takenSlugs.has(slug)) { slug = `${baseSlug}-${counter++}`; }

  const [tenant] = await db.insert(tenantsTable).values({ name: companyName, slug }).returning();
  const passwordHash = await bcrypt.hash(password, 10);
  const [user] = await db.insert(usersTable).values({
    tenantId: tenant.id,
    email,
    name: ownerName,
    role: "company_owner",
    passwordHash,
  }).returning();

  res.status(201).json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tenantId: user.tenantId,
      planTier: tenant.planTier,
      avatarUrl: null,
      isActive: user.isActive,
      createdAt: user.createdAt.toISOString(),
    },
    token: `token-${user.id}`,
  });
});

// Login — validates password (legacy 'mock' hash lets dev seed users log in with any password)
router.post("/auth/login", async (req, res): Promise<void> => {
  const { email, password } = req.body;
  if (!email) {
    res.status(400).json({ error: "email is required" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (!user) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  // Dev seed users have passwordHash='mock' — skip bcrypt check so they keep working
  const valid = user.passwordHash === "mock"
    ? true
    : await bcrypt.compare(password ?? "", user.passwordHash);

  if (!valid) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, user.tenantId));

  res.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tenantId: user.tenantId,
      planTier: tenant?.planTier ?? "starter",
      avatarUrl: user.avatarUrl ?? null,
      isActive: user.isActive,
      createdAt: user.createdAt.toISOString(),
    },
    token: `token-${user.id}`,
  });
});

router.post("/auth/logout", async (_req, res): Promise<void> => {
  res.json({ success: true });
});

router.get("/auth/me", async (req, res): Promise<void> => {
  const userId = req.headers["x-user-id"];
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const id = parseInt(Array.isArray(userId) ? userId[0] : userId, 10);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, user.tenantId));

  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    tenantId: user.tenantId,
    planTier: tenant?.planTier ?? "starter",
    avatarUrl: user.avatarUrl ?? null,
    isActive: user.isActive,
    createdAt: user.createdAt.toISOString(),
  });
});

export default router;
