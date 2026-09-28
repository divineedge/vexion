import { Readable } from 'stream';
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from '@workspace/api-zod';
import { Router, type IRouter, type Request, type Response } from 'express';

import { ObjectPermission } from '../lib/objectAcl';
// Note: objectStorageService.canAccessObjectEntity is used below to verify
// an object's ACL policy is explicitly public before serving it unauthenticated.
import {
  ObjectNotFoundError,
  ObjectStorageService,
} from '../lib/objectStorage';
import { db, mediaAttachmentsTable, customerOtpSessionsTable, tenantsTable, jobsTable, visitsTable, crewMembersTable, chemicalProductsTable } from '@workspace/db';
import { eq, and, isNotNull, gt } from 'drizzle-orm';
import { createHash } from 'crypto';
import { requireVerifiedStaff, resolveVerifiedStaffIdentity, verifiedStaffIdentity } from '../lib/verifiedStaff';
import { getCallerRole } from '../lib/roles';

const router: IRouter = Router();
export const objectStorageService = new ObjectStorageService();

type StaffUploadIntent = {
  tenantId: number;
  userId: number;
  expiresAt: number;
};

const staffUploadIntents = new Map<string, StaffUploadIntent>();
const STAFF_UPLOAD_INTENT_TTL_MS = 15 * 60 * 1000;

function purgeExpiredStaffUploadIntents(now = Date.now()): void {
  for (const [objectPath, intent] of staffUploadIntents) {
    if (intent.expiresAt <= now) staffUploadIntents.delete(objectPath);
  }
}

function scheduleUnclaimedUploadCleanup(objectPath: string, expiresAt: number): void {
  const timer = setTimeout(() => {
    const intent = staffUploadIntents.get(objectPath);
    if (!intent || intent.expiresAt !== expiresAt) return;
    staffUploadIntents.delete(objectPath);
    void objectStorageService.deleteObjectEntity(objectPath).catch(() => undefined);
  }, Math.max(1, expiresAt - Date.now() + 1_000));
  timer.unref?.();
}

async function resolveObjectReadPrincipal(req: Request): Promise<{ tenantId: number; userId?: number } | null> {
  const staff = await resolveVerifiedStaffIdentity(req);
  if (staff) return staff;
  const rawPortalToken = req.headers['x-portal-token'];
  const portalToken = (Array.isArray(rawPortalToken) ? rawPortalToken[0] : rawPortalToken)
    ?? (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);
  if (!portalToken) return null;
  const tokenHash = createHash('sha256').update(portalToken).digest('hex');
  const [session] = await db.select({ tenantId: customerOtpSessionsTable.tenantId })
    .from(customerOtpSessionsTable)
    .where(and(
      eq(customerOtpSessionsTable.sessionToken, tokenHash),
      isNotNull(customerOtpSessionsTable.sessionToken),
      gt(customerOtpSessionsTable.expiresAt, new Date()),
    )).limit(1);
  return session ?? null;
}

async function staffCanReadAttachment(
  tenantId: number,
  userId: number,
  attachment: { entityType: string; entityId: number },
): Promise<boolean> {
  if (attachment.entityType === 'chemical_sds' || attachment.entityType === 'chemical_msds') {
    const [product] = await db.select({ id: chemicalProductsTable.id }).from(chemicalProductsTable)
      .where(and(eq(chemicalProductsTable.id, attachment.entityId), eq(chemicalProductsTable.tenantId, tenantId))).limit(1);
    return Boolean(product);
  }
  if (await getCallerRole(tenantId, userId) !== 'technician') return true;
  if (attachment.entityType === 'visit') {
    const [visit] = await db.select({ id: visitsTable.id }).from(visitsTable).where(and(
      eq(visitsTable.id, attachment.entityId),
      eq(visitsTable.tenantId, tenantId),
      eq(visitsTable.assigneeId, userId),
    )).limit(1);
    return Boolean(visit);
  }
  if (attachment.entityType === 'job') {
    const [job] = await db.select({ assigneeId: jobsTable.assigneeId, crewId: jobsTable.crewId })
      .from(jobsTable).where(and(eq(jobsTable.id, attachment.entityId), eq(jobsTable.tenantId, tenantId))).limit(1);
    if (!job) return false;
    if (job.assigneeId === userId) return true;
    if (job.crewId == null) return false;
    const [member] = await db.select({ id: crewMembersTable.id }).from(crewMembersTable).where(and(
      eq(crewMembersTable.tenantId, tenantId),
      eq(crewMembersTable.crewId, job.crewId),
      eq(crewMembersTable.userId, userId),
    )).limit(1);
    return Boolean(member);
  }
  return true;
}

