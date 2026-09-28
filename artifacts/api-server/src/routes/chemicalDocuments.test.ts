import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const state = vi.hoisted(() => ({
  products: [{ id: 7, tenantId: 1 }],
  documents: [] as any[], objects: new Map<string, Buffer>(),
  role: "company_owner", failInsert: false, failCleanup: false,
  signed: vi.fn(), cleanup: vi.fn(), log: vi.fn(),
}));
vi.mock("drizzle-orm", () => ({
  eq: (column: string, value: unknown) => (row: any) => row[column] === value,
  inArray: (column: string, values: unknown[]) => (row: any) => values.includes(row[column]),
  and: (...conditions: any[]) => (row: any) => conditions.every(c => c(row)),
}));
vi.mock("@workspace/db", () => {
  const products = { name: "products", id: "id", tenantId: "tenantId" };
  const documents = new Proxy({ name: "documents" }, { get: (target: any, key: string) => target[key] ?? key });
  const rows = (table: any) => table.name === "products" ? state.products : state.documents;
  const db: any = {
    select: () => ({
      from: (table: any) => ({
        where: (predicate: any) => {
          const result = rows(table).filter(predicate);
          return { limit: async () => result, orderBy: async () => result, for: async () => result };
        },
      }),
    }),
    insert: () => ({
      values: (value: any) => ({
        returning: async () => {
          if (state.failInsert) throw new Error("Database unavailable");
          const saved = { id: 1, ...value, createdAt: new Date("2026-01-01") };
          state.documents.push(saved);
          return [saved];
        },
      }),
    }),
    delete: () => ({
      where: async (predicate: any) => { state.documents = state.documents.filter(row => !predicate(row)); },
    }),
    transaction: (callback: any) => callback(db),
  };
  return { db, chemicalProductsTable: products, mediaAttachmentsTable: documents };
});
vi.mock("../lib/verifiedStaff", () => ({
  requireVerifiedStaff: (req: any, res: any, next: any) => {
    if (req.headers["x-portal-token"]) return res.status(403).json({ error: "Portal denied" });
    const match = /^Bearer staff-(1|2)$/.exec(req.headers.authorization ?? "");
    if (!match) return res.status(401).json({ error: "Session required" });
    res.locals.staffTenantId = Number(match[1]);
    res.locals.staffUserId = 9;
    next();
  },
  verifiedStaffIdentity: (res: any) => ({ tenantId: res.locals.staffTenantId, userId: res.locals.staffUserId }),
}));
vi.mock("../lib/roles", () => ({ getCallerRole: async () => state.role }));
vi.mock("../lib/objectStorage", () => ({
  ObjectStorageService: class {
    async savePrivatePdf(bytes: Buffer) {
      state.objects.set("/objects/chemical-documents/test", Buffer.from(bytes));
      return "/objects/chemical-documents/test";
    }
    async deleteObjectEntity(key: string) {
      state.cleanup(key);
      if (state.failCleanup) throw new Error("Storage unavailable");
      state.objects.delete(key);
    }
    async getObjectEntityFile(key: string) {
      if (!state.objects.has(key)) throw new Error("Not found");
      return {};
    }
    async generateSignedReadUrl(key: string, ttl: number) {
      state.signed(key, ttl);
      return "https://private.example/signed?expires=60";
    }
  },
}));

import router, { sanitizeChemicalDocumentName } from "./chemicalDocuments";
const app = express();
app.use((req, _res, next) => { (req as any).log = { error: state.log }; next(); });
app.use(router);
const base = "/chemical-products/7/documents";
const pdf = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF");
const upload = (bytes = pdf, tenant = 1, type = "sds") => request(app).post(base)
  .set("Authorization", `Bearer staff-${tenant}`).field("documentType", type)
  .attach("file", bytes, { filename: "Safety sheet.pdf", contentType: "application/pdf" });

