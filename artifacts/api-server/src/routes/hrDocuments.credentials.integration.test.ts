import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import type { HrDb } from "../lib/hrAccess";

const state = vi.hoisted(() => ({ tx: null as unknown, tenantId: 0, actorId: 0, path: 0 }));
vi.mock("@workspace/db", async importOriginal => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: new Proxy(actual.db, {
      get(target, prop) {
        if (!state.tx) return Reflect.get(target, prop);
        if (prop === "transaction") return async (fn: (tx: unknown) => unknown) => fn(state.tx);
        const value = Reflect.get(state.tx as object, prop);
        return typeof value === "function" ? value.bind(state.tx) : value;
      },
    }),
  };
});
vi.mock("../lib/tenantHelper", () => ({ getTenantId: () => state.tenantId, getUserId: () => state.actorId }));
vi.mock("../lib/hrFiles", async importOriginal => {
  const actual = await importOriginal<typeof import("../lib/hrFiles")>();
  return { ...actual, hrStorage: { saveHrDocument: async () => `/objects/hr-documents/rollback-${++state.path}`, deleteObjectEntity: async () => {} } };
});

import { db, hrDocumentsTable, hrAuditTable, tenantsTable, usersTable } from "@workspace/db";
import router from "./hrDocuments";
import { HrError } from "../lib/hrAccess";

describe("credential upload and metadata endpoints", () => {
  it("keeps prior files and expiration dates, audits renewal, and rejects other staff and cross-employee evidence", async () => {
    const app = express();
    app.use(express.json(), router);
    app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(err instanceof HrError ? err.status : 500).json({ error: err.message });
    });
    const rollback = new Error("Rollback document endpoint fixtures");
    try {
      await db.transaction(async tx => {
        state.tx = tx as HrDb;
        const [tenant] = await tx.insert(tenantsTable).values({ name: `Credential route check ${randomUUID()}` }).returning();
        state.tenantId = tenant.id;
        const make = async (role: string) => (await tx.insert(usersTable).values({ tenantId: tenant.id, role, name: role, email: `${randomUUID()}@example.invalid`, isActive: true }).returning())[0];
        const owner = await make("company_owner"), employee = await make("technician"), office = await make("office_manager");
        state.actorId = owner.id;
        const upload = (fields: Record<string, string>, employeeId = employee.id) => {
          let req = request(app).post(`/hr/employees/${employeeId}/documents`);
          for (const [key, value] of Object.entries(fields)) req = req.field(key, value);
          return req.attach("file", Buffer.from("%PDF-1.4\nrollback evidence"), { filename: "certificate.pdf", contentType: "application/pdf" });
        };
        const first = await upload({ title: "Original certificate", credentialType: "certificate", expiresOn: "2026-11-01" });
        expect(first.status).toBe(201);
        expect(first.body.objectPath).toBeUndefined();
        expect(first.body.sharedWithEmployee).toBe(false);
        const renewal = await upload({ title: "Renewed certificate", credentialType: "certificate", expiresOn: "2027-11-01", renewsDocumentId: String(first.body.id) });
        expect(renewal.status).toBe(201);
        expect(renewal.body.renewsDocumentId).toBe(first.body.id);
        expect(renewal.body.sharedWithEmployee).toBe(false);
        const [original] = await tx.select().from(hrDocumentsTable).where(eq(hrDocumentsTable.id, first.body.id));
        const [next] = await tx.select().from(hrDocumentsTable).where(eq(hrDocumentsTable.id, renewal.body.id));
        expect(original.expiresOn).toBe("2026-11-01");
        expect(original.objectPath).not.toBe(next.objectPath);
        const audits = await tx.select().from(hrAuditTable).where(and(eq(hrAuditTable.tenantId, tenant.id), eq(hrAuditTable.action, "hr_credential_renewed")));
        expect(audits).toHaveLength(1);
        expect(audits[0].before).toEqual({ priorDocumentId: original.id });
        expect((audits[0].after as {documentId: number}).documentId).toBe(next.id);
        expect((await upload({ credentialType: "certificate", renewsDocumentId: String(original.id) })).status).toBe(409);
        expect((await request(app).patch(`/hr/documents/${original.id}/credential`).send({ credentialType: "certificate", expiresOn: "2028-01-01" })).status).toBe(400);
        expect((await upload({ credentialType: "certificate", renewsDocumentId: String(next.id) }, office.id)).status).toBe(400);
        const plain = await upload({});
        expect(plain.status).toBe(201);
        expect((await request(app).patch(`/hr/documents/${plain.body.id}/credential`).send({ credentialType: "license", expiresOn: "2026-12-01" })).status).toBe(200);
        expect((await request(app).patch(`/hr/documents/${plain.body.id}/credential`).send({ credentialType: "license", expiresOn: "2026-02-30" })).status).toBe(400);
        state.actorId = office.id;
        expect((await request(app).get("/hr/credentials")).status).toBe(403);
        expect((await request(app).put("/hr/credentials/settings").send({ warningDays: 90 })).status).toBe(403);
        expect((await upload({ credentialType: "license" })).status).toBe(403);
        state.actorId = employee.id;
        expect((await request(app).patch(`/hr/documents/${next.id}/credential`).send({ credentialType: "certificate" })).status).toBe(403);
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
    finally { state.tx = null; }
  });
});
