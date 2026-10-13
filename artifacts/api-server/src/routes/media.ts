import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { mediaAttachmentsTable, propertiesTable, jobsTable, customersTable, equipmentMaintenanceTable, visitsTable, crewMembersTable, internalTasksTable } from "@workspace/db";
import { eq, and, or } from "drizzle-orm";
import { getTenantId, getUserId } from "../lib/tenantHelper";
import { ObjectStorageService } from "../lib/objectStorage";
import { getCallerRole } from "../lib/roles";
import { requireVerifiedStaff, verifiedStaffIdentity } from "../lib/verifiedStaff";
import { canAccessEquipment } from "../lib/equipmentAccess";
import { findEquipmentInspection } from "../lib/equipmentInspections";
import { consumeStaffUploadIntent } from "./storage";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { createWriteStream, unlinkSync, statSync, readFileSync } from "fs";
import { spawn } from "child_process";
import { pipeline } from "stream/promises";

const objectStorageService = new ObjectStorageService();

// ── Video compression helpers ─────────────────────────────────────────────────

/**
 * Download a GCS object to a temp file, transcode to 720p H.264 MP4 via ffmpeg,
 * then upload the compressed version back (overwriting the original key).
 *
 * Returns { compressed: true, sizeBytes } on success, or { compressed: false } if
 * ffmpeg is unavailable or transcoding fails.
 */
async function compressVideo(
  fileKey: string,
): Promise<{ compressed: true; sizeBytes: number } | { compressed: false }> {
  const id = randomUUID();
  const tmpIn = join(tmpdir(), `video-in-${id}`);
  const tmpOut = join(tmpdir(), `video-out-${id}.mp4`);
  try {
    // --- 1. Download from GCS using the same path resolution as ObjectStorageService ---
    const gcsFile = await objectStorageService.getObjectEntityFile(fileKey);

    const nodeStream = gcsFile.createReadStream();
    await pipeline(nodeStream, createWriteStream(tmpIn));

    // --- 2. Transcode with ffmpeg ---
    const compressed = await new Promise<boolean>((resolve) => {
      const ff = spawn(
        "ffmpeg",
        [
          "-i", tmpIn,
          "-vf", "scale=-2:min(720\\,ih)",  // cap at 720p, keep aspect
          "-c:v", "libx264",
          "-crf", "28",
          "-preset", "fast",
          "-c:a", "aac",
          "-b:a", "128k",
          "-movflags", "+faststart",         // moov atom at front → instant play
          "-y",
          tmpOut,
        ],
        { stdio: "ignore" },
      );
      ff.on("error", () => resolve(false));
      ff.on("close", (code) => resolve(code === 0));
    });

    if (!compressed) return { compressed: false };

    // --- 3. Upload back to GCS (same key, overwrite) ---
    const newBytes = statSync(tmpOut).size;
    const buf = readFileSync(tmpOut);
    await gcsFile.save(buf, { contentType: "video/mp4", resumable: false });

    return { compressed: true, sizeBytes: newBytes };
  } catch {
    return { compressed: false };
  } finally {
    for (const f of [tmpIn, tmpOut]) {
      try { unlinkSync(f); } catch { /* ignore */ }
    }
  }
}

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

const MAX_MEDIA_SIZE_BYTES = 10 * 1024 * 1024;

async function canAccessAssignedEntity(
  tenantId: number,
  userId: number,
  entityType: "job" | "visit",
  entityId: number,
): Promise<boolean> {
  const role = await getCallerRole(tenantId, userId);
  if (role !== "technician") return true;

  if (entityType === "job") {
    const [job] = await db.select({ assigneeId: jobsTable.assigneeId, crewId: jobsTable.crewId })
      .from(jobsTable)
      .where(and(eq(jobsTable.id, entityId), eq(jobsTable.tenantId, tenantId)))
      .limit(1);
    if (!job) return false;
    if (job.assigneeId === userId) return true;
    if (job.crewId == null) return false;
    const [membership] = await db.select({ id: crewMembersTable.id })
      .from(crewMembersTable)
      .where(and(
        eq(crewMembersTable.tenantId, tenantId),
        eq(crewMembersTable.crewId, job.crewId),
        eq(crewMembersTable.userId, userId),
      ))
      .limit(1);
    return Boolean(membership);
  }

  const [visit] = await db.select({ assigneeId: visitsTable.assigneeId })
    .from(visitsTable)
    .where(and(eq(visitsTable.id, entityId), eq(visitsTable.tenantId, tenantId)))
    .limit(1);
  return visit?.assigneeId === userId;
}

