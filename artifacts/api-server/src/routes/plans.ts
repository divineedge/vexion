import { Router, type IRouter } from "express";
import { db, plansTable } from "@workspace/db";
import { and,eq,sql } from "drizzle-orm";

const router: IRouter = Router();

router.get("/plans", async (_req, res): Promise<void> => {
  const plans = await db.select().from(plansTable).where(and(eq(plansTable.active,true),
    sql`${plansTable.stripePriceId} IS NOT NULL AND ${plansTable.publishedRevision}=${plansTable.revision}`)).orderBy(plansTable.price);
  res.json(plans.map(p => ({
    id:p.id,name:p.name,tier:p.tier,price:p.price,
    features: p.features ?? [],
    maxUsers: p.maxUsers ?? null,
    maxProperties: p.maxProperties ?? null,
  })));
});

export default router;
