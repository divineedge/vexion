import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { DrizzleQueryError } from "drizzle-orm";
import { bytesFromDataUrl } from "../lib/vendorInvoiceIntake";

const state = vi.hoisted(() => ({
  admin: true,
  fileUrl: "",
  fileName: "",
  fileType: "pdf",
  calls: [] as string[],
  lines: [] as Record<string, unknown>[],
  forceSchemaError: false,
}));

function stringsOf(value: unknown, found: string[] = [], seen = new Set<unknown>()): string[] {
  if (typeof value === "string") {
    found.push(value);
    return found;
  }
  if (!value || typeof value !== "object" || seen.has(value)) return found;
  seen.add(value);
  for (const nested of Object.values(value)) stringsOf(nested, found, seen);
  return found;
}

vi.mock("../lib/tenantHelper", () => ({ getTenantId: () => 1, getUserId: () => 2 }));
vi.mock("../lib/roles", () => ({ isAdminRole: async () => state.admin }));
vi.mock("@workspace/db", () => ({
  db: {
    execute: async (query: unknown) => {
      const strings = stringsOf(query);
      const text = strings.join("\n");
      state.calls.push(text);
      if (state.forceSchemaError) {
        state.forceSchemaError = false;
        const cause = Object.assign(new Error('column "current_gallons" does not exist'), { code: "42703" });
        throw new DrizzleQueryError("select tanks", [], cause);
      }
      // Jobs are ordered by scheduled_at. Sorting on scheduled_date is the production 500.
      if (text.includes("scheduled_date")) {
        const cause = Object.assign(new Error('column "scheduled_date" does not exist'), { code: "42703" });
        throw new DrizzleQueryError("select jobs", [], cause);
      }
      const dataUrl = strings.find(item => item.startsWith("data:"));
      if (dataUrl) {
        state.fileUrl = dataUrl;
        state.fileType = dataUrl.startsWith("data:application/pdf") ? "pdf" : "image";
      }
      if (text.includes("INSERT INTO vendor_invoice_line_items")) {
        const description = strings.find(item => item.length > 1 && !item.includes("INSERT") && !item.includes("SELECT") && !item.includes("VALUES") && !item.startsWith("{") && !item.startsWith("data:") && !/^[0-9a-f]{8}-/i.test(item) && !["inventory", "bulk_fuel", "equipment", "job_direct_expense", "overhead"].includes(item) && !/^[\s,()]+$/.test(item));
        if (description) {
          state.lines.push({
            id: strings.find(item => /^[0-9a-f]{8}-/i.test(item)) ?? "line",
            description,
            quantity: 1,
            unitPrice: 0,
            totalPrice: 0,
            destinationType: ["bulk_fuel", "job_direct_expense", "equipment", "overhead", "inventory"].find(item => strings.includes(item)) ?? "inventory",
            destinationId: strings.find(item => /^\d+$/.test(item)) ?? null,
            fillDate: null,
            bbox: {},
          });
        }
        return { rows: [] };
      }
      if (text.includes("FROM vendor_invoice_line_items")) return { rows: state.lines };
      if (text.includes("FROM inventory_items")) {
        return { rows: [
          { id: 9, name: "Mower blade", sku: "BLD-1", quantity: 4, unit: "each", unitPrice: 18 },
          { id: 10, name: "Unrelated hose", sku: "H-1", quantity: 1, unit: "each", unitPrice: 6 },
        ] };
      }
      if (text.includes("INSERT INTO vendors")) return { rows: [{ id: 4 }] };
      if (text.includes('AS "fileUrl"')) {
        const id = strings.find(item => /^[0-9a-f]{8}-/i.test(item)) ?? "11111111-1111-4111-8111-111111111111";
        return { rows: [{
          id, documentId: "doc", vendorId: 4, draftVendorName: "Acme Fuel", invoiceNumber: "A-14",
          invoiceDate: "2026-04-02", totalAmount: 362, taxAmount: 12, shippingAmount: 0,
          paymentStatus: "unpaid", vendorConfirmed: false, fileUrl: state.fileUrl,
          fileName: state.fileName || "invoice.pdf", fileType: state.fileType, processedStatus: "pending",
        }] };
      }
      if (text.includes("file_url") && text.includes("file_name") && !text.includes("INSERT")) {
        return { rows: state.fileUrl ? [{ file_url: state.fileUrl, file_name: state.fileName || "invoice.pdf", file_type: state.fileType }] : [] };
      }
      return { rows: [] };
    },
  },
}));

import router from "./vendorDocuments";

const app = express();
app.use(express.json());
app.use("/api", router);

const invoiceText = "Acme Fuel\nInvoice # A-14\nDate 2026-04-02\nDiesel clear 100 3.50 350.00\nTax $12.00\nTotal $362.00";

function pdfBytes(extra = 0): Buffer {
  return Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(extra, 0x20), Buffer.from("\n%%EOF")]);
}

