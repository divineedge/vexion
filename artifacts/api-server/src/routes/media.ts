import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { mediaAttachmentsTable, propertiesTable, jobsTable, customersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { ObjectStorageService } from "../lib/objectStorage";

const objectStorageService = new ObjectStorageService();

async function withSignedUrls(
  rows: (typeof mediaAttachmentsTable.$inferSelect)[],
): Promise<((typeof mediaAttachmentsTable.$inferSelect) & { signedUrl: string | null })[]> {
  return Promise.all(
    rows.map(async (row) => {
      let signedUrl: string | null = null;
      try {
        signedUrl = await objectStorageService.generateSignedReadUrl(row.fileKey);
      } catch {
        // Non-fatal: signed URL generation can fail in local dev without sidecar
      }
      return { ...row, signedUrl };
    }),
  );
}

const router: IRouter = Router();

// ── Property Media ────────────────────────────────────────────────────────────

router.get("/properties/:id/media", async (req: Request, res: Response): Promise<void> => {
  const tenantId = getTenantId(req);
  const propertyId = Number(req.params.id);

  const [property] = await db.select({ id: propertiesTable.id })
    .from(propertiesTable)
    .where(and(eq(propertiesTable.id, propertyId), eq(propertiesTable.tenantId, tenantId)))
    .limit(1);
  if (!property) { res.status(404).json({ error: "Property not found" }); return; }

  const media = await db.select().from(mediaAttachmentsTable)
    .where(and(
      eq(mediaAttachmentsTable.tenantId, tenantId),
      eq(mediaAttachmentsTable.entityType, "property"),
      eq(mediaAttachmentsTable.entityId, propertyId),
    ))
    .orderBy(mediaAttachmentsTable.createdAt);

  res.json(await withSignedUrls(media));
});

router.post("/properties/:id/media", async (req: Request, res: Response): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const propertyId = Number(req.params.id);

  const [property] = await db.select({ id: propertiesTable.id })
    .from(propertiesTable)
    .where(and(eq(propertiesTable.id, propertyId), eq(propertiesTable.tenantId, tenantId)))
    .limit(1);
  if (!property) { res.status(404).json({ error: "Property not found" }); return; }

  const { fileKey, fileUrl, mimeType, sizeBytes, caption, isCover } = req.body as {
    fileKey?: string; fileUrl?: string; mimeType?: string; sizeBytes?: number;
    caption?: string; isCover?: boolean;
  };
  if (!fileKey || !fileUrl || !mimeType || !sizeBytes) {
    res.status(400).json({ error: "fileKey, fileUrl, mimeType, sizeBytes are required" });
    return;
  }

  const isImage = mimeType.startsWith("image/");
  const isVideo = mimeType.startsWith("video/");
  if (!isImage && !isVideo) {
    res.status(400).json({ error: "Only images and videos are allowed" });
    return;
  }

  if (isCover) {
    await db.update(mediaAttachmentsTable)
      .set({ isCover: false })
      .where(and(
        eq(mediaAttachmentsTable.tenantId, tenantId),
        eq(mediaAttachmentsTable.entityType, "property"),
        eq(mediaAttachmentsTable.entityId, propertyId),
        eq(mediaAttachmentsTable.isCover, true),
      ));
  }

  const [attachment] = await db.insert(mediaAttachmentsTable).values({
    tenantId,
    entityType: "property",
    entityId: propertyId,
    fileKey,
    fileUrl,
    mimeType,
    sizeBytes: Number(sizeBytes),
    caption: caption ?? null,
    isCover: isCover ?? false,
    createdBy: userId,
  }).returning();

  res.status(201).json(attachment);
});

router.delete("/properties/:id/media/:mediaId", async (req: Request, res: Response): Promise<void> => {
  const tenantId = getTenantId(req);
  const propertyId = Number(req.params.id);
  const mediaId = Number(req.params.mediaId);

  const [deleted] = await db.delete(mediaAttachmentsTable)
    .where(and(
      eq(mediaAttachmentsTable.id, mediaId),
      eq(mediaAttachmentsTable.tenantId, tenantId),
      eq(mediaAttachmentsTable.entityType, "property"),
      eq(mediaAttachmentsTable.entityId, propertyId),
    ))
    .returning();

  if (!deleted) { res.status(404).json({ error: "Not found" }); return; }
  res.status(204).end();
});

router.patch("/properties/:id/profile-photo", async (req: Request, res: Response): Promise<void> => {
  const tenantId = getTenantId(req);
  const propertyId = Number(req.params.id);
  const { fileUrl } = req.body as { fileUrl?: string };
  if (!fileUrl) { res.status(400).json({ error: "fileUrl is required" }); return; }

  const [property] = await db.select({ id: propertiesTable.id })
    .from(propertiesTable)
    .where(and(eq(propertiesTable.id, propertyId), eq(propertiesTable.tenantId, tenantId)))
    .limit(1);
  if (!property) { res.status(404).json({ error: "Property not found" }); return; }

  await db.update(propertiesTable)
    .set({ profilePhotoUrl: fileUrl })
    .where(eq(propertiesTable.id, propertyId));

  res.json({ profilePhotoUrl: fileUrl });
});

// ── Job Media ─────────────────────────────────────────────────────────────────

