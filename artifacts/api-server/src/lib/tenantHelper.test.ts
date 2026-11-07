import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { getTenantId, getUserId } from "./tenantHelper";

function request(partial: Record<string, unknown>): Request {
  return partial as Request;
}

describe("authenticated business scope", () => {
  it("uses req.user.business_id and ignores a business id in the body or headers", () => {
    const req = request({
      user: { id: 7, business_id: 15 },
      body: { business_id: 99, tenantId: 99 },
      headers: { "x-tenant-id": "99" },
      verifiedTenantId: 99,
    });
    expect(getTenantId(req)).toBe(15);
    expect(getUserId(req)).toBe(7);
  });

  it("accepts the verified session identity when req.user has not been attached yet", () => {
    const req = request({ verifiedTenantId: 4, verifiedUserId: 8 });
    expect(getTenantId(req)).toBe(4);
    expect(getUserId(req)).toBe(8);
  });

  it("rejects a request with no authenticated business", () => {
    expect(() => getTenantId(request({ body: { business_id: 3 } }))).toThrow(/business/);
  });
});
