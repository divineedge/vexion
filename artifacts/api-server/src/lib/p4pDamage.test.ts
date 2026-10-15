import { describe, it, expect } from "vitest";
import { calculateDamagePay } from "./p4pDamage";

describe("approved P4P damage allocations", () => {
  it("deducts directly from performance earnings, not revenue or acquisition bonuses", () => {
    expect(calculateDamagePay(250, 100, 40, 15)).toEqual({
      p4pBeforeDamage: 250, damageDeduction: 40, p4pEarnings: 210, damagePayReduction: 40, grossPay: 225,
    });
  });
  it("protects the hourly guarantee even when damage exceeds all performance earnings", () => {
    expect(calculateDamagePay(250, 200, 1000, 15)).toMatchObject({
      p4pEarnings: 0, damagePayReduction: 50, grossPay: 215,
    });
    expect(calculateDamagePay(40, 200, 10)).toMatchObject({ p4pEarnings: 30, damagePayReduction: 0, grossPay: 200 });
  });
  it("retains missing historical guarantees instead of inventing zero-dollar hourly pay", () => {
    expect(calculateDamagePay(250, null, 40)).toMatchObject({ p4pEarnings: 210, damagePayReduction: null, grossPay: null });
  });
  it("preserves cents and has no negative-P4P carry-forward", () => {
    expect(calculateDamagePay(100.01, 80.01, 0.02)).toMatchObject({ p4pEarnings: 99.99, damagePayReduction: 0.02, grossPay: 99.99 });
    expect(calculateDamagePay(0, 10, 500)).toMatchObject({ p4pEarnings: 0, grossPay: 10 });
    expect(calculateDamagePay(100, 10, 0)).toMatchObject({ p4pEarnings: 100, grossPay: 100 });
  });
});
