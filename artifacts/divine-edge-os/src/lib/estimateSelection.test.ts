import { describe, expect, it } from "vitest";
import { billableItems, toggleOptionalSelection } from "./estimateSelection";
const items = [
  { id: "required", isOptional: false, unitPrice: 100 },
  { id: "a", isOptional: true, groupId: "choice", unitPrice: 50 },
  { id: "b", isOptional: true, groupId: "choice", unitPrice: 75 },
  { id: "extra", isOptional: true, unitPrice: 10 },
];
describe("estimate optional selection", () => {
  it("starts with required-only pricing", () => {
    expect(billableItems(items).reduce((sum, i) => sum + i.unitPrice, 0)).toBe(100);
  });
  it("replaces a grouped option without removing unrelated options", () => {
    const next = toggleOptionalSelection("b", new Set(["a", "extra"]), items);
    expect([...next]).toEqual(["extra", "b"]);
    expect([...toggleOptionalSelection("b", next, items)]).toEqual(["extra"]);
  });
  it("counts at most one grouped item even for legacy multiple-accepted state", () => {
    expect(billableItems(items.map(i => ({ ...i, acceptedByCustomer: true }))).map(i => i.id)).toEqual(["required", "a", "extra"]);
  });
});
