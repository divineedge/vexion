import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { DrizzleQueryError } from "drizzle-orm";

const INVOICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type Vendor = { id: number; name: string; is_draft: boolean };
type Line = { id: string; description: string; quantity: number; unit_price: number; total_price: number; bbox: Record<string, unknown> };

const state = vi.hoisted(() => ({
  hasDraftColumn: true,
  blockDraftDelete: false,
  vendors: [] as Vendor[],
  invoiceVendorId: 14 as number | null,
  vendorConfirmed: false,
  lines: [] as Line[],
  calls: [] as string[],
  deleted: [] as number[],
}));

function readQuery(query: unknown): { text: string; params: unknown[] } {
  const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
  let text = "";
  const params: unknown[] = [];
  for (const chunk of chunks) {
    const name = chunk && typeof chunk === "object" ? chunk.constructor?.name : "";
    if (name === "StringChunk") text += ((chunk as { value?: string[] }).value ?? []).join("");
    else if (chunk instanceof String || chunk instanceof Number || chunk instanceof Boolean) params.push(chunk.valueOf());
    else params.push(chunk);
  }
  return { text, params };
}

function columnMissing(query: string, params: unknown[]): never {
  throw new DrizzleQueryError(query, params, Object.assign(new Error('column "is_draft" does not exist'), { code: "42703" }));
}

function referencedDraftDelete(params: unknown[]): never {
  throw new DrizzleQueryError(
    "DELETE FROM vendors WHERE id=$1 AND tenant_id=$2 AND is_draft=true",
    params,
    Object.assign(new Error('update or delete on table "vendors" violates foreign key constraint "vendor_invoice_records_vendor_id_fkey"'), { code: "23503" }),
  );
}

const db = vi.hoisted(() => {
  const execute = async (query: unknown) => {
    const { text, params } = readQuery(query);
    state.calls.push(text);
    const usesDraftColumn = /\bis_draft\b/.test(text) && !text.includes("information_schema");
    if (!state.hasDraftColumn && usesDraftColumn) columnMissing(text, params);
    if (text.includes("information_schema.columns") && text.includes("is_draft")) {
      return { rows: state.hasDraftColumn ? [{ present: 1 }] : [] };
    }
    if (text.includes("SELECT * FROM vendor_invoice_records")) {
      return { rows: [{
        id: INVOICE,
        vendor_id: state.invoiceVendorId,
        vendor_confirmed: state.vendorConfirmed,
        document_id: "doc-1",
        invoice_number: "480584",
        invoice_date: "2026-03-19",
        total_amount: 40,
        tax_amount: 0,
        shipping_amount: 0,
        payment_status: "unpaid",
      }] };
    }
    if (text.startsWith("SELECT id FROM vendor_invoice_line_items")) {
      return { rows: state.lines.map(line => ({ id: line.id })) };
    }
    if (text.includes("FROM vendor_invoice_line_items") && text.includes("description")) {
      const line = state.lines.find(item => item.id === params[0]);
      return { rows: line ? [line] : [] };
    }
    if (text.includes('AS "unitPrice"')) {
      return { rows: state.lines.map(line => ({
        id: line.id,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unit_price,
        totalPrice: line.total_price,
        destinationType: "overhead",
        destinationId: null,
        fillDate: null,
        bbox: line.bbox,
      })) };
    }
    if (text.includes('AS "fileUrl"')) {
      return { rows: [{
        id: INVOICE,
        documentId: "doc-1",
        vendorId: state.invoiceVendorId,
        draftVendorName: null,
        invoiceNumber: "480584",
        invoiceDate: "2026-03-19",
        totalAmount: 40,
        taxAmount: 0,
        shippingAmount: 0,
        paymentStatus: "unpaid",
        vendorConfirmed: state.vendorConfirmed,
        fileUrl: "data:application/pdf;base64,QQ==",
        fileName: "invoice.pdf",
        fileType: "pdf",
        processedStatus: state.vendorConfirmed ? "processed" : "pending",
      }] };
    }
    if (text.startsWith("DELETE FROM vendors")) {
      const id = Number(params[0]);
      const vendor = state.vendors.find(item => item.id === id);
      if (!text.includes("is_draft=true")) throw new Error(`refusing to delete vendor ${id} without a draft guard`);
      if (!vendor || vendor.is_draft !== true) return { rows: [] };
      if (state.invoiceVendorId === id || state.blockDraftDelete) referencedDraftDelete(params);
      state.vendors = state.vendors.filter(item => item.id !== id);
      state.deleted.push(id);
      return { rows: [] };
    }
    if (text.startsWith("SELECT id FROM vendors") || text.startsWith("SELECT id, is_draft FROM vendors") || text.startsWith("SELECT is_draft FROM vendors")) {
      const vendor = state.vendors.find(item => item.id === Number(params[0]));
      if (!vendor) return { rows: [] };
      return { rows: [{ id: vendor.id, is_draft: state.hasDraftColumn ? vendor.is_draft : false }] };
    }
    if (text.includes("FROM vendors")) {
      return { rows: state.vendors.map(vendor => ({ id: vendor.id, name: vendor.name, isDraft: state.hasDraftColumn ? vendor.is_draft : false })) };
    }
    if (text.startsWith("UPDATE vendors SET name=")) {
      const vendor = state.vendors.find(item => item.id === Number(params[1]));
      if (vendor?.is_draft) vendor.name = String(params[0]);
      return { rows: [] };
    }
    if (text.includes("SET is_draft=false")) {
      const vendor = state.vendors.find(item => item.id === Number(params[0]));
      if (vendor) vendor.is_draft = false;
      return { rows: [] };
    }
    if (text.startsWith("UPDATE vendor_invoice_line_items")) return { rows: [] };
    if (text.startsWith("UPDATE vendor_invoice_records")) {
      state.invoiceVendorId = Number(params[0]);
      state.vendorConfirmed = true;
      return { rows: [] };
    }
    if (text.startsWith("UPDATE document_uploads")) return { rows: [] };
    if (text.startsWith("INSERT INTO expense_entries")) return { rows: [] };
    if (text.includes("FROM vendor_invoice_records WHERE company_id=")) {
      return { rows: state.invoiceVendorId === Number(params[1]) ? [{ referenced: 1 }] : [] };
    }
    if (text.includes("FROM bulk_fuel_tanks") || text.includes("FROM jobs") || text.includes("FROM inventory_items") || text.startsWith("SAVEPOINT") || text.startsWith("RELEASE SAVEPOINT") || text.startsWith("ROLLBACK TO SAVEPOINT")) {
      return { rows: [] };
    }
    throw new Error(`unexpected query: ${text}`);
  };
  return {
    execute,
    transaction: async (fn: (tx: { execute: typeof execute }) => Promise<void>) => {
      await fn({ execute });
    },
  };
});

