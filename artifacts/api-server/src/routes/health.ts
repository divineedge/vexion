import express, { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

function health(_req: express.Request, res: express.Response) {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
}

router.get("/healthz", health);
router.get("/health", health);

export default router;
