import { describe, expect, it } from "vitest";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

const schema = z.object({
  propertyId: z.coerce.number({ error: "Select a property" }).min(1, "Select a property"),
  description: z.string().min(10, "Provide more details"),
});
const resolve = zodResolver(schema);
const options = { fields: {}, shouldUseNativeValidation: false };

describe("portal forms with the patched validator and resolver", () => {
  it("returns field errors instead of throwing when input is invalid", async () => {
    const result = await resolve({ propertyId: "", description: "" }, {}, options);
    expect(result.errors.propertyId?.message).toBe("Select a property");
    expect(result.errors.description?.message).toBe("Provide more details");
    expect(result.values).toEqual({});
  });
  it("coerces a selected property and retains valid submitted data", async () => {
    const result = await resolve({
      propertyId: "12", description: "Please inspect the sprinkler.",
    }, {}, options);
    expect(result.errors).toEqual({});
    expect(result.values).toEqual({
      propertyId: 12, description: "Please inspect the sprinkler.",
    });
  });
});
