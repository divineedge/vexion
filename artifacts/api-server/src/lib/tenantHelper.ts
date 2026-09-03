import type { Request } from "express";

export function getTenantId(req: Request): number {
  const trusted = (req as Request & { verifiedTenantId?: number }).verifiedTenantId;
  if (Number.isInteger(trusted)) return trusted!;
  throw new Error("Verified staff tenant identity is required");
}

export function getUserId(req: Request): number {
  const trusted = (req as Request & { verifiedUserId?: number }).verifiedUserId;
  if (Number.isInteger(trusted)) return trusted!;
  throw new Error("Verified staff user identity is required");
}