router.get("/jobs/:id/media", async (req: Request, res: Response): Promise<void> => {
  const tenantId = getTenantId(req);
  const jobId = Number(req.params.id);

  const [job] = await db.select({ id: jobsTable.id })
    .from(jobsTable)
    .where(and(eq(jobsTable.id, jobId), eq(jobsTable.tenantId, tenantId)))
    .limit(1);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }

  const media = await db.select().from(mediaAttachmentsTable)
    .where(and(
      eq(mediaAttachmentsTable.tenantId, tenantId),
      eq(mediaAttachmentsTable.entityType, "job"),
      eq(mediaAttachmentsTable.entityId, jobId),
    ))
    .orderBy(mediaAttachmentsTable.createdAt);

  res.json(await withSignedUrls(media));
});

router.post("/jobs/:id/media", async (req: Request, res: Response): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const jobId = Number(req.params.id);

  const [job] = await db.select({ id: jobsTable.id })
    .from(jobsTable)
    .where(and(eq(jobsTable.id, jobId), eq(jobsTable.tenantId, tenantId)))
    .limit(1);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }

  const { fileKey, fileUrl, mimeType, sizeBytes, caption } = req.body as {
    fileKey?: string; fileUrl?: string; mimeType?: string;
    sizeBytes?: number; caption?: string;
  };
  if (!fileKey || !fileUrl || !mimeType || !sizeBytes) {
    res.status(400).json({ error: "fileKey, fileUrl, mimeType, sizeBytes are required" });
    return;
  }

  const isImage = mimeType.startsWith("image/");
  const isVideo = mimeType.startsWith("video/");
  if (!isImage && !isVideo) {
    res.status(400).json({ error: "Only images and videos are allowed" });
    return;
  }

  const [attachment] = await db.insert(mediaAttachmentsTable).values({
    tenantId,
    entityType: "job",
    entityId: jobId,
    fileKey,
    fileUrl,
    mimeType,
    sizeBytes: Number(sizeBytes),
    caption: caption ?? null,
    isCover: false,
    createdBy: userId,
  }).returning();

  res.status(201).json(attachment);
});

router.delete("/jobs/:id/media/:mediaId", async (req: Request, res: Response): Promise<void> => {
  const tenantId = getTenantId(req);
  const jobId = Number(req.params.id);
  const mediaId = Number(req.params.mediaId);

  const [deleted] = await db.delete(mediaAttachmentsTable)
    .where(and(
      eq(mediaAttachmentsTable.id, mediaId),
      eq(mediaAttachmentsTable.tenantId, tenantId),
      eq(mediaAttachmentsTable.entityType, "job"),
      eq(mediaAttachmentsTable.entityId, jobId),
    ))
    .returning();

  if (!deleted) { res.status(404).json({ error: "Not found" }); return; }
  res.status(204).end();
});

// PATCH /properties/:id/media/:mediaId — update cover state without inserting a new row
router.patch("/properties/:id/media/:mediaId", async (req: Request, res: Response): Promise<void> => {
  const tenantId = getTenantId(req);
  const propertyId = Number(req.params.id);
  const mediaId = Number(req.params.mediaId);
  const { isCover } = req.body as { isCover?: boolean };

  if (isCover === true) {
    // Clear existing cover first
    await db.update(mediaAttachmentsTable)
      .set({ isCover: false })
      .where(and(
        eq(mediaAttachmentsTable.tenantId, tenantId),
        eq(mediaAttachmentsTable.entityType, "property"),
        eq(mediaAttachmentsTable.entityId, propertyId),
        eq(mediaAttachmentsTable.isCover, true),
      ));
  }

  const [updated] = await db.update(mediaAttachmentsTable)
    .set({ isCover: isCover ?? false })
    .where(and(
      eq(mediaAttachmentsTable.id, mediaId),
      eq(mediaAttachmentsTable.tenantId, tenantId),
      eq(mediaAttachmentsTable.entityType, "property"),
      eq(mediaAttachmentsTable.entityId, propertyId),
    ))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

// ── Customer Profile Photo ────────────────────────────────────────────────────

router.patch("/customers/:id/profile-photo", async (req: Request, res: Response): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const customerId = Number(req.params.id);
  const { fileUrl, mimeType, sizeBytes } = req.body as {
    fileUrl?: string; mimeType?: string; sizeBytes?: number;
  };
  if (!fileUrl) { res.status(400).json({ error: "fileUrl is required" }); return; }

  const [customer] = await db.select({ id: customersTable.id })
    .from(customersTable)
    .where(and(eq(customersTable.id, customerId), eq(customersTable.tenantId, tenantId)))
    .limit(1);
  if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }

  await db.update(customersTable)
    .set({ profilePhotoUrl: fileUrl })
    .where(eq(customersTable.id, customerId));

  // Ensure a media_attachments record exists so the object-serving auth
  // can verify tenant ownership when the image is requested.
  const existing = await db
    .select({ id: mediaAttachmentsTable.id })
    .from(mediaAttachmentsTable)
    .where(and(
      eq(mediaAttachmentsTable.fileKey, fileUrl),
      eq(mediaAttachmentsTable.tenantId, tenantId),
    ))
    .limit(1);
  if (existing.length === 0) {
    await db.insert(mediaAttachmentsTable).values({
      tenantId,
      entityType: "customer",
      entityId: customerId,
      fileKey: fileUrl,
      fileUrl,
      mimeType: mimeType ?? "image/jpeg",
      sizeBytes: Number(sizeBytes ?? 0),
      caption: null,
      isCover: true,
      createdBy: userId,
    });
  }

  res.json({ profilePhotoUrl: fileUrl });
});

export default router;