describe("vendor invoice upload", () => {
  beforeEach(() => {
    state.admin = true;
    state.fileUrl = "";
    state.fileName = "";
    state.fileType = "pdf";
    state.calls = [];
    state.lines = [];
    state.forceSchemaError = false;
  });

  it("accepts a PDF larger than the JSON body limit and serves the stored bytes", async () => {
    const pdf = pdfBytes(120 * 1024);
    const jsonBody = { fileName: "invoice.pdf", fileType: "pdf", fileUrl: `data:application/pdf;base64,${pdf.toString("base64")}`, ocrText: invoiceText };
    const rejected = await request(app).post("/api/vendor-documents").send(jsonBody);
    expect(rejected.status).toBe(413);

    const created = await request(app)
      .post("/api/vendor-documents")
      .field("ocrText", invoiceText)
      .attach("file", pdf, { filename: "invoice.pdf", contentType: "application/pdf" });
    expect(created.status).toBe(201);
    expect(created.headers["content-type"]).toMatch(/json/);
    expect(created.text).not.toContain("<title>Error</title>");
    expect(created.text).not.toContain("Internal Server Error");
    expect(state.calls.some(call => call.includes("scheduled_at"))).toBe(true);
    expect(state.calls.some(call => call.includes("scheduled_date"))).toBe(false);
    expect(created.body.fileType).toBe("pdf");
    expect(created.body.fileUrl).toBe(`/api/vendor-documents/${created.body.id}/file`);
    expect(created.text.includes(pdf.toString("base64").slice(0, 80))).toBe(false);
    expect(state.calls.some(call => call.includes("Acme Fuel") && call.includes("A-14") && call.includes("Diesel clear"))).toBe(true);
    expect(bytesFromDataUrl(state.fileUrl)?.bytes.equals(pdf)).toBe(true);

    const file = await request(app).get(`/api/vendor-documents/${created.body.id}/file`);
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toMatch(/application\/pdf/);
    expect(Buffer.from(file.body).equals(pdf)).toBe(true);
  });

  it("still accepts a small JSON data URL and rejects files that are not invoices", async () => {
    const pdf = pdfBytes();
    const saved = await request(app).post("/api/vendor-documents").send({
      fileName: "invoice.pdf",
      fileType: "pdf",
      fileUrl: `data:application/pdf;base64,${pdf.toString("base64")}`,
      ocrText: invoiceText,
    });
    expect(saved.status).toBe(201);
    expect(saved.body.fileUrl).toBe(`/api/vendor-documents/${saved.body.id}/file`);

    const text = await request(app).post("/api/vendor-documents").attach("file", Buffer.from("this is a plain text file"), { filename: "notes.txt", contentType: "text/plain" });
    expect(text.status).toBe(400);
    expect(text.body.error).toMatch(/PDF or image/);

    state.admin = false;
    const denied = await request(app).post("/api/vendor-documents").attach("file", pdf, { filename: "invoice.pdf", contentType: "application/pdf" });
    expect(denied.status).toBe(403);
  });

  it("extracts parts from a PDF and a photo and matches an existing inventory part", async () => {
    const parts = "Acme Supply\nInvoice # INV-9\nDate 04/02/2026\nMower blade 2 18.00 36.00\n2 Oil filter $9.50 $19.00\nTax $4.00\nTotal $59.00";
    const pdf = Buffer.concat([
      Buffer.from("%PDF-1.4\n"),
      Buffer.from("(Mower blade) (2) (18.00) (36.00)\n"),
      Buffer.alloc(8 * 1024, 0x20),
      Buffer.from("\n%%EOF"),
    ]);
    const created = await request(app)
      .post("/api/vendor-documents")
      .field("ocrText", parts)
      .attach("file", pdf, { filename: "parts-invoice.pdf", contentType: "application/pdf" });
    expect(created.status).toBe(201);
    expect(created.headers["content-type"]).toMatch(/json/);
    expect(created.text).not.toContain("<title>Error</title>");
    const blade = created.body.lines.find((line: { description: string }) => line.description === "Mower blade");
    const filter = created.body.lines.find((line: { description: string }) => line.description === "Oil filter");
    expect(blade).toMatchObject({ destinationType: "inventory", destinationId: "9" });
    expect(filter).toMatchObject({ destinationType: "inventory", destinationId: null });
    expect(created.body.items.map((item: { name: string }) => item.name)).toEqual(["Mower blade", "Unrelated hose"]);

    state.lines = [];
    const photo = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]);
    const image = await request(app)
      .post("/api/vendor-documents")
      .field("ocrText", parts)
      .attach("file", photo, { filename: "invoice.jpg", contentType: "image/jpeg" });
    expect(image.status).toBe(201);
    expect(image.body.fileType).toBe("image");
    expect(image.body.lines.map((line: { description: string }) => line.description)).toEqual(expect.arrayContaining(["Mower blade", "Oil filter"]));
    expect(image.text).not.toContain("Internal Server Error");
  });

  it("returns JSON instead of an HTML error page when a schema error is wrapped", async () => {
    state.forceSchemaError = true;
    const response = await request(app)
      .post("/api/vendor-documents")
      .attach("file", pdfBytes(), { filename: "invoice.pdf", contentType: "application/pdf" })
      .field("ocrText", invoiceText);
    expect(response.status).toBe(503);
    expect(response.headers["content-type"]).toMatch(/json/);
    expect(response.body.error).toMatch(/not ready/);
    expect(response.text).not.toContain("<title>Error</title>");
  });

  it("rejects an invoice over 12 MB", async () => {
    const pdf = pdfBytes(12 * 1024 * 1024);
    const response = await request(app).post("/api/vendor-documents").attach("file", pdf, { filename: "huge.pdf", contentType: "application/pdf" });
    expect(response.status).toBe(413);
    expect(response.body.error).toMatch(/12 MB/);
    expect(state.fileUrl).toBe("");
  });
});
