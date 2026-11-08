import { describe, expect, it } from "vitest";
import { importedCustomerAddresses, importedServiceProperty } from "./customerImportAddress";

describe("imported customer mailing and service addresses", () => {
  it("uses the mailing address for the service property when no service address is imported", () => {
    const addresses = importedCustomerAddresses({
      mailingAddress: "PO Box 10",
      mailingCity: "Boise",
      mailingState: "ID",
      mailingZip: "83701",
    });
    expect(addresses.billingAddress).toBe("PO Box 10");
    expect(addresses.physicalAddress).toBe("PO Box 10");
    expect(addresses.physicalCity).toBe("Boise");
    expect(importedServiceProperty(addresses)).toEqual({
      address: "PO Box 10",
      city: "Boise",
      state: "ID",
      zip: "83701",
    });
  });

  it("keeps a distinct service address when the import includes one", () => {
    const addresses = importedCustomerAddresses({
      billingAddress: "PO Box 10",
      billingCity: "Boise",
      physicalAddress: "100 Service Rd",
      physicalCity: "Meridian",
    });
    expect(addresses.billingAddress).toBe("PO Box 10");
    expect(importedServiceProperty(addresses)).toEqual({
      address: "100 Service Rd",
      city: "Meridian",
      state: null,
      zip: null,
    });
  });

  it("does not create a property when the import has no mailing address", () => {
    expect(importedServiceProperty(importedCustomerAddresses({ physicalAddress: "100 Service Rd" }))).toBeNull();
  });
});
