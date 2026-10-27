import { ensureTenantSlug } from "../lib/tenantSlug";
import { Router, type IRouter } from "express";
import { authBlocked,authFailure,verifySecondFactor } from "../lib/accountSecurity";
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
// Native devices opt in only after phone verification. Ordinary web/password
// sessions retain their 30-day expiry. Remembered tokens remain revocable through
// the same logout, account deactivation and password-change controls.
const REMEMBERED_DEVICE_EXPIRY = new Date("9999-12-31T23:59:59.999Z");

// Business registration — creates a new tenant + company_owner user
router.post("/auth/register", async (req, res): Promise<void> => {
  const { companyName, ownerName, email, password } = req.body;
  if(typeof companyName!=="string"||!companyName.trim()||companyName.trim().length>120){
    res.status(400).json({error:"Business name is required and must be at most 120 characters"});return;
  }
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

  const passwordHash = await bcrypt.hash(password, 10);
  const {tenant,user}=await db.transaction(async tx=>{
    const [created]=await tx.insert(tenantsTable).values({name:companyName.trim()}).returning();
    const slug=await ensureTenantSlug(created.id,tx);
    const [user]=await tx.insert(usersTable).values({tenantId:created.id,email:normalizedEmail,name:ownerName,role:"company_owner",passwordHash}).returning();
    return {tenant:{...created,slug},user};
  });

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
      timezone: tenant?.timezone ?? "UTC",
      planTier: tenant.planTier,
      avatarUrl: null,
      isActive: user.isActive,
      createdAt: user.createdAt.toISOString(),
    },
    token: `token-${user.id}`,
    sessionToken: rawToken,
  });
});

// Login — validates password (legacy seed users are available outside production only)
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
  if (!user || !user.isActive) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  // Never allow the legacy password-less seed credential in production.
  const valid = user.passwordHash === "mock"
    ? process.env.NODE_ENV !== "production"
    : await bcrypt.compare(password ?? "", user.passwordHash);

  if (!valid || await authBlocked(user.id)) {
    if(!valid)await authFailure(user.id);
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  const secondFactor=await verifySecondFactor(user.id,req.body.twoFactorCode);
  if(secondFactor!=="ok"){
    res.status(401).json({error:secondFactor==="required"?"Enter your authenticator code or an unused recovery code":"Invalid code or too many attempts. Please retry later.",mfaRequired:true});return;
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
      timezone: tenant?.timezone ?? "UTC",
      planTier: tenant?.planTier ?? "starter",
      avatarUrl: user.avatarUrl ?? null,
      isActive: user.isActive,
      createdAt: user.createdAt.toISOString(),
    },
    token: `token-${user.id}`,
    sessionToken: rawToken,
  });
});

router.post("/auth/remember-device", async (req, res): Promise<void> => {
  const session = await resolveStaffSession(req);
  const rawToken = getPresentedStaffToken(req);
  if (!session || !rawToken) {
    res.status(401).json({ error: "Valid staff session required" }); return;
  }
  const [activeUser] = await db.select({ id: usersTable.id }).from(usersTable).where(and(
    eq(usersTable.id, session.userId), eq(usersTable.tenantId, session.tenantId), eq(usersTable.isActive, true),
  ));
  if (!activeUser) {
    res.status(401).json({ error: "Staff account is inactive or not found" }); return;
  }
  // Include the validity condition in the write: an expiry or concurrent logout
  // must never be undone by remembering this device.
  const updated = await db.update(staffSessionsTable).set({ expiresAt: REMEMBERED_DEVICE_EXPIRY })
    .where(and(eq(staffSessionsTable.tokenHash, hashToken(rawToken)), gt(staffSessionsTable.expiresAt, new Date())))
    .returning({ id: staffSessionsTable.id });
  if (!updated.length) { res.status(401).json({ error: "Valid staff session required" }); return; }
  res.json({ remembered: true });
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  const rawToken = getPresentedStaffToken(req);
  if (!rawToken) {
    res.status(401).json({ error: "Valid staff session required" });
    return;
  }
  const deleted = await db.delete(staffSessionsTable)
    .where(eq(staffSessionsTable.tokenHash, hashToken(rawToken)))
    .returning({ id: staffSessionsTable.id });
  if (deleted.length === 0) {
    res.status(401).json({ error: "Valid staff session required" });
    return;
  }
  res.json({ success: true });
});

router.get("/auth/me", async (req, res): Promise<void> => {
  const session = await resolveStaffSession(req);
  if (!session) {
    res.status(401).json({ error: "Valid staff session required" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(and(
    eq(usersTable.id, session.userId),
    eq(usersTable.tenantId, session.tenantId),
    eq(usersTable.isActive, true),
  ));
  if (!user) {
    res.status(401).json({ error: "Staff account is inactive or not found" });
    return;
  }

  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, user.tenantId));

  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    tenantId: user.tenantId,
    timezone: tenant?.timezone ?? "UTC",
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
  const raw = getPresentedStaffToken(req);

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

export function getPresentedStaffToken(req: { headers: Record<string, string | string[] | undefined> }): string | undefined {
  const staffHeader = req.headers["x-staff-session"];
  const staffToken = Array.isArray(staffHeader) ? staffHeader[0] : staffHeader;
  if (staffToken) return staffToken;
  const authHeader = req.headers["authorization"];
  const auth = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice(7).trim();
    return token || undefined;
  }
  return undefined;
}

export default router;
