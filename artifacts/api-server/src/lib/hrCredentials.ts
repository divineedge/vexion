import { db, hrDocumentsTable, hrSettingsTable, tenantsTable, usersTable, hrAccessTable, hrCredentialNoticesTable, taskNotificationsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { calendarDate, HrError, type HrDb } from "./hrAccess";
import { logger } from "./logger";

export function credentialInput(body: { credentialType?: unknown; expiresOn?: unknown }) {
  const credentialType = body.credentialType || null;
  if (credentialType !== null && credentialType !== "license" && credentialType !== "certificate")
    throw new HrError("Choose license or certificate");
  const expiresOn = calendarDate(body.expiresOn);
  if (expiresOn && !credentialType) throw new HrError("Expiration dates require a license or certificate");
  return { credentialType: credentialType as "license" | "certificate" | null, expiresOn };
}
export function warningDays(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 365)
    throw new HrError("Warning lead time must be a whole number from 0 to 365 days");
  return value;
}
export async function validatePriorCredential(tenantId: number, employeeId: number, priorId: number, credentialType: string | null, handle: HrDb) {
  const [prior] = await handle.select().from(hrDocumentsTable).where(and(eq(hrDocumentsTable.tenantId, tenantId), eq(hrDocumentsTable.id, priorId), eq(hrDocumentsTable.employeeId, employeeId))).for("update");
  if (!prior?.credentialType || prior.credentialType !== credentialType)
    throw new HrError("Choose a prior credential of the same type belonging to this employee");
  const [existing] = await handle.select({ id: hrDocumentsTable.id }).from(hrDocumentsTable).where(eq(hrDocumentsTable.renewsDocumentId, prior.id));
  if (existing) throw new HrError("This credential has already been renewed", 409);
  return prior;
}
export function credentialStatus(expiresOn: string | null, today: string, leadDays: number) {
  if (!expiresOn) return "no_expiration" as const;
  if (expiresOn < today) return "expired" as const;
  const cutoff = new Date(`${today}T12:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() + leadDays);
  return expiresOn <= cutoff.toISOString().slice(0, 10) ? "upcoming" as const : "current" as const;
}
export async function credentialContext(tenantId: number, handle: HrDb = db, now = new Date()) {
  const [tenant] = await handle.select({ timezone: tenantsTable.timezone }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  const [settings] = await handle.select().from(hrSettingsTable).where(eq(hrSettingsTable.tenantId, tenantId));
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tenant?.timezone ?? "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return { today: `${part("year")}-${part("month")}-${part("day")}`, warningDays: settings?.credentialWarningDays ?? 30 };
}
export async function credentialDocuments(tenantId: number, handle: HrDb = db) {
  const documents = await handle.select().from(hrDocumentsTable).where(eq(hrDocumentsTable.tenantId, tenantId));
  return documents.map(doc => ({
    ...doc, renewedByDocumentId: documents.find(next => next.renewsDocumentId === doc.id)?.id ?? null,
  }));
}

// Transactions + a database advisory lock prevent duplicate notices across server instances.
// These are private in-app notices only, never email/SMS or automated personnel actions.
export async function processCredentialReminders(handle: HrDb = db, now = new Date()) {
  const run = async (tx: HrDb) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(678001)`);
    const tenants = await tx.select({ id: tenantsTable.id }).from(tenantsTable);
    for (const tenant of tenants) {
      const context = await credentialContext(tenant.id, tx, now);
      const docs = await credentialDocuments(tenant.id, tx);
      const staff = await tx.select().from(usersTable).where(and(eq(usersTable.tenantId, tenant.id), eq(usersTable.isActive, true)));
      const grants = await tx.select().from(hrAccessTable).where(eq(hrAccessTable.tenantId, tenant.id));
      for (const doc of docs) {
        if (!doc.employeeId || !doc.credentialType || !doc.expiresOn || doc.renewedByDocumentId) continue;
        const phase = credentialStatus(doc.expiresOn, context.today, context.warningDays);
        if (phase !== "upcoming" && phase !== "expired") continue;
        const recipients = staff.filter(user => user.role === "company_owner" || grants.some(g => g.userId === user.id) || (doc.sharedWithEmployee && user.id === doc.employeeId));
        for (const user of recipients) {
          const [claim] = await tx.insert(hrCredentialNoticesTable).values({
            tenantId: tenant.id, documentId: doc.id, recipientUserId: user.id, expiresOn: doc.expiresOn, phase,
          }).onConflictDoNothing().returning();
          if (!claim) continue;
          const [notice] = await tx.insert(taskNotificationsTable).values({
            tenantId: tenant.id, recipientUserId: user.id, type: "hr_credential",
            message: `A license or certificate ${phase === "expired" ? "has expired" : "is due for renewal"}. Review the employee record. No employment action has been taken.`,
            linkPath: `/employees/${doc.employeeId}`,
          }).returning();
          await tx.update(hrCredentialNoticesTable).set({ notificationId: notice.id }).where(eq(hrCredentialNoticesTable.id, claim.id));
        }
      }
    }
  };
  if (handle === db) await db.transaction(run); else await run(handle);
}

// Enforce current grants/sharing at notification read time, not just at creation.
export const visibleCredentialNotice = (tenantId: number, actorId: number) => sql`(
 ${taskNotificationsTable.type} <> 'hr_credential' OR EXISTS (
 SELECT 1 FROM hr_credential_notices n
 JOIN hr_documents d ON d.id=n.document_id AND d.tenant_id=n.tenant_id
 JOIN users u ON u.id=${actorId} AND u.tenant_id=n.tenant_id AND u.is_active=true
 WHERE n.notification_id=${taskNotificationsTable.id} AND n.tenant_id=${tenantId}
 AND n.recipient_user_id=${actorId} AND d.expires_on=n.expires_on
 AND NOT EXISTS (SELECT 1 FROM hr_documents renewal WHERE renewal.renews_document_id=d.id)
 AND (u.role='company_owner' OR EXISTS(SELECT 1 FROM hr_access h WHERE h.tenant_id=n.tenant_id AND h.user_id=u.id)
 OR (d.employee_id=u.id AND d.shared_with_employee=true))
 ))`;

export function startCredentialReminderScheduler() {
  const run = () => void processCredentialReminders().catch(err => logger.error({ err }, "HR credential reminder scan failed"));
  run();
  const timer = setInterval(run, 60 * 60 * 1000);
  timer.unref();
}
