import type { Request } from "express";

export function getTenantId(req: Request): number {
  const trusted = (req as Request & { verifiedTenantId?: number }).verifiedTenantId;
  if (Number.isInteger(trusted)) return trusted!;
  const raw = req.headers["x-tenant-id"];
  const val = Array.isArray(raw) ? raw[0] : raw;
  const id = parseInt(val ?? "1", 10);
  return isNaN(id) ? 1 : id;
}

export function getUserId(req: Request): number {
  const trusted = (req as Request & { verifiedUserId?: number }).verifiedUserId;
  if (Number.isInteger(trusted)) return trusted!;
  const raw = req.headers["x-user-id"];
  const val = Array.isArray(raw) ? raw[0] : raw;
  const id = parseInt(val ?? "1", 10);
  return isNaN(id) ? 1 : id;
}
