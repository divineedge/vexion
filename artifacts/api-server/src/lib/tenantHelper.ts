import type { Request } from "express";

export function getTenantId(req: Request): number {
  const raw = req.headers["x-tenant-id"];
  const val = Array.isArray(raw) ? raw[0] : raw;
  const id = parseInt(val ?? "1", 10);
  return isNaN(id) ? 1 : id;
}

export function getUserId(req: Request): number {
  const raw = req.headers["x-user-id"];
  const val = Array.isArray(raw) ? raw[0] : raw;
  const id = parseInt(val ?? "1", 10);
  return isNaN(id) ? 1 : id;
}
