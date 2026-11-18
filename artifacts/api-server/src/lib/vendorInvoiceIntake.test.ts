import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { bytesFromDataUrl, detectInvoiceFile, extractInvoiceText, fuelCapacityCheck, invoiceDataUrl, matchInventoryItem, matchVendor, MAX_VENDOR_INVOICE_BYTES, pdfText, readInvoiceText, resolveInvoiceVendor, rollingAverageCost, sanitizeUploadName, sellerBesidesCustomer } from "./vendorInvoiceIntake";
import { companyNameFromOcr } from "./vendorInvoiceOcrText";

describe("vendor invoice intake", () => {
  it("auto-selects a close vendor and leaves an unknown name for approval", () => {
    const vendors = [{ id: 4, name: "Horizon Fuel Co." }, { id: 9, name: "Summit Irrigation" }];
    expect(matchVendor("Horizon Fuel Company", vendors).confident).toBe(true);
    expect(matchVendor("Horizon Fuel Company", vendors).vendorId).toBe(4);
    const unknown = matchVendor("Brand New Supply", vendors);
    expect(unknown.confident).toBe(false);
  });

  it("keeps a typed vendor, selects a close existing vendor, and ignores the customer", () => {
    const vendors = [{ id: 7, name: "Great Basin Turf Products" }, { id: 4, name: "Horizon Fuel Co." }];
    const kept = resolveInvoiceVendor("Great Basin Turf", "Divine Edge Property Management, LLC", vendors);
    expect(kept.vendorName).toBe("Great Basin Turf");
    expect(kept.vendorId).toBe(7);
    const emptyFile = resolveInvoiceVendor("Horizon Fuel", "", vendors);
    expect(emptyFile.vendorName).toBe("Horizon Fuel");
    expect(emptyFile.vendorId).toBe(4);
    const agreed = resolveInvoiceVendor("Great Basin Turf", "GREAT BASIN TURF PRODUCTS", vendors);
    expect(agreed.vendorId).toBe(7);
    expect(agreed.vendorName).toBe("Great Basin Turf");
    expect(resolveInvoiceVendor("", "Page header junk", vendors).vendorId).toBeNull();
  });

  it("does not treat sold-to or ship-to text as the vendor", () => {
    const seller = extractInvoiceText("Acme Fuel\nSold to: Divine Edge Property Management, LLC\nInvoice # A-14\nTotal $10.00");
    expect(seller.vendorName).toBe("Acme Fuel");
    const customerFirst = [
      "Acme Fuel",
      "Divine Edge Property Management, LLC",
      "Sold to:\tShip to:",
      "P O Box\t400",
      "Invoice # 480584",
      "Total $8,261.04",
    ].join("\n");
    expect(extractInvoiceText(customerFirst).vendorName).toBe("Acme Fuel");
    const onlyCustomer = [
      "Divine Edge Property Management, LLC",
      "Sold to:\tShip to:",
      "Divine Edge Property Management, LLC\tDivine Edge Property Management, LLC",
      "Invoice # 480584",
      "Total $8,261.04",
    ].join("\n");
    expect(extractInvoiceText(onlyCustomer).vendorName).toBe("");
    expect(extractInvoiceText(onlyCustomer).vendorName).not.toMatch(/divine edge/i);
    expect(sellerBesidesCustomer("Divine Edge Property Management, LLC", onlyCustomer)).toBe("");
    expect(sellerBesidesCustomer("GREAT BASIN TURF PRODUCTS", onlyCustomer)).toBe("GREAT BASIN TURF PRODUCTS");
  });

  it("reads invoice fields and fuel lines from text", () => {
    const invoice = extractInvoiceText("Acme Fuel\nInvoice # A-14\nDate 2026-04-02\nDiesel clear 100 3.50 350.00\nTax $12.00\nTotal $362.00");
    expect(invoice.vendorName).toBe("Acme Fuel");
    expect(invoice.invoiceNumber).toBe("A-14");
    expect(invoice.invoiceDate).toBe("2026-04-02");
    expect(invoice.lines[0].destinationType).toBe("bulk_fuel");
    expect(invoice.totalAmount).toBe(362);
  });

  it("reads parts from a PDF or pasted photo text and can match them to inventory", () => {
    const invoice = extractInvoiceText([
      "Acme Supply",
      "Invoice # INV-9",
      "Date 04/02/2026",
      "Mower blade 2 18.00 36.00",
      "2 Oil filter $9.50 $19.00",
      "Spark plug",
      "4",
      "3.25",
      "13.00",
      "Tax $4.00",
      "Total $72.00",
    ].join("\n"));
    expect(invoice.invoiceNumber).toBe("INV-9");
    expect(invoice.invoiceDate).toBe("2026-04-02");
    expect(invoice.lines.map(line => [line.description, line.quantity, line.totalPrice, line.destinationType])).toEqual([
      ["Mower blade", 2, 36, "inventory"],
      ["Oil filter", 2, 19, "inventory"],
      ["Spark plug", 4, 13, "inventory"],
    ]);
    const stock = [{ id: 9, name: "Mower blade", sku: "BLD-1" }, { id: 10, name: "Unrelated hose", sku: "H-1" }];
    expect(matchInventoryItem("Mower blade", stock)).toMatchObject({ itemId: 9, confident: true });
    expect(matchInventoryItem("Blade BLD-1", stock).itemId).toBe(9);
    expect(matchInventoryItem("Oil filter", stock).confident).toBe(false);
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

  it("reads the Great Basin receipt text instead of the customer or Crystal Reports", () => {
    const receipt = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures/great-basin-turf-invoice.pdf"));
    const invoice = extractInvoiceText(pdfText(receipt));
    expect(invoice.vendorName).toBe("");
    expect(invoice.vendorName).not.toMatch(/divine edge|crystal/i);
    expect(invoice.invoiceNumber).toBe("480584");
    expect(invoice.invoiceDate).toBe("2026-03-19");
    expect(invoice.taxAmount).toBe(572.78);
    expect(invoice.totalAmount).toBe(8261.04);
    expect(invoice.lines.map(line => [line.sku, line.description, line.quantity, line.unitPrice, line.totalPrice, line.unit])).toEqual([
      ["28686", "diuron/ bromacil 40/40 (krovar", 45, 79, 3555, "6LB."],
      ["2HAQU01", "Aquaneat 2.5 gal", 6, 139.99, 839.94, "EACH"],
      ["5350", "Crossroad 2.5 gal.", 2, 116.99, 233.98, "JUG"],
      ["28241", "TURF SAVER RTF Y/J 50LB. BAG", 1, 159.99, 159.99, "EACH"],
      ["3S2104", "21-3-7 50% XRTW/Humate &AG", 40, 24.99, 999.6, "EACH"],
      ["28681", "Makaze 2.5 Gal", 10, 59.99, 599.9, "EACH"],
      ["2H4DTRIAD", "Triad 2.5 gal.", 2, 72.99, 145.98, "EACH"],
      ["2HSEM02", "Semera 51%", 1, 369.99, 369.99, "EACH"],
      ["35465", "PS 804 2.5 GAL", 10, 65.99, 659.9, "EACH"],
      ["2HSPRO01", "Qp Prodoxaben G 50 lb.", 1, 88.99, 88.99, "EACH"],
      ["2IBIF02", "Qp bifenthrin i/t 7.9 1 gal.", 1, 34.99, 34.99, "EACH"],
    ]);
    expect(readInvoiceText("Sold to: Divine Edge Property Management, LLC\nTotal $1.00", receipt).invoiceNumber).toBe("480584");
    expect(readInvoiceText("Sold to: Divine Edge Property Management, LLC\nTotal $1.00", receipt).lines).toHaveLength(11);
  });

  it("joins a stacked logo into the seller name", () => {
    expect(companyNameFromOcr("GREAT BASIN\nTURF PRODUCTS\n")).toBe("GREAT BASIN TURF PRODUCTS");
    expect(companyNameFromOcr("Invoice\nPage 1")).toBe("");
  });

  it("reads Great Basin Turf Products from the receipt logo", async () => {
    const { vendorNameFromPdf } = await import("./vendorInvoiceOcr");
    const receipt = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures/great-basin-turf-invoice.pdf"));
    const name = await vendorNameFromPdf(receipt);
    expect(name).toBe("GREAT BASIN TURF PRODUCTS");
  }, 60_000);

  it("blocks a delivery that does not fit and rolls the gallon cost", () => {
    const blocked = fuelCapacityCheck(80, 100, 30);
    expect(blocked.ok).toBe(false);
    expect(blocked.message).toContain("Max capacity: 100 gal, Current: 80 gal, Available: 20 gal");
    expect(fuelCapacityCheck(80, 100, 20).ok).toBe(true);
    expect(rollingAverageCost(80, 3, 20, 4)).toBe(3.2);
  });
});
