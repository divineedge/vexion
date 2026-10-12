import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import { File, Storage } from '@google-cloud/storage';

import {
  canAccessObject,
  getObjectAclPolicy,
  ObjectAclPolicy,
  ObjectPermission,
  setObjectAclPolicy,
} from './objectAcl';

const REPLIT_SIDECAR_ENDPOINT = 'http://127.0.0.1:1106';

export const objectStorageClient = new Storage({
  credentials: {
    audience: 'replit',
    subject_token_type: 'access_token',
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: 'external_account',
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: 'json',
        subject_token_field_name: 'access_token',
      },
    },
    universe_domain: 'googleapis.com',
  },
  projectId: '',
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super('Object not found');
    this.name = 'ObjectNotFoundError';
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  constructor() {}

  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || '';
    const paths = Array.from(
      new Set(
        pathsStr
          .split(',')
          .map((path) => path.trim())
          .filter((path) => path.length > 0),
      ),
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' " +
          'tool and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths).',
      );
    }
    return paths;
  }

  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || '';
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          'tool and set PRIVATE_OBJECT_DIR env var.',
      );
    }
    return dir;
  }

  async searchPublicObject(filePath: string): Promise<File | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;

      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      const [exists] = await file.exists();
      if (exists) {
        return file;
      }
    }

    return null;
  }

  async downloadObject(
    file: File,
    cacheTtlSec: number = 3600,
  ): Promise<Response> {
    const [metadata] = await file.getMetadata();
    if(file.name.split("/").includes("hr-documents")||metadata.metadata?.hrPrivate==="true")throw new Error("HR files require the private personnel download endpoint");
    const aclPolicy = await getObjectAclPolicy(file);
    const isPublic = aclPolicy?.visibility === 'public';

    const nodeStream = file.createReadStream();
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    const headers: Record<string, string> = {
      'Content-Type':
        (metadata.contentType as string) || 'application/octet-stream',
      'Cache-Control': `${isPublic ? 'public' : 'private'}, max-age=${cacheTtlSec}`,
    };
    if (metadata.size) {
      headers['Content-Length'] = String(metadata.size);
    }

    return new Response(webStream, { headers });
  }

  async getObjectEntityUploadURL(): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    if (!privateObjectDir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          'tool and set PRIVATE_OBJECT_DIR env var.',
      );
    }

    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;

    const { bucketName, objectName } = parseObjectPath(fullPath);

    return signObjectURL({
      bucketName,
      objectName,
      method: 'PUT',
      ttlSec: 900,
    });
  }

  /** Server-proxied documents: no public ACL and no generic upload intent. */
  async savePrivatePdf(bytes: Buffer): Promise<string> {
    const key = `chemical-documents/${randomUUID()}`;
    const { bucketName, objectName } = parseObjectPath(`${this.getPrivateObjectDir()}/${key}`);
    const file = objectStorageClient.bucket(bucketName).file(objectName);
    await file.save(bytes, {
      resumable: false,
      metadata: { contentType: 'application/pdf', cacheControl: 'private, no-store' },
    });
    return `/objects/${key}`;
  }
  async saveHrDocument(bytes:Buffer,mimeType:string):Promise<string>{
    const key=`hr-documents/${randomUUID()}`;
    const {bucketName,objectName}=parseObjectPath(`${this.getPrivateObjectDir()}/${key}`);
    await objectStorageClient.bucket(bucketName).file(objectName).save(bytes,{resumable:false,
      metadata:{contentType:mimeType,cacheControl:"private, no-store",metadata:{hrPrivate:"true"}}});
    return `/objects/${key}`;
  }

  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (!objectPath.startsWith('/objects/')) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split('/');
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join('/');
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith('/')) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const objectFile = bucket.file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return objectFile;
  }

  /**
   * Remove an uploaded private object. Missing objects are treated as already
   * cleaned up so callers can safely use this during failed attachment flows.
   */
  async deleteObjectEntity(objectPath: string): Promise<void> {
    try {
      const objectFile = await this.getObjectEntityFile(objectPath);
      await objectFile.delete({ ignoreNotFound: true });
    } catch (error) {
      if (error instanceof ObjectNotFoundError) return;
      throw error;
    }
  }

  async validateUploadedMedia(
    objectPath: string,
    maxSizeBytes: number,
  ): Promise<{ sizeBytes: number; contentType: string }> {
    const objectFile = await this.getObjectEntityFile(objectPath);
    const [metadata] = await objectFile.getMetadata();
    const sizeBytes = Number(metadata.size ?? 0);
    const contentType = String(metadata.contentType ?? '').toLowerCase();
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > maxSizeBytes) {
      throw new Error('Uploaded media exceeds the file size limit');
    }
    if (!contentType.startsWith('image/') && !contentType.startsWith('video/')) {
      throw new Error('Uploaded object is not image or video media');
    }

    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      objectFile.createReadStream({ start: 0, end: 31 })
        .on('data', chunk => chunks.push(Buffer.from(chunk)))
        .on('error', reject)
        .on('end', resolve);
    });
    const bytes = Buffer.concat(chunks);
    const ascii = bytes.toString('ascii');
    const isImage =
      bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ||
      bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
      ascii.startsWith('GIF8') ||
      (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') ||
      ascii.slice(4, 12).includes('ftyphei') ||
      ascii.slice(4, 12).includes('ftypmif');
    const isVideo =
      ascii.slice(4, 8) === 'ftyp' ||
      bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    if ((contentType.startsWith('image/') && !isImage) || (contentType.startsWith('video/') && !isVideo)) {
      throw new Error('Uploaded object content does not match its media type');
    }
    return { sizeBytes, contentType };
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (!rawPath.startsWith('https://storage.googleapis.com/')) {
      return rawPath;
    }

    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;

    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith('/')) {
      objectEntityDir = `${objectEntityDir}/`;
    }

    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }

    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy,
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith('/')) {
      return normalizedPath;
    }

    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: File;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    const [metadata]=await objectFile.getMetadata();
    if(objectFile.name.split("/").includes("hr-documents")||metadata.metadata?.hrPrivate==="true")return false;
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }

  async getObjectEntityAclOwner(objectFile: File): Promise<string | null> {
    const aclPolicy = await getObjectAclPolicy(objectFile);
    return aclPolicy?.owner ?? null;
  }

  /**
   * Generate a short-lived signed read URL for a private object.
   * @param objectPath e.g. "/objects/uploads/uuid"
   * @param ttlSec URL lifetime in seconds (default 3600 = 1 hour)
   */
  async generateSignedReadUrl(objectPath: string, ttlSec = 3600): Promise<string> {
    if(objectPath.startsWith("/objects/hr-documents/"))throw new Error("HR files cannot use generic signed URLs");
    const { bucketName, objectName } = parseObjectPath(
      `${this.getPrivateObjectDir()}/${objectPath.replace(/^\/objects\//, '')}`,
    );
    return signObjectURL({ bucketName, objectName, method: 'GET', ttlSec });
  }
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith('/')) {
    path = `/${path}`;
  }
  const pathParts = path.split('/');
  if (pathParts.length < 3) {
    throw new Error('Invalid path: must contain at least a bucket name');
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join('/');

  return {
    bucketName,
    objectName,
  };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: 'GET' | 'PUT' | 'DELETE' | 'HEAD';
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, ` +
        `make sure you're running on Replit`,
    );
  }

  const data = (await response.json()) as { signed_url: string };
  return data.signed_url;
}
