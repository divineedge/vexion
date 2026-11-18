import { describe, expect, it } from "vitest";
import {
  applyServiceToJobPrice,
  editJobPrice,
  jobCreatePricing,
  serviceRateForFrequency,
} from "../src/lib/jobServicePrice";

const flat = {
  pricingMode: "flat",
  basePrice: 45,
  weeklyRate: 160,
  monthlyRate: 520,
};

const matrix = {
  pricingMode: "matrix",
  basePrice: 25,
  weeklyRate: 90,
  monthlyRate: 300,
  pricingMatrix: [
    { minSqft: 0, maxSqft: 999, price: 50 },
    { minSqft: 1000, maxSqft: null, price: 80 },
  ],
};

const yard = { serviceableAreaSqft: 1500, measurementPolygons: [] };

describe("service invoice rates", () => {
  it("selects the each-time, weekly, and monthly rates", () => {
    expect(serviceRateForFrequency(flat, "each_time")).toBe(45);
    expect(serviceRateForFrequency(flat, "weekly")).toBe(160);
    expect(serviceRateForFrequency(flat, "monthly")).toBe(520);
  });

  it("uses matrix pricing for each time and the frequency rates for weekly and monthly", () => {
    expect(serviceRateForFrequency(matrix, "each_time", yard)).toBe(80);
    expect(serviceRateForFrequency(matrix, "weekly", yard)).toBe(90);
    expect(serviceRateForFrequency(matrix, "monthly", yard)).toBe(300);
    expect(serviceRateForFrequency({ pricingMode: "per_sqft", basePrice: 0.05, weeklyRate: 40, monthlyRate: 120 }, "each_time", yard)).toBe(75);
  });
});

describe("job price from a service", () => {
  it("fills the price from the service, then keeps a manual edit", () => {
    const filled = applyServiceToJobPrice({ price: "", priceEdited: false }, flat, "each_time");
    expect(filled).toEqual({ price: "45.00", priceEdited: false });

    const weekly = applyServiceToJobPrice(filled, flat, "weekly");
    expect(weekly).toEqual({ price: "160.00", priceEdited: false });

    const edited = editJobPrice("55");
    const kept = applyServiceToJobPrice(edited, flat, "monthly");
    expect(kept).toEqual({ price: "55", priceEdited: true });
    expect(jobCreatePricing({ price: kept.price, invoiceFrequency: "weekly" })).toEqual({
      totalAmount: 55,
      invoiceFrequency: "weekly",
    });

    const nextService = applyServiceToJobPrice(edited, { ...flat, basePrice: 80 }, "each_time", null, { serviceChanged: true });
    expect(nextService).toEqual({ price: "80.00", priceEdited: false });
  });

  it("refills from the matrix when the property is known and the price was not edited", () => {
    const beforeProperty = applyServiceToJobPrice({ price: "", priceEdited: false }, matrix, "each_time");
    expect(beforeProperty.price).toBe("25.00");
    const withYard = applyServiceToJobPrice(beforeProperty, matrix, "each_time", yard);
    expect(withYard.price).toBe("80.00");
    const edited = applyServiceToJobPrice(editJobPrice("70"), matrix, "each_time", yard);
    expect(edited).toEqual({ price: "70", priceEdited: true });
  });
});
