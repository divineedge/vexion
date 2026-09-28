import { Router, type IRouter, type RequestHandler } from "express";
import multer from "multer";
import { and, eq, inArray } from "drizzle-orm";
import { db, chemicalProductsTable, mediaAttachmentsTable } from "@workspace/db";
import { requireVerifiedStaff, verifiedStaffIdentity } from "../lib/verifiedStaff";
import { getCallerRole } from "../lib/roles";
import { ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const storage = new ObjectStorageService();
export const CHEMICAL_DOCUMENT_TYPES = ["chemical_sds", "chemical_msds"];
export const MAX_CHEMICAL_PDF_BYTES = 20 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_CHEMICAL_PDF_BYTES, files: 1, fields: 1, parts: 3 },
}).single("file");
const base = "/chemical-products/:id/documents";

export function sanitizeChemicalDocumentName(name: string): string {
  return name.replace(/\\/g, "/").split("/").pop()!.replace(/[\x00-\x1f\x7f-\x9f]/g, "").trim().slice(0, 240) || "document.pdf";
}

function documentJson(row: typeof mediaAttachmentsTable.$inferSelect) {
  return {
    id: row.id, documentType: row.entityType === "chemical_sds" ? "sds" : "msds",
    fileName: row.caption ?? "document.pdf", sizeBytes: row.sizeBytes, createdAt: row.createdAt.toISOString(),
  };
}

const requireProduct: RequestHandler = async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid chemical product id" }); return; }
  const { tenantId } = verifiedStaffIdentity(res);
  const [product] = await db.select({ id: chemicalProductsTable.id }).from(chemicalProductsTable)
    .where(and(eq(chemicalProductsTable.id, id), eq(chemicalProductsTable.tenantId, tenantId))).limit(1);
  if (!product) { res.status(404).json({ error: "Chemical product not found" }); return; }
  res.locals.chemicalProductId = id;
  next();
};

const requireDocumentManager: RequestHandler = async (_req, res, next) => {
  const { tenantId, userId } = verifiedStaffIdentity(res);
  const role = await getCallerRole(tenantId, userId);
  if (!role || !["company_owner", "office_manager", "department_manager"].includes(role)) {
    res.status(403).json({ error: "Chemical document management permission required" }); return;
  }
  next();
};

const parseUpload: RequestHandler = (req, res, next) => {
  upload(req, res, (error: unknown) => {
    if (error) {
      const tooLarge = error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE";
      res.status(tooLarge ? 413 : 400).json({ error: tooLarge ? "PDF must be 20 MiB or smaller" : "Invalid multipart upload" });
      return;
    }
    next();
  });
};

const scope = (tenantId: number, productId: number) => and(
  eq(mediaAttachmentsTable.tenantId, tenantId),
  eq(mediaAttachmentsTable.entityId, productId),
  inArray(mediaAttachmentsTable.entityType, CHEMICAL_DOCUMENT_TYPES),
);

const requireDocument: RequestHandler = async (req, res, next) => {
  const id = Number(req.params.documentId);
  if (!Number.isSafeInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid document id" }); return; }
  const [document] = await db.select().from(mediaAttachmentsTable).where(and(
    scope(verifiedStaffIdentity(res).tenantId, res.locals.chemicalProductId),
    eq(mediaAttachmentsTable.id, id),
  )).limit(1);
  if (!document) { res.status(404).json({ error: "Chemical document not found" }); return; }
  res.locals.chemicalDocument = document;
  next();
};

router.get(base, requireVerifiedStaff, requireProduct, async (_req, res) => {
  const rows = await db.select().from(mediaAttachmentsTable)
    .where(scope(verifiedStaffIdentity(res).tenantId, res.locals.chemicalProductId))
    .orderBy(mediaAttachmentsTable.createdAt);
  res.json(rows.map(documentJson));
});

router.post(base, requireVerifiedStaff, requireDocumentManager, requireProduct, parseUpload, async (req, res) => {
  const type = req.body?.documentType;
  if (type !== "sds" && type !== "msds") { res.status(400).json({ error: "documentType must be sds or msds" }); return; }
  if (!req.file || req.file.buffer.length < 5 || !req.file.buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    res.status(400).json({ error: "A valid, non-empty PDF file is required" }); return;
  }
  const { tenantId, userId } = verifiedStaffIdentity(res);
  let fileKey: string | undefined;
  try {
    fileKey = await storage.savePrivatePdf(req.file.buffer);
    // Lock parent while inserting so a concurrent product deletion cannot leave orphan metadata.
    const row = await db.transaction(async tx => {
      const [parent] = await tx.select({ id: chemicalProductsTable.id }).from(chemicalProductsTable)
        .where(and(eq(chemicalProductsTable.id, res.locals.chemicalProductId), eq(chemicalProductsTable.tenantId, tenantId)))
        .for("update");
      if (!parent) throw new Error("Chemical product was removed during upload");
      const [saved] = await tx.insert(mediaAttachmentsTable).values({
        tenantId, entityType: `chemical_${type}`, entityId: parent.id, fileKey: fileKey!,
        fileUrl: `/api/storage${fileKey}`, mimeType: "application/pdf", sizeBytes: req.file!.buffer.length,
        caption: sanitizeChemicalDocumentName(req.file!.originalname), createdBy: userId, source: "staff", isCover: false,
      }).returning();
      return saved;
    });
    res.status(201).json(documentJson(row));
  } catch (error) {
    if (fileKey) {
      try { await storage.deleteObjectEntity(fileKey); }
      catch (cleanupError) { req.log.error({ err: cleanupError, fileKey }, "Failed chemical document upload cleanup"); }
    }
    req.log.error({ err: error }, "Chemical document upload failed");
    res.status(500).json({ error: "Failed to save chemical document" });
  }
});

router.post(`${base}/:documentId/read-url`, requireVerifiedStaff, requireProduct, requireDocument, async (req, res) => {
  try {
    const document = res.locals.chemicalDocument as typeof mediaAttachmentsTable.$inferSelect;
    await storage.getObjectEntityFile(document.fileKey);
    res.setHeader("Cache-Control", "no-store");
    res.json({ url: await storage.generateSignedReadUrl(document.fileKey, 60) });
  } catch (error) {
    req.log.error({ err: error }, "Failed chemical document read URL");
    res.status(500).json({ error: "Unable to open chemical document" });
  }
});

router.delete(`${base}/:documentId`, requireVerifiedStaff, requireDocumentManager, requireProduct, requireDocument, async (req, res) => {
  const document = res.locals.chemicalDocument as typeof mediaAttachmentsTable.$inferSelect;
  await db.delete(mediaAttachmentsTable).where(and(
    scope(verifiedStaffIdentity(res).tenantId, res.locals.chemicalProductId), eq(mediaAttachmentsTable.id, document.id),
  ));
  try { await storage.deleteObjectEntity(document.fileKey); }
  catch (error) {
    // Permission stays revoked even if physical cleanup fails.
    req.log.error({ err: error, fileKey: document.fileKey }, "Chemical document removed; private object cleanup failed");
  }
  res.sendStatus(204);
});

export default router;