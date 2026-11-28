import { Router, type IRouter } from "express";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import {
  loadDailyBoard,
  logDailyCallback,
  optimizeDailyRoute,
  optimizeVisibleRoutes,
  RouteActionError,
  updateDailyJob,
} from "../lib/dailyRouteBoard";

const router: IRouter = Router();

function sendError(res: { status: (code: number) => { json: (body: unknown) => void } }, error: unknown): void {
  if (error instanceof RouteActionError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  console.error(error);
  res.status(500).json({ error: "Could not update the route" });
}

router.get("/routes/daily", async (req, res): Promise<void> => {
  try {
    const date = typeof req.query.date === "string" ? req.query.date : undefined;
    res.json(await loadDailyBoard(getTenantId(req), getUserId(req), date));
  } catch (error) {
    sendError(res, error);
  }
});

router.post("/routes/optimize", async (req, res): Promise<void> => {
  try {
    res.json(await optimizeDailyRoute(getTenantId(req), getUserId(req), req.body));
  } catch (error) {
    sendError(res, error);
  }
});

router.post("/routes/daily/optimize-all", async (req, res): Promise<void> => {
  try {
    res.json({ routes: await optimizeVisibleRoutes(getTenantId(req), getUserId(req)) });
  } catch (error) {
    sendError(res, error);
  }
});

router.patch("/routes/daily/jobs/:id", async (req, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Job id is invalid" });
      return;
    }
    await updateDailyJob(getTenantId(req), getUserId(req), id, req.body ?? {});
    res.json({ ok: true });
  } catch (error) {
    sendError(res, error);
  }
});

router.post("/routes/daily/callbacks", async (req, res): Promise<void> => {
  try {
    res.status(201).json(await logDailyCallback(getTenantId(req), getUserId(req), req.body ?? {}));
  } catch (error) {
    sendError(res, error);
  }
});

export default router;
