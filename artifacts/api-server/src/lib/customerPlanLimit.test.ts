import { describe, expect, it } from "vitest";
import { customerLimitReached, resolveCustomerLimit } from "./customerPlanLimit";

describe("resolveCustomerLimit", () => {
  it("does not invent a cap when the plan leaves customers unlimited", () => {
    expect(resolveCustomerLimit({ tier: "growth", maxCustomers: null }, null)).toBeNull();
    expect(resolveCustomerLimit({ tier: "unlimited", maxCustomers: 10 }, { maxCustomers: 10 })).toBeNull();
    expect(resolveCustomerLimit(null, {})).toBeNull();
  });

  it("uses the plan or the saved subscription policy when a number is set", () => {
    expect(resolveCustomerLimit({ tier: "free", maxCustomers: 25 }, null)).toBe(25);
    expect(resolveCustomerLimit({ tier: "growth", maxCustomers: 100 }, { maxCustomers: 900 })).toBe(900);
    expect(customerLimitReached(900, 1, 900)).toBe(true);
    expect(customerLimitReached(899, 1, 900)).toBe(false);
    expect(customerLimitReached(2000, 1, null)).toBe(false);
  });
});
