import { describe, expect, it } from "vitest";
import { bytesFromDataUrl, detectInvoiceFile, extractInvoiceText, fuelCapacityCheck, invoiceDataUrl, matchVendor, MAX_VENDOR_INVOICE_BYTES, rollingAverageCost, sanitizeUploadName } from "./vendorInvoiceIntake";

describe("vendor invoice intake", () => {
  it("auto-selects a close vendor and leaves an unknown name for approval", () => {
    const vendors = [{ id: 4, name: "Horizon Fuel Co." }, { id: 9, name: "Summit Irrigation" }];
    expect(matchVendor("Horizon Fuel Company", vendors).confident).toBe(true);
    expect(matchVendor("Horizon Fuel Company", vendors).vendorId).toBe(4);
    const unknown = matchVendor("Brand New Supply", vendors);
    expect(unknown.confident).toBe(false);
  });

  it("reads invoice fields and fuel lines from text", () => {
    const invoice = extractInvoiceText("Acme Fuel\nInvoice # A-14\nDate 2026-04-02\nDiesel clear 100 3.50 350.00\nTax $12.00\nTotal $362.00");
    expect(invoice.vendorName).toBe("Acme Fuel");
    expect(invoice.invoiceNumber).toBe("A-14");
    expect(invoice.invoiceDate).toBe("2026-04-02");
    expect(invoice.lines[0].destinationType).toBe("bulk_fuel");
    expect(invoice.totalAmount).toBe(362);
  });

  it("drops null bytes that PostgreSQL would reject in the stored invoice", () => {
    const invoice = extractInvoiceText("Acme Fuel\u0000\nInvoice # A-14\nDate 2026-04-02\nTotal $10.00");
    expect(invoice.vendorName).toBe("Acme Fuel");
    expect(JSON.stringify(invoice)).not.toContain("\\u0000");
  });

  it("recognizes invoice photos and PDFs and round-trips the stored data URL", () => {
    const pdf = Buffer.from("%PDF-1.4\ntrailer\n%%EOF");
    expect(detectInvoiceFile(pdf)).toEqual({ kind: "pdf", contentType: "application/pdf" });
    expect(detectInvoiceFile(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toEqual({ kind: "image", contentType: "image/jpeg" });
    const heic = Buffer.concat([Buffer.alloc(4), Buffer.from("ftypheic")]);
    expect(detectInvoiceFile(heic)?.contentType).toBe("image/heic");
    expect(detectInvoiceFile(Buffer.from("not an invoice"))).toBeNull();
    expect(detectInvoiceFile(Buffer.concat([pdf, Buffer.alloc(MAX_VENDOR_INVOICE_BYTES)]))).toBeNull();
    const stored = invoiceDataUrl("application/pdf", pdf);
    expect(bytesFromDataUrl(stored)?.bytes.equals(pdf)).toBe(true);
    expect(sanitizeUploadName("../Invoice\u0000.pdf")).toBe("Invoice.pdf");
  });

  it("blocks a delivery that does not fit and rolls the gallon cost", () => {
    const blocked = fuelCapacityCheck(80, 100, 30);
    expect(blocked.ok).toBe(false);
    expect(blocked.message).toContain("Max capacity: 100 gal, Current: 80 gal, Available: 20 gal");
    expect(fuelCapacityCheck(80, 100, 20).ok).toBe(true);
    expect(rollingAverageCost(80, 3, 20, 4)).toBe(3.2);
  });
});
