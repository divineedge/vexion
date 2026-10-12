import { describe, it, expect } from "vitest";
import type { jobsTable } from "@workspace/db";
import { rescheduleFee } from "./rescheduleFee";
const job = { invoiceId: null, totalAmount: 80, lineItems: [{ description: "Service", total: 80 }] } as typeof jobsTable.$inferSelect;
describe("explicit rescheduling fees", () => {
  it("waives without changing prices and appends only a confirmed positive fee", () => {
    expect(rescheduleFee(job, { chargeRescheduleFee: false, rescheduleFeeAmount: 25 })).toEqual({});
    expect(rescheduleFee(job, {})).toEqual({});
    expect(rescheduleFee(job, { chargeRescheduleFee: true, rescheduleFeeAmount: 25 })).toMatchObject({ totalAmount: 105, lineItems: [{ description: "Service", total: 80 }, { description: "Rescheduling fee", total: 25 }] });
  });
  it("rejects invalid fees and already issued invoices", () => {
    for (const amount of [-1, 0, "bad", Infinity]) expect(() => rescheduleFee(job, { chargeRescheduleFee: true, rescheduleFeeAmount: amount })).toThrow();
    expect(() => rescheduleFee({ ...job, invoiceId: 1 }, { chargeRescheduleFee: true, rescheduleFeeAmount: 25 })).toThrow();
  });
});
