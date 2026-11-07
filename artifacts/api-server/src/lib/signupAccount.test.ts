import { describe, expect, it } from "vitest";
import { signupAccountFields } from "./signupAccount";

describe("signup account fields", () => {
  it("keeps a client-supplied business id out of the account payload", () => {
    const fields = signupAccountFields({
      companyName: "Northgate Lawn",
      ownerName: "Elena Vasquez",
      email: "elena@example.com",
      password: "Secret123!",
      business_id: 44,
      businessId: 44,
      tenant_id: 44,
      tenantId: 44,
    });
    expect(fields).toEqual({
      companyName: "Northgate Lawn",
      ownerName: "Elena Vasquez",
      email: "elena@example.com",
      password: "Secret123!",
    });
    expect(fields).not.toHaveProperty("business_id");
    expect(fields).not.toHaveProperty("tenantId");
  });
});
