import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, tenantsTable, usersTable, hrAccessTable, hrDocumentsTable, hrSettingsTable, taskNotificationsTable } from "@workspace/db";
import { credentialContext, credentialDocuments, processCredentialReminders, validatePriorCredential, visibleCredentialNotice } from "./hrCredentials";

describe("private credential reminders and renewal evidence", () => {
  it("respects tenant dates, sharing, grants, deduplication and retained prior evidence", async () => {
    const rollback = new Error("Rollback HR credential fixtures");
    try {
      await db.transaction(async tx => {
        const [tenant] = await tx.insert(tenantsTable).values({ name: `Credential check ${randomUUID()}`, timezone: "America/Los_Angeles" }).returning();
        const make = async (role: string) => (await tx.insert(usersTable).values({ tenantId: tenant.id, name: role, email: `${randomUUID()}@example.invalid`, role, isActive: true }).returning())[0];
        const owner = await make("company_owner"), hr = await make("technician"), employee = await make("technician"), office = await make("office_manager");
        await tx.insert(hrAccessTable).values({ tenantId: tenant.id, userId: hr.id, grantedBy: owner.id });
        await tx.insert(hrSettingsTable).values({ tenantId: tenant.id, credentialWarningDays: 5 });
        const now = new Date("2026-10-13T02:00:00Z");
        expect(await credentialContext(tenant.id, tx, now)).toEqual({ today: "2026-10-12", warningDays: 5 });
        const create = async (expiresOn: string | null, extra = {}) => (await tx.insert(hrDocumentsTable).values({
          tenantId: tenant.id, employeeId: employee.id, title: "Private certificate", fileName: "evidence.pdf",
          mimeType: "application/pdf", sizeBytes: 5, objectPath: "/objects/hr-documents/test-only",
          credentialType: "certificate", expiresOn, uploadedBy: owner.id, ...extra,
        }).returning())[0];
        const prior = await create("2026-10-17");
        await create(null);
        await create("2026-10-18"); // Outside the company warning window.
        await processCredentialReminders(tx, now);
        const notices = () => tx.select().from(taskNotificationsTable).where(and(eq(taskNotificationsTable.tenantId, tenant.id), eq(taskNotificationsTable.type, "hr_credential")));
        expect((await notices()).map(n => n.recipientUserId).sort()).toEqual([owner.id, hr.id].sort());
        await processCredentialReminders(tx, now);
        expect(await notices()).toHaveLength(2);
        await tx.update(hrDocumentsTable).set({ sharedWithEmployee: true }).where(eq(hrDocumentsTable.id, prior.id));
        await processCredentialReminders(tx, now);
        expect((await notices()).map(n => n.recipientUserId)).toContain(employee.id);
        expect((await notices()).map(n => n.recipientUserId)).not.toContain(office.id);
        const visible = (userId: number) => tx.select().from(taskNotificationsTable).where(and(
          eq(taskNotificationsTable.tenantId, tenant.id), eq(taskNotificationsTable.recipientUserId, userId), visibleCredentialNotice(tenant.id, userId),
        ));
        expect(await visible(employee.id)).toHaveLength(1);
        await tx.update(hrDocumentsTable).set({ sharedWithEmployee: false }).where(eq(hrDocumentsTable.id, prior.id));
        expect(await visible(employee.id)).toHaveLength(0);
        await tx.delete(hrAccessTable).where(eq(hrAccessTable.userId, hr.id));
        expect(await visible(hr.id)).toHaveLength(0);
        await expect(validatePriorCredential(tenant.id, office.id, prior.id, "certificate", tx)).rejects.toThrow("this employee");
        await expect(validatePriorCredential(tenant.id, employee.id, prior.id, "license", tx)).rejects.toThrow("same type");
        await expect(validatePriorCredential(tenant.id + 99999, employee.id, prior.id, "certificate", tx)).rejects.toThrow("this employee");
        await validatePriorCredential(tenant.id, employee.id, prior.id, "certificate", tx);
        const renewal = await create("2027-10-17", { renewsDocumentId: prior.id });
        await expect(validatePriorCredential(tenant.id, employee.id, prior.id, "certificate", tx)).rejects.toThrow("already been renewed");
        const [saved] = await tx.select().from(hrDocumentsTable).where(eq(hrDocumentsTable.id, prior.id));
        expect(saved.expiresOn).toBe("2026-10-17");
        expect(saved.objectPath).toBe(prior.objectPath);
        expect((await credentialDocuments(tenant.id, tx)).find(d => d.id === prior.id)?.renewedByDocumentId).toBe(renewal.id);
        expect(await visible(owner.id)).toHaveLength(0);
        await processCredentialReminders(tx, now);
        expect(await notices()).toHaveLength(3);
        const expired = await create("2026-10-11", { sharedWithEmployee: true });
        await processCredentialReminders(tx, now);
        expect((await visible(employee.id))[0].message).toContain("has expired");
        expect((await notices()).filter(n => n.message.includes("has expired"))).toHaveLength(2);
        const [employeeAfter] = await tx.select().from(usersTable).where(eq(usersTable.id, employee.id));
        expect(employeeAfter.isActive).toBe(true);
        expect(expired.expiresOn).toBe("2026-10-11");
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
  });
});
