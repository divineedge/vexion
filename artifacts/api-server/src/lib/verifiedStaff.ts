import type { NextFunction, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { resolveStaffSession } from "../routes/auth";

/** Establishes trusted staff identity. Never use caller identity headers after this middleware. */
export async function requireVerifiedStaff(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (req.headers["x-portal-token"]) { res.status(403).json({ error: "This endpoint is not available to portal users" }); return; }
  const session = await resolveStaffSession(req);
  if (!session) { res.status(401).json({ error: "Valid staff session required" }); return; }
  const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(and(
    eq(usersTable.id, session.userId), eq(usersTable.tenantId, session.tenantId), eq(usersTable.isActive, true),
  )).limit(1);
  if (!user) { res.status(401).json({ error: "Staff account is inactive or not found" }); return; }
  res.locals.staffTenantId = session.tenantId;
  res.locals.staffUserId = session.userId;
  next();
}

export function verifiedStaffIdentity(res: Response): { tenantId: number; userId: number } {
  return { tenantId: res.locals.staffTenantId as number, userId: res.locals.staffUserId as number };
}