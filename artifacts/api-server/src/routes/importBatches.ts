import { Router, type IRouter } from "express";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { isAdminRole } from "../lib/roles";
import { handleListImportBatches, handleRollbackImportBatch } from "../lib/importExport";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Bulk import history + rollback ("undo an accidental bulk import")
// Restricted to admin roles — same office-staff bar as other destructive,
// tenant-wide bulk actions (e.g. resume-service).
// ---------------------------------------------------------------------------

router.get("/import-batches", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) {
    res.status(403).json({ error: "Restricted to owner/office roles" });
    return;
  }
  await handleListImportBatches(req, res, tenantId);
});

router.post("/import-batches/:id/rollback", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!(await isAdminRole(tenantId, userId))) {
    res.status(403).json({ error: "Restricted to owner/office roles" });
    return;
  }
  await handleRollbackImportBatch(req, res, tenantId, userId);
});

export default router;
