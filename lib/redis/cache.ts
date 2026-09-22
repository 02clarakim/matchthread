import { redis } from "./client";
import { logger } from "../logger";

/**
 * Falls back to an in-process Map when Redis isn't configured (see
 * lib/redis/client.ts) — same interface either way. This cache was always
 * best-effort, never the source of truth, so losing cross-process/restart
 * sharing in the single-merged-process deploy costs nothing correctness-
 * wise, just a few extra DB reads on a cold cache.
 */
const localCache = new Map<string, { value: string; expiresAt: number }>();
/** Claim expiry timestamps for claimOnce's local fallback. */
const localClaims = new Map<string, number>();

function localGet(key: string): string | null {
  const entry = localCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    localCache.delete(key);
    return null;
  }
  return entry.value;
}

/** Reads a JSON value from cache. Returns null on miss or parse failure. */
export async function getCached<T>(key: string): Promise<T | null> {
  try {
    const raw = redis ? await redis.get(key) : localGet(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    logger.warn("cache_read_failed", { key, error: String(err) });
    return null;
  }
}

/** Writes a JSON value to cache with a TTL. Never throws — caching is best-effort. */
export async function setCached(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    const raw = JSON.stringify(value);
    if (redis) {
      await redis.set(key, raw, "EX", ttlSeconds);
    } else {
      localCache.set(key, { value: raw, expiresAt: Date.now() + ttlSeconds * 1000 });
    }
  } catch (err) {
    logger.warn("cache_write_failed", { key, error: String(err) });
  }
}

export async function invalidateCache(key: string): Promise<void> {
  try {
    if (redis) {
      await redis.del(key);
    } else {
      localCache.delete(key);
    }
  } catch (err) {
    logger.warn("cache_invalidate_failed", { key, error: String(err) });
  }
}

/** Fetch-through cache helper: serve from cache, otherwise compute + populate. */
export async function withCache<T>(
  key: string,
  ttlSeconds: number,
  compute: () => Promise<T>
): Promise<T> {
  const cached = await getCached<T>(key);
  if (cached !== null) return cached;
  const value = await compute();
  await setCached(key, value, ttlSeconds);
  return value;
}

/**
 * Atomically claims a short-lived "in-flight"/"seen" marker.
 * Returns true if this call claimed it (caller should proceed),
 * false if another process already claimed it (caller should skip).
 */
export async function claimOnce(key: string, ttlSeconds: number): Promise<boolean> {
  try {
    if (redis) {
      const result = await redis.set(key, "1", "EX", ttlSeconds, "NX");
      return result === "OK";
    }
    // No Redis configured means no separate processes to race against
    // (see lib/redis/client.ts) — a synchronous check-and-set is safe.
    const now = Date.now();
    const expiresAt = localClaims.get(key);
    if (expiresAt && now < expiresAt) return false;
    localClaims.set(key, now + ttlSeconds * 1000);
    return true;
  } catch (err) {
    logger.warn("cache_claim_failed", { key, error: String(err) });
    // fail open — Postgres unique constraints remain the source of truth
    return true;
  }
}