describe("chemical PDF document routes", () => {
  beforeEach(() => {
    state.products = [{ id: 7, tenantId: 1 }];
    state.documents = [];
    state.objects.clear();
    state.role = "company_owner";
    state.failInsert = false;
    state.failCleanup = false;
    vi.clearAllMocks();
  });

  it("persists private bytes and sanitized metadata, then lists after a separate request", async () => {
    const response = await upload();
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ id: 1, documentType: "sds", fileName: "Safety sheet.pdf", sizeBytes: pdf.length, createdAt: "2026-01-01T00:00:00.000Z" });
    expect(state.documents[0]).toMatchObject({ tenantId: 1, entityId: 7, entityType: "chemical_sds", mimeType: "application/pdf", createdBy: 9 });
    expect(state.objects.get(state.documents[0].fileKey)).toEqual(pdf);
    expect((await request(app).get(base).set("Authorization", "Bearer staff-1")).body).toEqual([response.body]);
    expect(sanitizeChemicalDocumentName("C:\\unsafe\\safe\u0000\n.pdf")).toBe("safe.pdf");
  });

  it.each(["company_owner", "office_manager", "department_manager"])("allows %s uploads", async role => {
    state.role = role;
    expect((await upload(pdf, 1, "msds")).status).toBe(201);
    expect(state.documents[0].entityType).toBe("chemical_msds");
  });

  it.each(["technician", "crew_manager", "unknown"])("rejects %s mutations but allows reads", async role => {
    state.role = role;
    expect((await upload()).status).toBe(403);
    expect((await request(app).delete(`${base}/1`).set("Authorization", "Bearer staff-1")).status).toBe(403);
    expect((await request(app).get(base).set("Authorization", "Bearer staff-1")).status).toBe(200);
  });

  it("rejects spoofed identity headers, expired/missing sessions and portal access", async () => {
    expect((await request(app).get(base).set("x-tenant-id", "1").set("x-user-id", "9")).status).toBe(401);
    expect((await request(app).get(base).set("Authorization", "Bearer expired")).status).toBe(401);
    expect((await request(app).get(base).set("x-portal-token", "portal")).status).toBe(403);
  });

  it("isolates tenants and verifies document type/product on reads and deletion", async () => {
    await upload();
    expect((await upload(pdf, 2)).status).toBe(404);
    for (const method of ["get", "post", "delete"] as const) {
      const path = method === "get" ? base : `${base}/1${method === "post" ? "/read-url" : ""}`;
      expect((await request(app)[method](path).set("Authorization", "Bearer staff-2")).status).toBe(404);
    }
    for (const change of [{ entityId: 8 }, { entityType: "property" }, { tenantId: 2 }]) {
      const original = { ...state.documents[0] };
      Object.assign(state.documents[0], change);
      expect((await request(app).post(`${base}/1/read-url`).set("Authorization", "Bearer staff-1")).status).toBe(404);
      expect((await request(app).delete(`${base}/1`).set("Authorization", "Bearer staff-1")).status).toBe(404);
      state.documents[0] = original;
    }
  });

  it("rejects invalid, empty, missing, oversized PDFs and invalid document types", async () => {
    expect((await upload(Buffer.from("not a PDF"))).status).toBe(400);
    expect((await upload(Buffer.alloc(0))).status).toBe(400);
    expect((await upload(pdf, 1, "other")).status).toBe(400);
    expect((await request(app).post(base).set("Authorization", "Bearer staff-1")).status).toBe(400);
    expect((await upload(Buffer.concat([pdf, Buffer.alloc(20 * 1024 * 1024)]))).status).toBe(413);
    expect(state.objects.size).toBe(0);
  });

  it("issues short signed URLs and rejects orphaned products", async () => {
    await upload();
    const response = await request(app).post(`${base}/1/read-url`).set("Authorization", "Bearer staff-1");
    expect(response.status).toBe(200);
    expect(response.body.url).toContain("signed");
    expect(state.signed).toHaveBeenCalledWith(state.documents[0].fileKey, 60);
    state.products = [];
    expect((await request(app).post(`${base}/1/read-url`).set("Authorization", "Bearer staff-1")).status).toBe(404);
  });

  it("deletes metadata and bytes, immediately denying later reads", async () => {
    await upload();
    expect((await request(app).delete(`${base}/1`).set("Authorization", "Bearer staff-1")).status).toBe(204);
    expect(state.objects.size).toBe(0);
    expect((await request(app).post(`${base}/1/read-url`).set("Authorization", "Bearer staff-1")).status).toBe(404);
  });

  it("cleans up private bytes when metadata save fails", async () => {
    state.failInsert = true;
    expect((await upload()).status).toBe(500);
    expect(state.cleanup).toHaveBeenCalledOnce();
    expect(state.objects.size).toBe(0);
    expect(state.documents).toHaveLength(0);
  });

  it("logs cleanup failure without resurrecting deleted permission", async () => {
    await upload();
    state.failCleanup = true;
    expect((await request(app).delete(`${base}/1`).set("Authorization", "Bearer staff-1")).status).toBe(204);
    expect(state.log).toHaveBeenCalled();
    expect(state.documents).toHaveLength(0);
    expect((await request(app).post(`${base}/1/read-url`).set("Authorization", "Bearer staff-1")).status).toBe(404);
  });
});