export function consumeStaffUploadIntent(
  objectPath: string,
  tenantId: number,
  userId: number,
): boolean {
  purgeExpiredStaffUploadIntents();
  const intent = staffUploadIntents.get(objectPath);
  if (!intent || intent.tenantId !== tenantId || intent.userId !== userId) return false;
  staffUploadIntents.delete(objectPath);
  return true;
}

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload.
 * The client sends JSON metadata (name, size, contentType) — NOT the file.
 * Then uploads the file directly to the returned presigned URL.
 * Requires auth middleware so public callers cannot mint write-capable URLs.
 */
router.post(
  '/storage/uploads/request-url',
  requireVerifiedStaff,
  async (req: Request, res: Response) => {
    const { tenantId, userId } = verifiedStaffIdentity(res);

    const parsed = RequestUploadUrlBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Missing or invalid required fields' });
      return;
    }

    try {
      const { name, size, contentType, scope } = parsed.data;

      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      const objectPath =
        objectStorageService.normalizeObjectEntityPath(uploadURL);
      purgeExpiredStaffUploadIntents();
      if (scope === 'job_media' || scope === 'visit_media' || scope === 'pre_trip_media') {
        const intent = {
          tenantId,
          userId,
          expiresAt: Date.now() + STAFF_UPLOAD_INTENT_TTL_MS,
        };
        staffUploadIntents.set(objectPath, intent);
        scheduleUnclaimedUploadCleanup(objectPath, intent.expiresAt);
      }

      // Stamp ownership at mint time, while the requester is still the only
      // party who could possibly know this freshly-minted objectPath. This is
      // the sole source of truth for "which tenant owns this object" — later
      // requests (e.g. PATCH /settings publishing it as a public logo) must
      // verify this owner stamp before granting any additional visibility.
      //
      // The object itself doesn't exist yet at this point (the client hasn't
      // PUT the file to `uploadURL` yet), so setting its ACL necessarily fails
      // with ObjectNotFoundError. That's expected here — day-to-day read
      // authorization for uploaded files is enforced via the mediaAttachments
      // row (see GET /storage/read-url and /storage/objects/*), not this ACL —
      // so a failed best-effort stamp must not block minting the upload URL.
      try {
        await objectStorageService.trySetObjectEntityAclPolicy(objectPath, {
          owner: String(tenantId),
          visibility: 'private',
        });
      } catch (aclError) {
        if (!(aclError instanceof ObjectNotFoundError)) throw aclError;
      }

      res.json(
        RequestUploadUrlResponse.parse({
          uploadURL,
          objectPath,
          metadata: { name, size, contentType },
        }),
      );
    } catch (error) {
      req.log.error({ err: error }, 'Error generating upload URL');
      res.status(500).json({ error: 'Failed to generate upload URL' });
    }
  },
);

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public — no authentication or ACL checks.
 * IMPORTANT: Always provide this endpoint when object storage is set up.
 */
router.get(
  '/storage/public-objects/*filePath',
  async (req: Request, res: Response) => {
    try {
      const raw = req.params.filePath;
      const filePath = Array.isArray(raw) ? raw.join('/') : raw;
      const file = await objectStorageService.searchPublicObject(filePath);
      if (!file) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      const response = await objectStorageService.downloadObject(file);

      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));

      if (response.body) {
        const nodeStream = Readable.fromWeb(
          response.body as ReadableStream<Uint8Array>,
        );
        nodeStream.pipe(res);
      } else {
        res.end();
      }
    } catch (error) {
      req.log.error({ err: error }, 'Error serving public object');
      res.status(500).json({ error: 'Failed to serve public object' });
    }
  },
);

/**
 * GET /storage/read-url
 *
 * Returns a short-lived signed read URL for a private object.
 * Requires an active staff session or non-expired portal token.
 * Verifies tenant ownership via media_attachments before issuing the URL.
 * Used by frontend <img>/<video> elements that cannot include custom headers.
 */
