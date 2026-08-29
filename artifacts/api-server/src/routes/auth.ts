import { Router, type IRouter } from "express";
import { db, usersTable, tenantsTable, staffSessionsTable } from "@workspace/db";
import { eq, and, gt, sql } from "drizzle-orm";
import { randomBytes, createHash } from "crypto";
import bcrypt from "bcryptjs";

const router: IRouter = Router();

/** SHA-256 hash of a raw token string — stored in DB; never the raw value */
function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** 30-day session lifetime */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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

  const normalizedEmail = String(email).trim().toLowerCase();
  if (!normalizedEmail) {
    res.status(400).json({ error: "email is required" });
    return;
  }

  const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(
    sql`lower(${usersTable.email}) = ${normalizedEmail}`,
  );
  if (existing) {
    res.status(409).json({ error: "An account with that email already exists" });
    return;
  }

  // Generate a unique URL-safe slug from the company name
  const baseSlug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const existingSlugs = await db.select({ slug: tenantsTable.slug }).from(tenantsTable);
  const takenSlugs = new Set(existingSlugs.map(r => r.slug).filter((s): s is string => s != null && s.startsWith(baseSlug)));
  let slug = baseSlug;
  let counter = 1;
  while (takenSlugs.has(slug)) { slug = `${baseSlug}-${counter++}`; }

  const [tenant] = await db.insert(tenantsTable).values({ name: companyName, slug }).returning();
  const passwordHash = await bcrypt.hash(password, 10);
  const [user] = await db.insert(usersTable).values({
    tenantId: tenant.id,
    email: normalizedEmail,
    name: ownerName,
    role: "company_owner",
    passwordHash,
  }).returning();

  // Create a server-side staff session for the newly registered user
  const rawToken = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(staffSessionsTable).values({
    tenantId: tenant.id,
    userId: user.id,
    tokenHash: hashToken(rawToken),
    expiresAt,
  });

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
    sessionToken: rawToken,
  });
});

// Login — validates password (legacy 'mock' hash lets dev seed users log in with any password)
router.post("/auth/login", async (req, res): Promise<void> => {
  const { email, password } = req.body;
  if (!email) {
    res.status(400).json({ error: "email is required" });
    return;
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const [user] = await db.select().from(usersTable).where(
    sql`lower(${usersTable.email}) = ${normalizedEmail}`,
  );
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

  // Create a server-side staff session. The raw token is returned to the client
  // once and never stored here; only its SHA-256 hash is persisted so a DB leak
  // cannot be used to impersonate users.
  const rawToken = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(staffSessionsTable).values({
    tenantId: user.tenantId,
    userId: user.id,
    tokenHash: hashToken(rawToken),
    expiresAt,
  });

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
    sessionToken: rawToken,
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

/**
 * Resolve a staff session token to the verified staff identity.
 * Called by the staff-notes middleware. Returns the session's tenantId and userId
 * (never trusting caller-supplied headers for these values).
 *
 * Accepts the token from the `x-staff-session` header or from the
 * `Authorization: Bearer <token>` header. Returns null if the token is absent,
 * unrecognised, or expired.
 */
export async function resolveStaffSession(
  req: Parameters<typeof router.get>[1] extends (req: infer R, ...args: unknown[]) => unknown ? R : never
): Promise<{ tenantId: number; userId: number } | null> {
  // Try x-staff-session first, then Authorization: Bearer
  const raw = req.headers["x-staff-session"] as string | undefined
    ?? (() => {
      const auth = req.headers["authorization"] as string | undefined;
      if (auth?.startsWith("Bearer ")) return auth.slice(7);
      return undefined;
    })();

  if (!raw) return null;

  const tokenHash = hashToken(raw);
  const now = new Date();

  const [session] = await db
    .select({ tenantId: staffSessionsTable.tenantId, userId: staffSessionsTable.userId })
    .from(staffSessionsTable)
    .where(
      and(
        eq(staffSessionsTable.tokenHash, tokenHash),
        gt(staffSessionsTable.expiresAt, now),
      ),
    )
    .limit(1);

  return session ?? null;
}

export default router;
