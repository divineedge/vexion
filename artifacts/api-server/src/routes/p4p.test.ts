import { describe, expect, it, vi } from "vitest";

// p4p.ts also exports its Express router, so mock its database dependency while
// testing the calculation in isolation.
vi.mock("@workspace/db", async importOriginal => ({
  ...await importOriginal<typeof import("@workspace/db")>(),
  db: { select: vi.fn(), execute: vi.fn() },
}));

import { calculateP4pAmounts } from "./p4p";

describe("P4P material sell-price deduction", () => {
  it("deducts the recorded marked-up job_parts total once, not inventory acquisition cost", () => {
    // The customer was charged $150 for this material. Its inventory acquisition
    // cost was $100, and no additional markup may be applied by P4P.
    const jobPart = { inventoryAcquisitionCost: 100, total: 150 };
    const result = calculateP4pAmounts(500, jobPart.total, 20);

    // $500 customer total − $150 persisted sell total = $350 eligible labor;
    // 20% of that amount is $70. Using acquisition cost would incorrectly pay
    // $80, while marking up $150 again would incorrectly pay a different amount.
    expect(result).toEqual({ netLaborRevenue: 350, p4pPool: 70 });
    expect(result.p4pPool).not.toBe(80);
  });
});