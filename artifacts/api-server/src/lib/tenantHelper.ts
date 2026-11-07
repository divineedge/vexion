import type { Request } from "express";

type AuthenticatedRequest = Request & {
  user?: { id: number; business_id: number };
  verifiedTenantId?: number;
  verifiedUserId?: number;
};

/**
 * Business id for the signed-in staff user. The session middleware sets
 * `req.user.business_id` from the server-side session row for the presented
 * token. Request bodies, identity headers, and token payloads are not read.
 */
export function getTenantId(req: Request): number {
  const current = req as AuthenticatedRequest;
  const businessId = current.user?.business_id;
  if (Number.isInteger(businessId) && businessId! > 0) return businessId!;
  const trusted = current.verifiedTenantId;
  if (Number.isInteger(trusted) && trusted! > 0) return trusted!;
  throw new Error("Authenticated business id is required");
}

export function getUserId(req: Request): number {
  const current = req as AuthenticatedRequest;
  const userId = current.user?.id;
  if (Number.isInteger(userId) && userId! > 0) return userId!;
  const trusted = current.verifiedUserId;
  if (Number.isInteger(trusted) && trusted! > 0) return trusted!;
  throw new Error("Verified staff user identity is required");
}
