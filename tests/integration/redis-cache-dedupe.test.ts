import { describe, expect, it, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { redis } from "@/lib/redis/client";
import { claimOnce, withCache } from "@/lib/redis/cache";

// Skipped when REDIS_URL isn't set (lib/redis/client.ts) — this suite
// specifically exercises the real-Redis backend, not the in-process
// fallback used by the merged single-process deploy (server.ts).
describe.skipIf(!redis)("Redis dedupe/caching (against a real Redis instance)", () => {
  const keysToClean: string[] = [];

  afterAll(async () => {
    if (keysToClean.length > 0) await redis!.del(...keysToClean);
  });

  it("claimOnce lets the first caller through and blocks the second", async () => {
    const key = `test:claim:${randomUUID()}`;
    keysToClean.push(key);

    const first = await claimOnce(key, 30);
    const second = await claimOnce(key, 30);

    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it("withCache computes once and serves the cached value on subsequent calls", async () => {
    const key = `test:cache:${randomUUID()}`;
    keysToClean.push(key);

    let computeCount = 0;
    const compute = async () => {
      computeCount += 1;
      return { value: 42 };
    };

    const first = await withCache(key, 30, compute);
    const second = await withCache(key, 30, compute);

    expect(first).toEqual({ value: 42 });
    expect(second).toEqual({ value: 42 });
    expect(computeCount).toBe(1);
  });
});
