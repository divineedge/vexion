import { describe, expect, it } from "vitest";
import { chooseJobPrice, lineItemsForJobPrice, parseCallerJobPrice } from "./jobServicePrice";

describe("job price persistence", () => {
  it("selects each-time, weekly, and monthly rates when the price was not edited", () => {
    const rates = { eachTimePrice: 80, weeklyRate: 160, monthlyRate: 520 };
    expect(chooseJobPrice({ callerTotal: null, frequency: "each_time", ...rates })).toBe(80);
    expect(chooseJobPrice({ callerTotal: null, frequency: "weekly", ...rates })).toBe(160);
    expect(chooseJobPrice({ callerTotal: null, frequency: "monthly", ...rates })).toBe(520);
    expect(parseCallerJobPrice("")).toBeNull();
    expect(parseCallerJobPrice(0)).toBe(0);
  });

  it("keeps an edited price instead of replacing it with the service rate", () => {
    const chosen = chooseJobPrice({
      callerTotal: parseCallerJobPrice("55"),
      frequency: "weekly",
      eachTimePrice: 80,
      weeklyRate: 160,
      monthlyRate: 520,
    });
    expect(chosen).toBe(55);
    expect(lineItemsForJobPrice(
      [{ description: "Mow (1,500 sq ft)", quantity: 1500, unitPrice: 0.05, total: 80 }],
      chosen!,
      80,
      "Mow",
    )).toEqual([{
      description: "Mow (1,500 sq ft)",
      quantity: 1,
      qty: 1,
      unitPrice: 55,
      total: 55,
    }]);
  });
});
