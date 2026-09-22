import Redis from "ioredis";

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
  redisPublisher: Redis | undefined;
};

function createClient(): Redis {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is not set");
  return new Redis(url, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      // exponential backoff, capped at 5s, so a Redis restart doesn't crash the process
      return Math.min(times * 500, 5000);
    },
  });
}

/**
 * `null` when REDIS_URL is unset — the single-merged-process deploy
 * (server.ts) has no separate processes to talk to over pub/sub, and no
 * need for a shared cache either, so lib/redis/pubsub.ts and
 * lib/redis/cache.ts fall back to in-process alternatives behind the same
 * interface rather than paying for a Redis instance to talk to itself.
 * Local dev (docker-compose.yml sets REDIS_URL) and a multi-process
 * deploy still get the real thing, unchanged.
 */
const REDIS_CONFIGURED = Boolean(process.env.REDIS_URL);

/** General-purpose client: GET/SET/caching, dedupe keys, rate limiting. */
export const redis: Redis | null = REDIS_CONFIGURED ? (globalForRedis.redis ?? createClient()) : null;

/**
 * Dedicated publisher client. ioredis puts a connection into a special mode
 * once `.subscribe()` is called on it, after which it can only issue
 * subscribe/unsubscribe/ping — so publishing and subscribing must never
 * share a connection.
 */
export const redisPublisher: Redis | null = REDIS_CONFIGURED ? (globalForRedis.redisPublisher ?? createClient()) : null;

if (process.env.NODE_ENV !== "production" && REDIS_CONFIGURED) {
  globalForRedis.redis = redis ?? undefined;
  globalForRedis.redisPublisher = redisPublisher ?? undefined;
}

/** Creates a fresh, dedicated connection for subscribing. Caller owns its lifecycle. Only called when REDIS_CONFIGURED (see pubsub.ts). */
export function createSubscriberClient(): Redis {
  return createClient();
}