router.get('/storage/read-url', async (req: Request, res: Response) => {
  const objectPath = typeof req.query.objectPath === 'string' ? req.query.objectPath : null;
  if (!objectPath || !objectPath.startsWith('/objects/')) {
    res.status(400).json({ error: 'objectPath query param required (must start with /objects/)' });
    return;
  }

  const principal = await resolveObjectReadPrincipal(req);
  if (!principal) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // Verify tenant ownership
  const [attachment] = await db
    .select({ id: mediaAttachmentsTable.id, entityType: mediaAttachmentsTable.entityType, entityId: mediaAttachmentsTable.entityId })
    .from(mediaAttachmentsTable)
    .where(
      and(
        eq(mediaAttachmentsTable.fileKey, objectPath),
        eq(mediaAttachmentsTable.tenantId, principal.tenantId),
      ),
    )
    .limit(1);

  if (!attachment || ((!principal.userId || req.headers['x-portal-token']) && ['chemical_sds', 'chemical_msds'].includes(attachment.entityType)) || (principal.userId && !(await staffCanReadAttachment(principal.tenantId, principal.userId, attachment)))) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  try {
    const signedUrl = await objectStorageService.generateSignedReadUrl(objectPath, ['chemical_sds', 'chemical_msds'].includes(attachment.entityType) ? 60 : 3600);
    res.json({ signedUrl });
  } catch (error) {
    req.log.error({ err: error }, 'Error generating signed read URL');
    res.status(500).json({ error: 'Failed to generate signed read URL' });
  }
});

/**
 * GET /storage/objects/*
 *
 * Serve object entities from PRIVATE_OBJECT_DIR.
 * These are served from a separate path from /public-objects and can optionally
 * be protected with authentication or ACL checks based on the use case.
 */
router.get('/storage/objects/*path', async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join('/') : raw;
    const objectPath = `/objects/${wildcardPath}`;

    const principal = await resolveObjectReadPrincipal(req);
    if (!principal) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // ── Tenant ownership check ─────────────────────────────────────────────
    // Verify a media attachment with this fileKey exists for the resolved tenant.
    const [attachment] = await db
      .select({ id: mediaAttachmentsTable.id, entityType: mediaAttachmentsTable.entityType, entityId: mediaAttachmentsTable.entityId })
      .from(mediaAttachmentsTable)
      .where(
        and(
          eq(mediaAttachmentsTable.fileKey, objectPath),
          eq(mediaAttachmentsTable.tenantId, principal.tenantId),
        ),
      )
      .limit(1);

    if (!attachment || ((!principal.userId || req.headers['x-portal-token']) && ['chemical_sds', 'chemical_msds'].includes(attachment.entityType)) || (principal.userId && !(await staffCanReadAttachment(principal.tenantId, principal.userId, attachment)))) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const response = await objectStorageService.downloadObject(objectFile, ['chemical_sds', 'chemical_msds'].includes(attachment.entityType) ? 0 : 3600);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(
        response.body as ReadableStream<Uint8Array>,
      );
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, 'Object not found');
      res.status(404).json({ error: 'Object not found' });
      return;
    }
    req.log.error({ err: error }, 'Error serving object');
    res.status(500).json({ error: 'Failed to serve object' });
  }
});

/**
 * GET /public/tenants/:id/logo
 *
 * Streams a tenant's business logo with no auth/ACL check — logos are
 * intentionally public branding shown on public estimate/invoice/review pages.
 * Uses the tenant's stored logoUrl (a private-storage object path) as the
 * source of truth, so the same upload flow as other private uploads applies.
 */
router.get('/public/tenants/:id/logo', async (req: Request, res: Response) => {
  try {
    const rawId = req.params.id;
    const tenantId = parseInt(Array.isArray(rawId) ? rawId[0] : rawId, 10);
    if (isNaN(tenantId)) { res.status(400).json({ error: 'Invalid tenant id' }); return; }

    const [tenant] = await db.select({ logoUrl: tenantsTable.logoUrl }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
    if (!tenant?.logoUrl) { res.status(404).json({ error: 'No logo set' }); return; }

    const objectFile = await objectStorageService.getObjectEntityFile(tenant.logoUrl);

    // Security: only serve objects (a) whose ACL policy was explicitly stamped
    // public by PATCH /settings when the tenant designated it as their logo,
    // AND (b) whose ACL owner is this same tenant (owner was stamped at
    // upload-mint time, before PATCH /settings could ever touch it). Both
    // checks together prevent serving an arbitrary/guessed private object
    // path that happens to end up in tenants.logoUrl through some other bug.
    const [isPublic, owner] = await Promise.all([
      objectStorageService.canAccessObjectEntity({ objectFile, requestedPermission: ObjectPermission.READ }),
      objectStorageService.getObjectEntityAclOwner(objectFile),
    ]);
    if (!isPublic || owner !== String(tenantId)) { res.status(403).json({ error: 'Logo object is not public' }); return; }

    const response = await objectStorageService.downloadObject(objectFile);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.setHeader('Cache-Control', 'public, max-age=300');

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: 'Logo not found' });
      return;
    }
    req.log.error({ err: error }, 'Error serving tenant logo');
    res.status(500).json({ error: 'Failed to serve logo' });
  }
});

export default router;
