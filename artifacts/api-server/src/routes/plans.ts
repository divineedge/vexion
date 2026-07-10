import { Router, type IRouter } from "express";
import { db, plansTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/plans", async (_req, res): Promise<void> => {
  const plans = await db.select().from(plansTable).orderBy(plansTable.price);
  res.json(plans.map(p => ({
    ...p,
    features: p.features ?? [],
    maxUsers: p.maxUsers ?? null,
    maxProperties: p.maxProperties ?? null,
  })));
});

export default router;