vi.mock("../lib/tenantHelper", () => ({ getTenantId: () => 1, getUserId: () => 2 }));
vi.mock("../lib/roles", () => ({ isAdminRole: async () => true }));
vi.mock("@workspace/db", () => ({ db }));

import router from "./vendorDocuments";

const app = express();
app.use(express.json());
app.use("/api", router);

function parts(): Line[] {
  return ["1-1/4 F", "401-01", "402-H", "429-0"].map((description, index) => ({
    id: `4444444${index}-4444-4444-8444-444444444444`,
    description,
    quantity: 1,
    unit_price: 10,
    total_price: 10,
    bbox: {},
  }));
}

function post(vendorId: number) {
  return request(app).post(`/api/vendor-documents/${INVOICE}/commit`).send({
    vendorConfirmed: true,
    vendorId,
    vendorName: "Great Basin Turf Products",
    invoiceNumber: "480584",
    invoiceDate: "2026-03-19",
    totalAmount: 40,
    taxAmount: 0,
    shippingAmount: 0,
    paymentStatus: "unpaid",
    lines: state.lines.map(line => ({
      id: line.id,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unit_price,
      totalPrice: line.total_price,
      destinationType: "overhead",
    })),
  });
}

describe("vendor invoice post", () => {
  beforeEach(() => {
    state.hasDraftColumn = true;
    state.blockDraftDelete = false;
    state.vendors = [
      { id: 14, name: "Great Basin Turf Products", is_draft: true },
      { id: 22, name: "Existing Supply", is_draft: false },
    ];
    state.invoiceVendorId = 14;
    state.vendorConfirmed = false;
    state.lines = parts();
    state.calls = [];
    state.deleted = [];
  });

  it("saves the invoice when cleanup would delete a draft that the invoice still references", async () => {
    const response = await post(22);
    expect(response.status, response.body.error).toBe(200);
    expect(response.body.vendorConfirmed).toBe(true);
    expect(response.body.vendorId).toBe(22);
    expect(state.invoiceVendorId).toBe(22);
    expect(state.deleted).toEqual([14]);
    expect(state.vendors.map(vendor => vendor.id)).toEqual([22]);
    const updateAt = state.calls.findIndex(call => call.startsWith("UPDATE vendor_invoice_records"));
    const deleteAt = state.calls.findIndex(call => call.startsWith("DELETE FROM vendors"));
    expect(updateAt).toBeGreaterThan(-1);
    expect(deleteAt).toBeGreaterThan(updateAt);
    expect(state.calls.some(call => call.includes("DELETE FROM vendors") && !call.includes("is_draft=true"))).toBe(false);
  });

  it("does not delete a real vendor when the confirmed vendor is different", async () => {
    state.vendors[0].is_draft = false;
    const response = await post(22);
    expect(response.status, response.body.error).toBe(200);
    expect(response.body.vendorId).toBe(22);
    expect(state.deleted).toEqual([]);
    expect(state.vendors.map(vendor => vendor.id).sort()).toEqual([14, 22]);
    expect(state.calls.some(call => call.startsWith("DELETE FROM vendors"))).toBe(false);
  });

  it("promotes the confirmed draft vendor instead of deleting it", async () => {
    const response = await post(14);
    expect(response.status, response.body.error).toBe(200);
    expect(response.body.vendorId).toBe(14);
    expect(state.deleted).toEqual([]);
    expect(state.vendors.find(vendor => vendor.id === 14)?.is_draft).toBe(false);
  });

  it("posts when vendors.is_draft is not in the database yet", async () => {
    state.hasDraftColumn = false;
    const response = await post(22);
    expect(response.status, response.body.error).toBe(200);
    expect(response.body.vendorId).toBe(22);
    expect(response.body.vendorConfirmed).toBe(true);
    expect(state.deleted).toEqual([]);
    expect(state.vendors.map(vendor => vendor.id).sort()).toEqual([14, 22]);
    expect(state.calls.some(call => call.startsWith("DELETE FROM vendors"))).toBe(false);
    expect(state.calls.some(call => /\bis_draft\b/.test(call) && !call.includes("information_schema"))).toBe(false);
  });

  it("still posts when draft cleanup hits a foreign key", async () => {
    state.blockDraftDelete = true;
    const response = await post(22);
    expect(response.status, response.body.error).toBe(200);
    expect(response.body.vendorConfirmed).toBe(true);
    expect(state.invoiceVendorId).toBe(22);
    expect(state.deleted).toEqual([]);
    expect(state.vendors.some(vendor => vendor.id === 14)).toBe(true);
  });
});
