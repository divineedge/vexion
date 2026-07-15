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
import { db, mediaAttachmentsTable, customerOtpSessionsTable, tenantsTable } from '@workspace/db';
import { eq, and, isNotNull, gt } from 'drizzle-orm';
import { createHash } from 'crypto';

const router: IRouter = Router();
export const objectStorageService = new ObjectStorageService();

function hasAuthenticatedSession(req: Request): boolean {
  // Use header-based auth (x-user-id) consistent with the rest of the API
  const userId = req.headers['x-user-id'];
  const val = Array.isArray(userId) ? userId[0] : userId;
  const id = parseInt(val ?? '', 10);
  return !isNaN(id) && id > 0;
}

function getRequestTenantId(req: Request): number | null {
  const xTenantId = req.headers['x-tenant-id'];
  const val = Array.isArray(xTenantId) ? xTenantId[0] : xTenantId;
  const id = parseInt(val ?? '', 10);
  return !isNaN(id) && id > 0 ? id : null;
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
  async (req: Request, res: Response) => {
    if (!hasAuthenticatedSession(req)) {
      res.status(401).json({ error: 'Unauthorized' });

      return;
    }

    const tenantId = getRequestTenantId(req);
    if (!tenantId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const parsed = RequestUploadUrlBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Missing or invalid required fields' });
      return;
    }

    try {
      const { name, size, contentType } = parsed.data;

      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      const objectPath =
        objectStorageService.normalizeObjectEntityPath(uploadURL);

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
 * Requires auth (staff headers or non-expired portal Bearer token).
 * Verifies tenant ownership via media_attachments before issuing the URL.
 * Used by frontend <img>/<video> elements that cannot include custom headers.
 */
router.get('/storage/read-url', async (req: Request, res: Response) => {
  const objectPath = typeof req.query.objectPath === 'string' ? req.query.objectPath : null;
  if (!objectPath || !objectPath.startsWith('/objects/')) {
    res.status(400).json({ error: 'objectPath query param required (must start with /objects/)' });
    return;
  }

  // Resolve tenant from staff headers or non-expired portal Bearer token
  let resolvedTenantId: number | null = null;

  const xTenantId = req.headers['x-tenant-id'];
  const xUserId   = req.headers['x-user-id'];
  const tenantVal = Array.isArray(xTenantId) ? xTenantId[0] : xTenantId;
  const userVal   = Array.isArray(xUserId)   ? xUserId[0]   : xUserId;
  const parsedTenantId = parseInt(tenantVal ?? '', 10);
  const parsedUserId   = parseInt(userVal   ?? '', 10);

  if (!isNaN(parsedTenantId) && parsedTenantId > 0 && !isNaN(parsedUserId) && parsedUserId > 0) {
    resolvedTenantId = parsedTenantId;
  } else {
    const authHeader = req.headers['authorization'] ?? '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (bearer) {
      const tokenHash = createHash('sha256').update(bearer).digest('hex');
      const [session] = await db
        .select({ tenantId: customerOtpSessionsTable.tenantId })
        .from(customerOtpSessionsTable)
        .where(
          and(
            eq(customerOtpSessionsTable.sessionToken, tokenHash),
            isNotNull(customerOtpSessionsTable.sessionToken),
            // Enforce session expiry — consistent with requirePortalAuth
            gt(customerOtpSessionsTable.expiresAt, new Date()),
          ),
        )
        .limit(1);
      if (session) resolvedTenantId = session.tenantId;
    }
  }

  if (!resolvedTenantId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // Verify tenant ownership
  const [attachment] = await db
    .select({ id: mediaAttachmentsTable.id })
    .from(mediaAttachmentsTable)
    .where(
      and(
        eq(mediaAttachmentsTable.fileKey, objectPath),
        eq(mediaAttachmentsTable.tenantId, resolvedTenantId),
      ),
    )
    .limit(1);

  if (!attachment) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  try {
    const signedUrl = await objectStorageService.generateSignedReadUrl(objectPath);
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

    // ── Tenant resolution ──────────────────────────────────────────────────
    // Staff access: x-user-id + x-tenant-id headers (same pattern as all API routes)
    // Portal access: Authorization: Bearer <portal-session-token> header
    let resolvedTenantId: number | null = null;

    const xTenantId = req.headers['x-tenant-id'];
    const xUserId   = req.headers['x-user-id'];
    const tenantVal = Array.isArray(xTenantId) ? xTenantId[0] : xTenantId;
    const userVal   = Array.isArray(xUserId)   ? xUserId[0]   : xUserId;
    const parsedTenantId = parseInt(tenantVal ?? '', 10);
    const parsedUserId   = parseInt(userVal   ?? '', 10);

    if (!isNaN(parsedTenantId) && parsedTenantId > 0 && !isNaN(parsedUserId) && parsedUserId > 0) {
      resolvedTenantId = parsedTenantId;
    } else {
      // Try portal Bearer token (same expiry check as requirePortalAuth)
      const authHeader = req.headers['authorization'] ?? '';
      const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      if (bearer) {
        const tokenHash = createHash('sha256').update(bearer).digest('hex');
        const [session] = await db
          .select({ tenantId: customerOtpSessionsTable.tenantId })
          .from(customerOtpSessionsTable)
          .where(
            and(
              eq(customerOtpSessionsTable.sessionToken, tokenHash),
              isNotNull(customerOtpSessionsTable.sessionToken),
              gt(customerOtpSessionsTable.expiresAt, new Date()),
            ),
          )
          .limit(1);
        if (session) resolvedTenantId = session.tenantId;
      }
    }

    if (!resolvedTenantId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // ── Tenant ownership check ─────────────────────────────────────────────
    // Verify a media attachment with this fileKey exists for the resolved tenant.
    const [attachment] = await db
      .select({ id: mediaAttachmentsTable.id })
      .from(mediaAttachmentsTable)
      .where(
        and(
          eq(mediaAttachmentsTable.fileKey, objectPath),
          eq(mediaAttachmentsTable.tenantId, resolvedTenantId),
        ),
      )
      .limit(1);

    if (!attachment) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const response = await objectStorageService.downloadObject(objectFile);

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
