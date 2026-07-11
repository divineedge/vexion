/**
 * Simple in-process cache for expensive report queries.
 * Reports are cached per-tenant + endpoint + filter combination for up to 1 hour,
 * so repeatedly opening the Reports page doesn't re-run costly aggregate queries.
 */

const TTL_MS = 60 * 60 * 1000; // 1 hour

interface CacheEntry<T> {
  data: T;
  generatedAt: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

function buildKey(tenantId: number, reportKey: string, params: Record<string, unknown>): string {
  return `${tenantId}:${reportKey}:${JSON.stringify(params, Object.keys(params).sort())}`;
}

export async function getCachedReport<T>(
  tenantId: number,
  reportKey: string,
  params: Record<string, unknown>,
  compute: () => Promise<T>,
): Promise<{ data: T; generatedAt: string; cached: boolean }> {
  const key = buildKey(tenantId, reportKey, params);
  const existing = cache.get(key) as CacheEntry<T> | undefined;
  if (existing && existing.expiresAt > Date.now()) {
    return { data: existing.data, generatedAt: existing.generatedAt, cached: true };
  }
  const data = await compute();
  const generatedAt = new Date().toISOString();
  cache.set(key, { data, generatedAt, expiresAt: Date.now() + TTL_MS });
  return { data, generatedAt, cached: false };
}
