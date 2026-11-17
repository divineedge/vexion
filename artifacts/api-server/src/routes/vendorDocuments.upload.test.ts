import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { bytesFromDataUrl } from "../lib/vendorInvoiceIntake";

const state = vi.hoisted(() => ({
  admin: true,
  fileUrl: "",
  fileName: "",
  fileType: "pdf",
  calls: [] as string[],
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
      const dataUrl = strings.find(item => item.startsWith("data:"));
      if (dataUrl) {
        state.fileUrl = dataUrl;
        state.fileType = dataUrl.startsWith("data:application/pdf") ? "pdf" : "image";
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
app.use((error: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(error.status && error.status >= 400 ? error.status : 500).json({ error: error.message });
});

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

  it("rejects an invoice over 12 MB", async () => {
    const pdf = pdfBytes(12 * 1024 * 1024);
    const response = await request(app).post("/api/vendor-documents").attach("file", pdf, { filename: "huge.pdf", contentType: "application/pdf" });
    expect(response.status).toBe(413);
    expect(response.body.error).toMatch(/12 MB/);
    expect(state.fileUrl).toBe("");
  });
});
