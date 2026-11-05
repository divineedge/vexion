import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  customersTable,
  db,
  jobsTable,
  propertiesTable,
  staffSessionsTable,
  tenantsTable,
  usersTable,
} from "@workspace/db";
import {
  SANDBOX_DEMO_EMAIL,
  SANDBOX_DEMO_SLUG,
  SANDBOX_DEMO_TIMEZONE,
  tenantDayBounds,
} from "./sandboxDemoCalendar";

export { SANDBOX_DEMO_EMAIL, SANDBOX_DEMO_SESSION_MS, SANDBOX_DEMO_SLUG, SANDBOX_DEMO_TIMEZONE } from "./sandboxDemoCalendar";

const SANDBOX_CUSTOMER_EMAIL = "customer@sandbox.invalid";
const MAX_DEMO_SESSIONS = 25;

/**
 * Reuse one sandbox business and field technician. Visitors do not register;
 * each visit only receives a short-lived session for that existing identity.
 */
export async function ensureSandboxDemoAccount() {
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('field-app-sandbox-demo'))`);
    let [tenant] = await tx.select().from(tenantsTable).where(eq(tenantsTable.slug, SANDBOX_DEMO_SLUG)).limit(1);
    if (!tenant) {
      [tenant] = await tx.insert(tenantsTable).values({
        name: "Sandbox Demo",
        slug: SANDBOX_DEMO_SLUG,
        timezone: SANDBOX_DEMO_TIMEZONE,
        planTier: "starter",
      }).returning();
    }

    let [user] = await tx.select().from(usersTable).where(sql`lower(${usersTable.email}) = ${SANDBOX_DEMO_EMAIL}`).limit(1);
    if (user && user.tenantId !== tenant.id) {
      throw Object.assign(new Error("Sandbox demo account belongs to another business"), { status: 409 });
    }
    const passwordIsLocked = Boolean(user && /^\$2[aby]\$\d\d\$/.test(user.passwordHash));
    if (!user) {
      const passwordHash = await bcrypt.hash(randomBytes(32).toString("hex"), 10);
      [user] = await tx.insert(usersTable).values({
        tenantId: tenant.id,
        email: SANDBOX_DEMO_EMAIL,
        name: "Demo Field Tech",
        role: "technician",
        passwordHash,
        isActive: true,
      }).returning();
    } else if (!user.isActive || user.role !== "technician" || !passwordIsLocked) {
      const passwordHash = passwordIsLocked
        ? user.passwordHash
        : await bcrypt.hash(randomBytes(32).toString("hex"), 10);
      [user] = await tx.update(usersTable).set({
        isActive: true,
        role: "technician",
        passwordHash,
      }).where(eq(usersTable.id, user.id)).returning();
    }

    const bounds = tenantDayBounds(tenant.timezone || SANDBOX_DEMO_TIMEZONE);
    const [openJob] = await tx.select({ id: jobsTable.id }).from(jobsTable).where(and(
      eq(jobsTable.tenantId, tenant.id),
      eq(jobsTable.assigneeId, user.id),
      inArray(jobsTable.status, ["scheduled", "in_progress"]),
      sql`${jobsTable.scheduledAt} >= ${bounds.start.toISOString()}::timestamptz`,
      sql`${jobsTable.scheduledAt} < ${bounds.end.toISOString()}::timestamptz`,
    )).limit(1);
    if (!openJob) {
      let [customer] = await tx.select().from(customersTable).where(and(
        eq(customersTable.tenantId, tenant.id),
        sql`lower(${customersTable.email}) = ${SANDBOX_CUSTOMER_EMAIL}`,
      )).limit(1);
      if (!customer) {
        [customer] = await tx.insert(customersTable).values({
          tenantId: tenant.id,
          name: "Sandbox Customer",
          email: SANDBOX_CUSTOMER_EMAIL,
          phone: "555-0100",
        }).returning();
      }
      let [property] = await tx.select().from(propertiesTable).where(and(
        eq(propertiesTable.tenantId, tenant.id),
        eq(propertiesTable.customerId, customer.id),
        eq(propertiesTable.address, "100 Sandbox Lane"),
      )).limit(1);
      if (!property) {
        [property] = await tx.insert(propertiesTable).values({
          tenantId: tenant.id,
          customerId: customer.id,
          address: "100 Sandbox Lane",
          city: "Denver",
          state: "CO",
          zip: "80202",
        }).returning();
      }
      await tx.insert(jobsTable).values({
        tenantId: tenant.id,
        customerId: customer.id,
        propertyId: property.id,
        assigneeId: user.id,
        title: "Sandbox lawn visit",
        description: "Sample visit in the shared sandbox demo tenant.",
        status: "scheduled",
        scheduledAt: new Date(),
        estimatedDuration: 60,
      });
    }

    return { tenant, user };
  });
}

/** Drop the oldest sandbox sessions so repeated demo clicks cannot grow without a bound. */
export async function trimSandboxDemoSessions(userId: number) {
  const rows = await db.select({ id: staffSessionsTable.id }).from(staffSessionsTable)
    .where(eq(staffSessionsTable.userId, userId))
    .orderBy(asc(staffSessionsTable.createdAt), asc(staffSessionsTable.id));
  if (rows.length <= MAX_DEMO_SESSIONS) return;
  const extra = rows.slice(0, rows.length - MAX_DEMO_SESSIONS).map(row => row.id);
  await db.delete(staffSessionsTable).where(inArray(staffSessionsTable.id, extra));
}
