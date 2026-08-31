import { describe, expect, it } from "vitest";
import { suggestMapping, type ImportFieldMeta } from "./importExport";

const customerFields: ImportFieldMeta[] = [
  { key: "name", header: "Name" },
  { key: "firstName", header: "First Name" },
  { key: "lastName", header: "Last Name" },
  { key: "email", header: "Email", required: true },
  { key: "referringCustomerEmail", header: "Referring Customer Email" },
  { key: "phone", header: "Phone", required: true },
];

describe("suggestMapping", () => {
  it("maps a combined customer name without reusing Email for referring customer email", () => {
    expect(suggestMapping(["Name", "Email", "Phone"], customerFields)).toEqual({
      name: "Name",
      firstName: null,
      lastName: null,
      email: "Email",
      referringCustomerEmail: null,
      phone: "Phone",
    });
  });

  it("maps separate first and last name columns", () => {
    expect(suggestMapping(["First Name", "Last Name", "Email", "Phone"], customerFields)).toEqual({
      name: null,
      firstName: "First Name",
      lastName: "Last Name",
      email: "Email",
      referringCustomerEmail: null,
      phone: "Phone",
    });
  });
});