import { Router, type IRouter } from "express";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import {
  completeActionTask,
  loadOperations,
  normalizeLayout,
  readLayout,
  resetLayout,
  TASK_SOURCES,
  writeLayout,
  type TaskSource,
} from "../lib/operationsDashboard";

const router: IRouter = Router();

router.get("/dashboard/layout", async (req, res): Promise<void> => {
  res.json(await readLayout(getTenantId(req), getUserId(req)));
});

router.put("/dashboard/layout", async (req, res): Promise<void> => {
  const layout = normalizeLayout(req.body);
  if (!layout) {
    res.status(400).json({ error: "Choose widgets, a timeframe, and the task sources to show" });
    return;
  }
  res.json(await writeLayout(getTenantId(req), getUserId(req), layout));
});

router.post("/dashboard/layout/reset", async (req, res): Promise<void> => {
  res.json(await resetLayout(getTenantId(req), getUserId(req)));
});

router.get("/dashboard/operations", async (req, res): Promise<void> => {
  res.json(await loadOperations(getTenantId(req), getUserId(req)));
});

router.post("/dashboard/action-tasks/complete", async (req, res): Promise<void> => {
  const source = String(req.body?.source ?? "");
  if (!TASK_SOURCES.includes(source as TaskSource)) {
    res.status(400).json({ error: "Choose a task source" });
    return;
  }
  const result = await completeActionTask(
    getTenantId(req),
    getUserId(req),
    source as TaskSource,
    Number(req.body?.sourceId),
    typeof req.body?.date === "string" ? req.body.date : undefined,
  );
  if ("error" in result) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json(result);
});

export default router;
