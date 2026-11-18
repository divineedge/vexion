import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { DrizzleQueryError } from "drizzle-orm";

const state = vi.hoisted(() => ({
  admin: true,
  present: true,
  posted: 0,
  vendor: true,
  deleted: false,
  unlinked: false,
  fkOnDelete: false,
  calls: [] as string[],
}));

function readQuery(query: unknown): string {
  const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
  let text = "";
  for (const chunk of chunks) {
    const name = chunk && typeof chunk === "object" ? chunk.constructor?.name : "";
    if (name === "StringChunk") text += ((chunk as { value?: string[] }).value ?? []).join("");
  }
  return text;
}

function fkError(): never {
  const cause = Object.assign(new Error('update or delete on table "vendors" violates foreign key constraint "vendor_invoice_records_vendor_id_fkey"'), { code: "23503" });
  throw new DrizzleQueryError('delete from "vendors"', [], cause);
}

const db = vi.hoisted(() => {
  const execute = async (query: unknown) => {
    const text = readQuery(query);
    state.calls.push(text);
    if (/^(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)\b/.test(text)) return { rows: [] };
    if (text.includes("to_regclass")) return { rows: [{ present: state.present ? "vendor_invoice_records" : null }] };
    if (text.includes("vendor_confirmed IS TRUE")) return { rows: [{ count: state.posted }] };
    if (text.includes("count(*)")) return { rows: [{ count: state.posted }] };
    if (text.startsWith("UPDATE vendor_invoice_records")) {
      state.unlinked = true;
      return { rows: [] };
    }
    if (text.startsWith("UPDATE") || text.startsWith("DELETE FROM vendor_expense_defaults")) return { rows: [] };
    throw new Error(`unexpected query: ${text}`);
  };
  const select = () => {
    const rows = state.vendor ? [{ id: 5 }] : [];
    const builder = {
      from: () => builder,
      where: () => builder,
      for: () => Promise.resolve(rows),
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject),
    };
    return builder;
  };
  const remove = () => {
    const run = () => {
      if (state.fkOnDelete) fkError();
      state.deleted = true;
      return [{ id: 5 }];
    };
    const builder = {
      where: () => builder,
      returning: () => builder,
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve().then(run).then(resolve, reject),
    };
    return builder;
  };
  const database = {
    execute,
    select,
    delete: remove,
    transaction: async (fn: (tx: typeof database) => Promise<unknown>) => fn(database),
  };
  return database;
});

vi.mock("../lib/tenantHelper", () => ({ getTenantId: () => 1, getUserId: () => 2 }));
vi.mock("../lib/roles", () => ({ isAdminRole: async () => state.admin }));
vi.mock("@workspace/db", async () => {
  process.env.DATABASE_URL ??= "postgres://localhost:5432/unused";
  const actual = await vi.importActual<typeof import("@workspace/db")>("@workspace/db");
  return { ...actual, db };
});

import router from "./vendors";

const app = express();
app.use(express.json());
app.use("/api", router);

describe("vendor delete", () => {
  beforeEach(() => {
    state.admin = true;
    state.present = true;
    state.posted = 0;
    state.vendor = true;
    state.deleted = false;
    state.unlinked = false;
    state.fkOnDelete = false;
    state.calls = [];
  });

  it("deletes a vendor that posted invoices do not need", async () => {
    const response = await request(app).delete("/api/vendors/5");
    expect(response.status).toBe(204);
    expect(state.deleted).toBe(true);
    expect(state.unlinked).toBe(true);
    expect(response.text).not.toMatch(/failed query|violates foreign key/i);
  });

  it("deletes a vendor when invoice tables are not installed", async () => {
    state.present = false;
    const response = await request(app).delete("/api/vendors/5");
    expect(response.status).toBe(204);
    expect(state.deleted).toBe(true);
    expect(state.unlinked).toBe(false);
  });

  it("keeps a vendor that a posted invoice still needs and says why", async () => {
    state.posted = 2;
    const response = await request(app).delete("/api/vendors/5");
    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/2 posted invoices/);
    expect(response.body.error).toMatch(/not deleted/);
    expect(response.text).not.toMatch(/failed query|violates foreign key|vendor_invoice_records_vendor_id_fkey/i);
    expect(state.deleted).toBe(false);
    expect(state.unlinked).toBe(false);
  });

  it("explains a foreign key instead of returning the database error", async () => {
    state.fkOnDelete = true;
    const response = await request(app).delete("/api/vendors/5");
    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/still referenced by an invoice/);
    expect(response.text).not.toMatch(/failed query|violates foreign key|delete from/i);
    expect(state.deleted).toBe(false);
  });

  it("does not report success when the vendor is already gone", async () => {
    state.vendor = false;
    const response = await request(app).delete("/api/vendors/5");
    expect(response.status).toBe(404);
    expect(response.body.error).toMatch(/not found/i);
    expect(state.deleted).toBe(false);
  });
});
