import { redis } from "./client";
import { logger } from "../logger";

/** Reads a JSON value from cache. Returns null on miss or parse failure. */
export async function getCached<T>(key: string): Promise<T | null> {
  try {
    const raw = await redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    logger.warn("redis_cache_read_failed", { key, error: String(err) });
    return null;
  }
}

/** Writes a JSON value to cache with a TTL. Never throws — caching is best-effort. */
export async function setCached(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch (err) {
    logger.warn("redis_cache_write_failed", { key, error: String(err) });
  }
}

export async function invalidateCache(key: string): Promise<void> {
  try {
    await redis.del(key);
  } catch (err) {
    logger.warn("redis_cache_invalidate_failed", { key, error: String(err) });
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
    const result = await redis.set(key, "1", "EX", ttlSeconds, "NX");
    return result === "OK";
  } catch (err) {
    logger.warn("redis_claim_failed", { key, error: String(err) });
    // fail open — Postgres unique constraints remain the source of truth
    return true;
  }
}
