import { describe, expect, it } from "vitest";
import { getActiveCustomerFields, isCustomerFieldVisible } from "../src/lib/fieldConfig";

describe("customer field configuration", () => {
  it("preserves tenant-configured select options", () => {
    const fields = getActiveCustomerFields({
      customerFields: [
        {
          key: "customerType",
          label: "Account Type",
          type: "select",
          visible: true,
          required: false,
          isBuiltIn: true,
          options: ["homeowner", "property_manager"],
        },
        {
          key: "referralSource",
          label: "Lead Source",
          type: "select",
          visible: true,
          required: false,
          isBuiltIn: true,
          options: ["Trade Show", "Neighborhood App"],
        },
      ],
    } as Parameters<typeof getActiveCustomerFields>[0]);

    expect(fields.find((field) => field.key === "customerType")?.options)
      .toEqual(["homeowner", "property_manager"]);
    expect(fields.find((field) => field.key === "referralSource")?.options)
      .toEqual(["Trade Show", "Neighborhood App"]);
  });

  it("keeps hidden built-in classification fields hidden", () => {
    const fields = getActiveCustomerFields({
      customerFields: [
        {
          key: "customerType",
          label: "Customer Type",
          type: "select",
          visible: false,
          required: false,
          isBuiltIn: true,
          options: ["residential"],
        },
        {
          key: "referralSource",
          label: "Referral Source",
          type: "select",
          visible: false,
          required: false,
          isBuiltIn: true,
          options: ["Google"],
        },
      ],
    } as Parameters<typeof getActiveCustomerFields>[0]);

    expect(isCustomerFieldVisible(fields, "customerType")).toBe(false);
    expect(isCustomerFieldVisible(fields, "referralSource")).toBe(false);
  });
});