async function cleanupUploadedObject(fileKey: string | undefined): Promise<void> {
  if (!fileKey?.startsWith("/objects/")) return;
  try {
    await objectStorageService.deleteObjectEntity(fileKey);
  } catch {
    // Cleanup is best effort. The attachment row is never created when this
    // fails, so a later storage sweep can identify the unreferenced object.
  }
}

function isSupportedMedia(mimeType: string, allowPdf = false): boolean {
  return mimeType.startsWith("image/") || mimeType.startsWith("video/") || (allowPdf && mimeType === "application/pdf");
}

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

  let finalSizeBytes = Number(sizeBytes);
  let videoCompressed: boolean | null = null;

  if (isVideo) {
    const result = await compressVideo(fileKey);
    videoCompressed = result.compressed;
    if (result.compressed) finalSizeBytes = result.sizeBytes;
  }

  const [attachment] = await db.insert(mediaAttachmentsTable).values({
    tenantId,
    entityType: "property",
    entityId: propertyId,
    fileKey,
    fileUrl,
    mimeType: (isVideo && videoCompressed) ? "video/mp4" : mimeType,
    sizeBytes: finalSizeBytes,
    caption: caption ?? null,
    isCover: isCover ?? false,
    videoCompressed,
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

router.get("/jobs/:id/media", requireVerifiedStaff, async (req: Request, res: Response): Promise<void> => {
  const { tenantId, userId } = verifiedStaffIdentity(res);
  const jobId = Number(req.params.id);

  const [job] = await db.select({ id: jobsTable.id })
    .from(jobsTable)
    .where(and(eq(jobsTable.id, jobId), eq(jobsTable.tenantId, tenantId)))
    .limit(1);
  if (!job || !(await canAccessAssignedEntity(tenantId, userId, "job", jobId))) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const media = await db.select().from(mediaAttachmentsTable)
    .where(and(
      eq(mediaAttachmentsTable.tenantId, tenantId),
      eq(mediaAttachmentsTable.entityType, "job"),
      eq(mediaAttachmentsTable.entityId, jobId),
    ))
    .orderBy(mediaAttachmentsTable.createdAt);

  res.json(await withSignedUrls(media));
});

router.post("/jobs/:id/media", requireVerifiedStaff, async (req: Request, res: Response): Promise<void> => {
  const { tenantId, userId } = verifiedStaffIdentity(res);
  const jobId = Number(req.params.id);

  const [job] = await db.select({ id: jobsTable.id })
    .from(jobsTable)
    .where(and(eq(jobsTable.id, jobId), eq(jobsTable.tenantId, tenantId)))
    .limit(1);
  if (!job || !(await canAccessAssignedEntity(tenantId, userId, "job", jobId))) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const { fileKey, fileUrl, mimeType, sizeBytes, caption } = req.body as {
    fileKey?: string; fileUrl?: string; mimeType?: string;
    sizeBytes?: number; caption?: string;
  };
  if (!fileKey || !fileUrl) {
    res.status(400).json({ error: "fileKey, fileUrl, mimeType, sizeBytes are required" });
    return;
  }

  if (!consumeStaffUploadIntent(fileKey, tenantId, userId)) {
    res.status(400).json({ error: "Upload is missing, expired, or belongs to another staff member" });
    return;
  }
  if (!mimeType || !sizeBytes || fileKey !== fileUrl || !isSupportedMedia(mimeType) || Number(sizeBytes) > MAX_MEDIA_SIZE_BYTES) {
    await cleanupUploadedObject(fileKey);
    res.status(400).json({ error: "Only images and videos up to 10 MB are allowed" });
    return;
  }

  try {
    const validated = await objectStorageService.validateUploadedMedia(fileKey, MAX_MEDIA_SIZE_BYTES);
    const validatedMimeType = validated.contentType;
    const isVideo = validatedMimeType.startsWith("video/");
    let finalSizeBytes = validated.sizeBytes;
    let videoCompressed: boolean | null = null;
    if (isVideo) {
      const result = await compressVideo(fileKey);
      videoCompressed = result.compressed;
      if (result.compressed) finalSizeBytes = result.sizeBytes;
    }

    const [attachment] = await db.insert(mediaAttachmentsTable).values({
      tenantId,
      entityType: "job",
      entityId: jobId,
      fileKey,
      fileUrl,
      mimeType: (isVideo && videoCompressed) ? "video/mp4" : validatedMimeType,
      sizeBytes: finalSizeBytes,
      caption: caption?.trim() || null,
      isCover: false,
      videoCompressed,
      createdBy: userId,
      source: "staff",
    }).returning();
    res.status(201).json(attachment);
  } catch (error) {
    await cleanupUploadedObject(fileKey);
    req.log.error({ err: error, jobId }, "Failed to save job media; uploaded object cleaned up");
    res.status(500).json({ error: "Failed to save media attachment" });
  }
});

router.delete("/jobs/:id/media/:mediaId", requireVerifiedStaff, async (req: Request, res: Response): Promise<void> => {
  const { tenantId, userId } = verifiedStaffIdentity(res);
  const jobId = Number(req.params.id);
  const mediaId = Number(req.params.mediaId);

  if (!(await canAccessAssignedEntity(tenantId, userId, "job", jobId))) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [attachment] = await db.select().from(mediaAttachmentsTable).where(and(
    eq(mediaAttachmentsTable.id, mediaId),
    eq(mediaAttachmentsTable.tenantId, tenantId),
    eq(mediaAttachmentsTable.entityType, "job"),
    eq(mediaAttachmentsTable.entityId, jobId),
  )).limit(1);

  if (!attachment) { res.status(404).json({ error: "Not found" }); return; }
  try {
    await objectStorageService.deleteObjectEntity(attachment.fileKey);
    await db.delete(mediaAttachmentsTable).where(eq(mediaAttachmentsTable.id, attachment.id));
  } catch (error) {
    req.log.error({ err: error, mediaId }, "Failed to delete job media object");
    res.status(502).json({ error: "Unable to delete media attachment" });
    return;
  }
  res.status(204).end();
});

// ── Visit Media ──────────────────────────────────────────────────────────────

router.get("/visits/:id/media", requireVerifiedStaff, async (req: Request, res: Response): Promise<void> => {
  const { tenantId, userId } = verifiedStaffIdentity(res);
  const visitId = Number(req.params.id);
  const [visit] = await db.select({ id: visitsTable.id })
    .from(visitsTable)
    .where(and(eq(visitsTable.id, visitId), eq(visitsTable.tenantId, tenantId)))
    .limit(1);
  if (!visit || !(await canAccessAssignedEntity(tenantId, userId, "visit", visitId))) {
    res.status(404).json({ error: "Visit not found" });
    return;
  }
  const media = await db.select().from(mediaAttachmentsTable)
    .where(and(
      eq(mediaAttachmentsTable.tenantId, tenantId),
      eq(mediaAttachmentsTable.entityType, "visit"),
      eq(mediaAttachmentsTable.entityId, visitId),
    ))
    .orderBy(mediaAttachmentsTable.createdAt);
  res.json(await withSignedUrls(media));
});

router.post("/visits/:id/media", requireVerifiedStaff, async (req: Request, res: Response): Promise<void> => {
  const { tenantId, userId } = verifiedStaffIdentity(res);
  const visitId = Number(req.params.id);
  const [visit] = await db.select({ id: visitsTable.id })
    .from(visitsTable)
    .where(and(eq(visitsTable.id, visitId), eq(visitsTable.tenantId, tenantId)))
    .limit(1);
  if (!visit || !(await canAccessAssignedEntity(tenantId, userId, "visit", visitId))) {
    res.status(404).json({ error: "Visit not found" });
    return;
  }

  const { fileKey, fileUrl, mimeType, sizeBytes, caption } = req.body as {
    fileKey?: string; fileUrl?: string; mimeType?: string; sizeBytes?: number; caption?: string;
  };
  if (!fileKey || !fileUrl) {
    res.status(400).json({ error: "fileKey, fileUrl, mimeType, sizeBytes are required" });
    return;
  }
  if (!consumeStaffUploadIntent(fileKey, tenantId, userId)) {
    res.status(400).json({ error: "Upload is missing, expired, or belongs to another staff member" });
    return;
  }
  if (!mimeType || !sizeBytes || fileKey !== fileUrl || !isSupportedMedia(mimeType) || Number(sizeBytes) > MAX_MEDIA_SIZE_BYTES) {
    await cleanupUploadedObject(fileKey);
    res.status(400).json({ error: "Only images and videos up to 10 MB are allowed" });
    return;
  }

  try {
    const validated = await objectStorageService.validateUploadedMedia(fileKey, MAX_MEDIA_SIZE_BYTES);
    const validatedMimeType = validated.contentType;
    let finalSizeBytes = validated.sizeBytes;
    let videoCompressed: boolean | null = null;
    if (validatedMimeType.startsWith("video/")) {
      const result = await compressVideo(fileKey);
      videoCompressed = result.compressed;
      if (result.compressed) finalSizeBytes = result.sizeBytes;
    }
    const [attachment] = await db.insert(mediaAttachmentsTable).values({
      tenantId,
      entityType: "visit",
      entityId: visitId,
      fileKey,
      fileUrl,
      mimeType: videoCompressed ? "video/mp4" : validatedMimeType,
      sizeBytes: finalSizeBytes,
      caption: caption?.trim() || null,
      isCover: false,
      videoCompressed,
      createdBy: userId,
      source: "staff",
    }).returning();
    res.status(201).json(attachment);
  } catch (error) {
    await cleanupUploadedObject(fileKey);
    req.log.error({ err: error, visitId }, "Failed to save visit media; uploaded object cleaned up");
    res.status(500).json({ error: "Failed to save media attachment" });
  }
});

router.delete("/visits/:id/media/:mediaId", requireVerifiedStaff, async (req: Request, res: Response): Promise<void> => {
  const { tenantId, userId } = verifiedStaffIdentity(res);
  const visitId = Number(req.params.id);
  const mediaId = Number(req.params.mediaId);
  if (!(await canAccessAssignedEntity(tenantId, userId, "visit", visitId))) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [attachment] = await db.select().from(mediaAttachmentsTable).where(and(
    eq(mediaAttachmentsTable.id, mediaId),
    eq(mediaAttachmentsTable.tenantId, tenantId),
    eq(mediaAttachmentsTable.entityType, "visit"),
    eq(mediaAttachmentsTable.entityId, visitId),
  )).limit(1);
  if (!attachment) { res.status(404).json({ error: "Not found" }); return; }
  try {
    await objectStorageService.deleteObjectEntity(attachment.fileKey);
    await db.delete(mediaAttachmentsTable).where(eq(mediaAttachmentsTable.id, attachment.id));
  } catch (error) {
    req.log.error({ err: error, mediaId }, "Failed to delete visit media object");
    res.status(502).json({ error: "Unable to delete media attachment" });
    return;
  }
  res.status(204).end();
});

router.get("/equipment/pre-trip/:id/media", requireVerifiedStaff, async (req: Request, res: Response): Promise<void> => {
  const { tenantId, userId } = verifiedStaffIdentity(res);
  const taskId = String(req.params.id);
  const task = await findEquipmentInspection(tenantId, taskId);
  if (!task || task.equipmentId == null || !(await canAccessEquipment(tenantId, userId, task.equipmentId))) { res.status(404).json({ error: "Pre-trip inspection not found" }); return; }
  const rows = await db.select().from(mediaAttachmentsTable).where(and(eq(mediaAttachmentsTable.tenantId, tenantId), eq(mediaAttachmentsTable.entityType, task.mediaEntityType), eq(mediaAttachmentsTable.entityId, task.id)));
  res.json(await withSignedUrls(rows));
});

router.post("/equipment/pre-trip/:id/media", requireVerifiedStaff, async (req: Request, res: Response): Promise<void> => {
  const { tenantId, userId } = verifiedStaffIdentity(res);
  const taskId = String(req.params.id);
  const task = await findEquipmentInspection(tenantId, taskId);
  if (!task || task.equipmentId == null || !(await canAccessEquipment(tenantId, userId, task.equipmentId))) { res.status(404).json({ error: "Pre-trip inspection not found" }); return; }
  const { fileKey, fileUrl, mimeType, sizeBytes, caption } = req.body;
  if (!fileKey || !fileUrl || !mimeType || !sizeBytes || fileKey !== fileUrl || !consumeStaffUploadIntent(fileKey, tenantId, userId) || !isSupportedMedia(mimeType) || Number(sizeBytes) > MAX_MEDIA_SIZE_BYTES) {
    if (fileKey) await cleanupUploadedObject(fileKey);
    res.status(400).json({ error: "Only newly uploaded images and videos up to 10 MB are allowed" }); return;
  }
  try {
    const validated = await objectStorageService.validateUploadedMedia(fileKey, MAX_MEDIA_SIZE_BYTES);
    let finalSizeBytes = validated.sizeBytes;
    let videoCompressed: boolean | null = null;
    if (validated.contentType.startsWith("video/")) {
      const result = await compressVideo(fileKey);
      videoCompressed = result.compressed;
      if (result.compressed) finalSizeBytes = result.sizeBytes;
    }
    const [attachment] = await db.insert(mediaAttachmentsTable).values({ tenantId, entityType: task.mediaEntityType, entityId: task.id, fileKey, fileUrl, mimeType: videoCompressed ? "video/mp4" : validated.contentType, sizeBytes: finalSizeBytes, caption: caption?.trim() || null, isCover: false, videoCompressed, createdBy: userId, source: "staff" }).returning();
    res.status(201).json(attachment);
  } catch (error) {
    await cleanupUploadedObject(fileKey);
    req.log.error({ err: error, taskId }, "Failed to save pre-trip media");
    res.status(500).json({ error: "Failed to save media attachment" });
  }
});

router.delete("/equipment/pre-trip/:id/media/:mediaId", requireVerifiedStaff, async (req: Request, res: Response): Promise<void> => {
  const { tenantId, userId } = verifiedStaffIdentity(res);
  const taskId = String(req.params.id);
  const mediaId = Number(req.params.mediaId);
  const task = await findEquipmentInspection(tenantId, taskId);
  if (!task || task.equipmentId == null || !(await canAccessEquipment(tenantId, userId, task.equipmentId))) { res.status(404).json({ error: "Not found" }); return; }
  const [attachment] = await db.select().from(mediaAttachmentsTable).where(and(eq(mediaAttachmentsTable.id, mediaId), eq(mediaAttachmentsTable.tenantId, tenantId), eq(mediaAttachmentsTable.entityType, task.mediaEntityType), eq(mediaAttachmentsTable.entityId, task.id))).limit(1);
  if (!attachment) { res.status(404).json({ error: "Not found" }); return; }
  await objectStorageService.deleteObjectEntity(attachment.fileKey);
  await db.delete(mediaAttachmentsTable).where(eq(mediaAttachmentsTable.id, mediaId));
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

// ── Equipment Maintenance Media ─────────────────────────────────────────────────

router.get("/equipment/maintenance/:id/media", requireVerifiedStaff, async (req: Request, res: Response): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const maintenanceId = Number(req.params.id);

  const [record] = await db.select({ id: equipmentMaintenanceTable.id, equipmentId: equipmentMaintenanceTable.equipmentId })
    .from(equipmentMaintenanceTable)
    .where(and(eq(equipmentMaintenanceTable.id, maintenanceId), eq(equipmentMaintenanceTable.tenantId, tenantId)))
    .limit(1);
  if (!record) { res.status(404).json({ error: "Maintenance record not found" }); return; }
  if (!(await canAccessEquipment(tenantId, userId, record.equipmentId))) { res.status(404).json({ error: "Maintenance record not found" }); return; }

  const media = await db.select().from(mediaAttachmentsTable)
    .where(and(
      eq(mediaAttachmentsTable.tenantId, tenantId),
      eq(mediaAttachmentsTable.entityType, "equipment_maintenance"),
      eq(mediaAttachmentsTable.entityId, maintenanceId),
    ))
    .orderBy(mediaAttachmentsTable.createdAt);

  res.json(await withSignedUrls(media));
});

router.post("/equipment/maintenance/:id/media", requireVerifiedStaff, async (req: Request, res: Response): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const maintenanceId = Number(req.params.id);

  const [record] = await db.select({ id: equipmentMaintenanceTable.id, equipmentId: equipmentMaintenanceTable.equipmentId })
    .from(equipmentMaintenanceTable)
    .where(and(eq(equipmentMaintenanceTable.id, maintenanceId), eq(equipmentMaintenanceTable.tenantId, tenantId)))
    .limit(1);
  if (!record) { res.status(404).json({ error: "Maintenance record not found" }); return; }
  if (!(await canAccessEquipment(tenantId, userId, record.equipmentId))) { res.status(404).json({ error: "Maintenance record not found" }); return; }

  const { fileKey, fileUrl, mimeType, sizeBytes, caption } = req.body as {
    fileKey?: string; fileUrl?: string; mimeType?: string;
    sizeBytes?: number; caption?: string;
  };
  if (!fileKey || !fileUrl || !mimeType || !sizeBytes) {
    res.status(400).json({ error: "fileKey, fileUrl, mimeType, sizeBytes are required" });
    return;
  }

  const isImage = mimeType.startsWith("image/");
  const isPdf = mimeType === "application/pdf";
  if (!isImage && !isPdf) {
    res.status(400).json({ error: "Only images and PDF receipts are allowed" });
    return;
  }

  const [attachment] = await db.insert(mediaAttachmentsTable).values({
    tenantId,
    entityType: "equipment_maintenance",
    entityId: maintenanceId,
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

router.delete("/equipment/maintenance/:id/media/:mediaId", requireVerifiedStaff, async (req: Request, res: Response): Promise<void> => {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const maintenanceId = Number(req.params.id);
  const mediaId = Number(req.params.mediaId);
  const [record] = await db.select({ equipmentId: equipmentMaintenanceTable.equipmentId }).from(equipmentMaintenanceTable).where(and(
    eq(equipmentMaintenanceTable.id, maintenanceId),
    eq(equipmentMaintenanceTable.tenantId, tenantId),
  )).limit(1);
  if (!record || !(await canAccessEquipment(tenantId, userId, record.equipmentId))) { res.status(404).json({ error: "Not found" }); return; }

  const [deleted] = await db.delete(mediaAttachmentsTable)
    .where(and(
      eq(mediaAttachmentsTable.id, mediaId),
      eq(mediaAttachmentsTable.tenantId, tenantId),
      eq(mediaAttachmentsTable.entityType, "equipment_maintenance"),
      eq(mediaAttachmentsTable.entityId, maintenanceId),
    ))
    .returning();

  if (!deleted) { res.status(404).json({ error: "Not found" }); return; }
  res.status(204).end();
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
