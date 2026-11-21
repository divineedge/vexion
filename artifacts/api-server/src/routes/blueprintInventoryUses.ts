import { Router, type IRouter } from "express";
import { getTenantId } from "../lib/tenantHelper";
import {
  deleteBlueprintInventoryUse,
  listBlueprintInventoryUses,
  MeasuredStockError,
  saveBlueprintInventoryUse,
} from "../lib/blueprintInventoryUse";

const router: IRouter = Router();

function pathId(value: string | string[] | undefined): number | null {
  const parsed = parseInt(Array.isArray(value) ? value[0] : value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

router.get("/blueprints/:id/inventory-uses", async (req, res): Promise<void> => {
  const id = pathId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const uses = await listBlueprintInventoryUses(getTenantId(req), id);
  if (!uses) { res.status(404).json({ error: "Not found" }); return; }
  res.json(uses);
});

router.post("/blueprints/:id/inventory-uses", async (req, res): Promise<void> => {
  const id = pathId(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const inventoryItemId = Number(req.body?.inventoryItemId);
  const amount = Number(req.body?.amount);
  const unit = typeof req.body?.unit === "string" ? req.body.unit : null;
  const elementId = typeof req.body?.elementId === "string" && req.body.elementId.trim() ? req.body.elementId.trim() : null;
  try {
    const saved = await saveBlueprintInventoryUse(getTenantId(req), id, { inventoryItemId, amount, unit, elementId }, null);
    res.status(201).json(saved);
  } catch (error) {
    if (error instanceof MeasuredStockError) { res.status(error.status).json({ error: error.message }); return; }
    throw error;
  }
});

router.patch("/blueprints/:id/inventory-uses/:useId", async (req, res): Promise<void> => {
  const id = pathId(req.params.id);
  const useId = pathId(req.params.useId);
  if (!id || !useId) { res.status(400).json({ error: "Invalid id" }); return; }
  const inventoryItemId = Number(req.body?.inventoryItemId);
  const amount = Number(req.body?.amount);
  const unit = typeof req.body?.unit === "string" ? req.body.unit : null;
  const elementId = typeof req.body?.elementId === "string" && req.body.elementId.trim() ? req.body.elementId.trim() : null;
  try {
    const saved = await saveBlueprintInventoryUse(getTenantId(req), id, { inventoryItemId, amount, unit, elementId }, useId);
    res.json(saved);
  } catch (error) {
    if (error instanceof MeasuredStockError) { res.status(error.status).json({ error: error.message }); return; }
    throw error;
  }
});

router.delete("/blueprints/:id/inventory-uses/:useId", async (req, res): Promise<void> => {
  const id = pathId(req.params.id);
  const useId = pathId(req.params.useId);
  if (!id || !useId) { res.status(400).json({ error: "Invalid id" }); return; }
  const removed = await deleteBlueprintInventoryUse(getTenantId(req), id, useId);
  if (!removed) { res.status(404).json({ error: "Not found" }); return; }
  res.sendStatus(204);
});

export default router;
