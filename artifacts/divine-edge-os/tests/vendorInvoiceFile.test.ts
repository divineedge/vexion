import { describe, expect, it } from "vitest";
import { groupPdfTextItems } from "../src/lib/vendorInvoiceFile";

describe("vendor invoice file text", () => {
  it("keeps words on the same baseline together", () => {
    const text = groupPdfTextItems([
      { str: "Acme", transform: [1, 0, 0, 1, 10, 700] },
      { str: "Fuel", transform: [1, 0, 0, 1, 40, 700] },
      { str: "Invoice # A-14", transform: [1, 0, 0, 1, 10, 680] },
      { str: "Diesel clear", transform: [1, 0, 0, 1, 10, 640] },
      { str: "100", transform: [1, 0, 0, 1, 120, 641] },
      { str: "3.50", transform: [1, 0, 0, 1, 160, 640] },
      { str: "350.00", transform: [1, 0, 0, 1, 200, 640] },
    ]);
    expect(text).toBe("Acme Fuel\nInvoice # A-14\nDiesel clear 100 3.50 350.00");
  });
});
