import multer from "multer";

export const COMPANY_LOGO_BUCKET = "company-logos";
export const MAX_LOGO_BYTES = 10 * 1024 * 1024;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_LOGO_BYTES, files: 1, fields: 2 },
});

/** Public read for the logo bucket, and a service-role upload path that does not depend on a user JWT. */
export const companyLogoBucketSql = `DO $logo$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'storage' AND table_name = 'buckets'
  ) THEN
    BEGIN
      INSERT INTO storage.buckets (id, name, public)
      VALUES ('${COMPANY_LOGO_BUCKET}', '${COMPANY_LOGO_BUCKET}', true)
      ON CONFLICT (id) DO UPDATE SET public = true;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'storage' AND table_name = 'objects'
  ) THEN
    BEGIN
      DROP POLICY IF EXISTS company_logos_public_read ON storage.objects;
      CREATE POLICY company_logos_public_read ON storage.objects
        FOR SELECT TO public
        USING (bucket_id = '${COMPANY_LOGO_BUCKET}');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
END
$logo$`;

export function isSafeSvg(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith("<") || !/<\/svg>\s*$/i.test(trimmed)) return false;
  if (/<script/i.test(text) || /javascript:/i.test(text) || /\son[a-z]+\s*=/i.test(text) || /<foreignObject/i.test(text)) return false;
  return /<svg[\s>]/i.test(trimmed);
}

export function logoContentType(buffer: Buffer): string | null {
  if (buffer.length > MAX_LOGO_BYTES) return null;
  if (buffer.length >= PNG.length && buffer.subarray(0, PNG.length).equals(PNG)) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buffer.length >= 6 && (buffer.toString("ascii", 0, 6) === "GIF87a" || buffer.toString("ascii", 0, 6) === "GIF89a")) return "image/gif";
  if (buffer.length > 0 && buffer.length <= 1_000_000) {
    const text = buffer.toString("utf8");
    if (isSafeSvg(text)) return "image/svg+xml";
  }
  return null;
}

export function logoExtension(contentType: string): string {
  switch (contentType) {
    case "image/png": return "png";
    case "image/jpeg": return "jpg";
    case "image/webp": return "webp";
    case "image/gif": return "gif";
    case "image/svg+xml": return "svg";
    default: return "bin";
  }
}

export function companyLogoObjectPath(tenantId: number, contentType: string): string {
  return `${tenantId}/logo.${logoExtension(contentType)}`;
}

export function supabasePublicObjectUrl(supabaseUrl: string, bucket: string, objectPath: string): string {
  const base = supabaseUrl.replace(/\/+$/, "");
  const encoded = objectPath.split("/").map(encodeURIComponent).join("/");
  return `${base}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encoded}`;
}

export function publicLogoUrl(origin: string, tenantId: number): string {
  return `${origin.replace(/\/+$/, "")}/api/public/tenants/${tenantId}/logo`;
}

/** Appends a cache-busting query so a replacement at the same path is not shown from cache. */
export function withLogoCacheBust(logoUrl: string, stamp: number): string {
  const separator = logoUrl.includes("?") ? "&" : "?";
  return `${logoUrl}${separator}t=${stamp}`;
}

export function isPublishableLogoUrl(logoUrl: string, origin: string): boolean {
  try {
    const target = new URL(logoUrl);
    if (target.protocol !== "https:" && target.protocol !== "http:") return false;
    const configured = process.env.SUPABASE_URL?.trim();
    if (configured) {
      const supabase = new URL(configured);
      if (target.origin === supabase.origin && target.pathname.includes("/storage/v1/object/public/")) return true;
    }
    const own = new URL(origin);
    return target.origin === own.origin && target.pathname.startsWith("/api/public/tenants/");
  } catch {
    return false;
  }
}

export function requestOrigin(req: { protocol: string; get(name: string): string | undefined }): string {
  const configured = process.env.PUBLIC_APP_URL || process.env.APP_URL;
  if (configured?.trim()) return configured.trim().replace(/\/+$/, "");
  const host = req.get("x-forwarded-host")?.split(",")[0]?.trim() || req.get("host") || "localhost";
  const proto = req.get("x-forwarded-proto")?.split(",")[0]?.trim() || req.protocol || "https";
  return `${proto}://${host}`;
}

export function supabaseStorageConfig(): { url: string; key: string; bucket: string } | null {
  const url = process.env.SUPABASE_URL?.trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY)?.trim();
  if (!url || !key) return null;
  return {
    url: url.replace(/\/+$/, ""),
    key,
    bucket: process.env.SUPABASE_LOGO_BUCKET?.trim() || COMPANY_LOGO_BUCKET,
  };
}

export function logoBytesBuffer(value: unknown): Buffer | null {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value.length ? value : null;
  if (value instanceof Uint8Array) return value.length ? Buffer.from(value) : null;
  if (typeof value === "string" && value.length) {
    const hex = value.replace(/^\\x/, "");
    return Buffer.from(hex, "hex");
  }
  return null;
}

type LogoFetch = (input: string, init?: RequestInit) => Promise<Pick<Response, "ok" | "status">>;

/**
 * Upload with the service role so storage RLS does not block a company admin.
 * Returns the public object URL only when that URL can actually be read.
 */
export async function uploadLogoToSupabase(
  tenantId: number,
  buffer: Buffer,
  contentType: string,
  fetchImpl: LogoFetch = fetch,
): Promise<string | null> {
  const config = supabaseStorageConfig();
  if (!config) return null;
  const headers = { Authorization: `Bearer ${config.key}`, apikey: config.key };
  await fetchImpl(`${config.url}/storage/v1/bucket`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ id: config.bucket, name: config.bucket, public: true }),
  });
  const objectPath = companyLogoObjectPath(tenantId, contentType);
  const objectUrl = `${config.url}/storage/v1/object/${encodeURIComponent(config.bucket)}/${objectPath.split("/").map(encodeURIComponent).join("/")}`;
  const uploadHeaders = { ...headers, "Content-Type": contentType, "x-upsert": "true", "cache-control": "public, max-age=300" };
  const body = new Uint8Array(buffer);
  let uploaded = await fetchImpl(objectUrl, { method: "POST", headers: uploadHeaders, body });
  if (!uploaded.ok) uploaded = await fetchImpl(objectUrl, { method: "PUT", headers: uploadHeaders, body });
  if (!uploaded.ok) return null;
  const publicUrl = supabasePublicObjectUrl(config.url, config.bucket, objectPath);
  const visible = await fetchImpl(publicUrl, { method: "GET", headers: { Range: "bytes=0-0" } });
  return visible.ok ? publicUrl : null;
}

/** Public URL written to tenants.logo_url. The bucket URL is used only when that object can be read. */
export async function resolveStoredLogoUrl(
  tenantId: number,
  buffer: Buffer,
  contentType: string,
  origin: string,
  fetchImpl?: LogoFetch,
): Promise<string> {
  const fallback = publicLogoUrl(origin, tenantId);
  try {
    const published = await uploadLogoToSupabase(tenantId, buffer, contentType, fetchImpl);
    return published ?? fallback;
  } catch {
    return fallback;
  }
}
