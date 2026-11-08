import { describe, expect, it } from "vitest";
import { duplicateCustomerConflict, explicitDuplicateOverride, formatPostalAddress } from "./customerDuplicate";

describe("duplicate customer conflict", () => {
  it("returns the existing customer's name, email, and address", () => {
    expect(duplicateCustomerConflict({
      id: 12,
      name: "Jane Smith",
      email: "jane@example.com",
      phone: "3035550100",
      physicalAddress: "1437 Bannock St",
      physicalCity: "Denver",
      physicalState: "CO",
      physicalZip: "80202",
      archivedAt: null,
    })).toEqual({
      error: "Duplicate customer detected",
      existingCustomerId: 12,
      archived: false,
      existingCustomer: {
        id: 12,
        name: "Jane Smith",
        email: "jane@example.com",
        phone: "3035550100",
        address: "1437 Bannock St, Denver, CO 80202",
        archived: false,
      },
    });
  });

  it("leaves a blank address empty", () => {
    expect(formatPostalAddress({ address: "  ", city: "" })).toBeNull();
  });

  it("accepts only a real boolean override", () => {
    expect(explicitDuplicateOverride({ forceCreate: true })).toBe(true);
    expect(explicitDuplicateOverride({ allowPossibleDuplicate: true })).toBe(true);
    expect(explicitDuplicateOverride({ forceCreate: "true" })).toBe(false);
  });
});
